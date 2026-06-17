# Build-47 offline mirror — multi-candidate generation + triviality floor.
# PURE ASCII. Mirrors the pure logic in lib/kernel-conjecture.js:
#   classifyHeld / observedRootSet / tightnessScore / byInfo ranking / parseClaims.
# No local Node — this is the offline proof; live verification deferred to after
# the 05:00 nightly. Run:  powershell -File tests\multi-candidate-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $name) }
  else       { $script:fail++; Write-Host ("  FAIL  " + $name) }
}

# ---- digital root of g(n) (mirror of digitalRootOfGen, mod-9) ----------------
function Get-DR($gen, $k, $base, $n) {
  switch ($gen) {
    'multiple' { $v = (($k % 9) * ($n % 9)) % 9 }
    'power'    { $r = 1; $b = $base % 9; $e = $n
                 while ($e -gt 0) { if ($e -band 1) { $r = ($r * $b) % 9 }; $b = ($b * $b) % 9; $e = [math]::Floor($e / 2) }
                 $v = $r }
    'square'   { $m = $n % 9; $v = ($m * $m) % 9 }
    default    { $v = $n % 9 }
  }
  if ($v -eq 0) { 9 } else { $v }
}
function Get-ObservedRoots($gen, $k, $base, $bound) {
  $cap = [math]::Min($bound, 5000)
  $set = @{}
  for ($n = 1; $n -le $cap; $n++) { $set[(Get-DR $gen $k $base $n)] = $true }
  @($set.Keys | Sort-Object)
}

# ---- classifyHeld mirror -----------------------------------------------------
function Classify-Held($template, $setCount, $obsCount, $claimPeriod, $obsPeriod) {
  switch ($template) {
    'dr_constant' { 'tight' }
    'dr_set'      { if ($setCount -eq $obsCount) { 'tight' } else { 'trivial' } }
    'dr_periodic' { if ($null -eq $obsPeriod) { 'tight' } elseif ($claimPeriod -eq $obsPeriod) { 'tight' } else { 'trivial' } }
    'mod_cycle'   { if ($null -eq $obsPeriod) { 'tight' } elseif ($claimPeriod -eq $obsPeriod) { 'tight' } else { 'trivial' } }
    default       { 'tight' }
  }
}
function Tightness($template, $setCount, $period) {
  switch ($template) {
    'dr_constant' { 1 }
    'dr_set'      { $setCount }
    'dr_periodic' { $period }
    'mod_cycle'   { $period }
    default       { 99 }
  }
}

Write-Host "== observed root sets (sanity) =="
$r3 = Get-ObservedRoots 'multiple' 3 0 5000      # dr of 3n  -> {3,6,9}
Check "dr(3n) roots = {3,6,9}" (($r3 -join ',') -eq '3,6,9')
$r2 = Get-ObservedRoots 'power' 0 2 5000          # dr of 2^n -> {1,2,4,5,7,8}
Check "dr(2^n) roots = {1,2,4,5,7,8}" (($r2 -join ',') -eq '1,2,4,5,7,8')
$r9 = Get-ObservedRoots 'multiple' 9 0 5000       # dr of 9n  -> {9}
Check "dr(9n) roots = {9}" (($r9 -join ',') -eq '9')

Write-Host "== classifyHeld truth table =="
# dr_set {3,6,9} over dr(3n): observed exactly {3,6,9} -> TIGHT
Check "dr_set {3,6,9} == observed -> tight" ((Classify-Held 'dr_set' 3 $r3.Count $null $null) -eq 'tight')
# dr_set {1..9}: strict superset of {3,6,9} -> TRIVIAL
Check "dr_set {1..9} superset -> trivial"   ((Classify-Held 'dr_set' 9 $r3.Count $null $null) -eq 'trivial')
# dr_set {3,6,9,1}: length 4 > 3 -> TRIVIAL
Check "dr_set {3,6,9,1} looser -> trivial"  ((Classify-Held 'dr_set' 4 $r3.Count $null $null) -eq 'trivial')
# dr_periodic period 6 when minimal observed = 6 -> TIGHT
Check "dr_periodic p=6, minimal 6 -> tight"  ((Classify-Held 'dr_periodic' 0 0 6 6) -eq 'tight')
# dr_periodic period 12 when minimal = 6 -> TRIVIAL (proper multiple)
Check "dr_periodic p=12, minimal 6 -> trivial" ((Classify-Held 'dr_periodic' 0 0 12 6) -eq 'trivial')
# mod_cycle period 3 when minimal = 3 -> TIGHT ; period 9 -> TRIVIAL
Check "mod_cycle p=3, minimal 3 -> tight"    ((Classify-Held 'mod_cycle' 0 0 3 3) -eq 'tight')
Check "mod_cycle p=9, minimal 3 -> trivial"  ((Classify-Held 'mod_cycle' 0 0 9 3) -eq 'trivial')
# dr_constant is always tight when held
Check "dr_constant -> tight"                 ((Classify-Held 'dr_constant' 0 0 $null $null) -eq 'tight')
# minimal period unknown (null) -> not called trivial
Check "dr_periodic minimal null -> tight"    ((Classify-Held 'dr_periodic' 0 0 12 $null) -eq 'tight')

Write-Host "== tightnessScore / headline ranking =="
# Three TIGHT holds: constant (score1), set{3,6,9}(score3), periodic p6(score6).
# byInfo = score asc, then template-pref. Headline must be the constant.
$cands = @(
  @{ t = 'dr_set';      score = (Tightness 'dr_set' 3 0);      pref = 1; checked = 10000 },
  @{ t = 'dr_constant'; score = (Tightness 'dr_constant' 0 0); pref = 0; checked = 10000 },
  @{ t = 'dr_periodic'; score = (Tightness 'dr_periodic' 0 6); pref = 2; checked = 10000 }
)
$sorted = $cands | Sort-Object @{e={$_.score}}, @{e={$_.pref}}, @{e={ - $_.checked }}
Check "headline = tightest (dr_constant)" ($sorted[0].t -eq 'dr_constant')
Check "second = dr_set"                   ($sorted[1].t -eq 'dr_set')
Check "third = dr_periodic"               ($sorted[2].t -eq 'dr_periodic')
# tie on score -> template preference wins (set size 1 vs constant: both score 1)
$tie = @(
  @{ t = 'dr_set';      score = 1; pref = 1; checked = 10000 },
  @{ t = 'dr_constant'; score = 1; pref = 0; checked = 10000 }
) | Sort-Object @{e={$_.score}}, @{e={$_.pref}}, @{e={ - $_.checked }}
Check "score tie -> constant beats set-of-1" ($tie[0].t -eq 'dr_constant')

Write-Host "== parseClaims mirror =="
function Parse-Claims($s) {
  $s = $s.Trim()
  $m = [regex]::Match($s, '(?is)```(?:json)?\s*(.*?)```')
  if ($m.Success) { $s = $m.Groups[1].Value.Trim() }
  if ($s -match '(?i)^(null|\[\s*\])$') { return @() }
  $a = $s.IndexOf('['); $b = $s.LastIndexOf(']')
  if ($a -ge 0 -and $b -gt $a) {
    $arr = $s.Substring($a, $b - $a + 1) | ConvertFrom-Json
    if ($arr -is [array]) { return $arr } else { return @($arr) }
  }
  $oa = $s.IndexOf('{'); $ob = $s.LastIndexOf('}')
  if ($oa -ge 0 -and $ob -gt $oa) { return @(($s.Substring($oa, $ob - $oa + 1) | ConvertFrom-Json)) }
  return @()
}
$twoArr = '[{"template":"dr_set","generator":"multiple","params":{"k":3,"set":[3,6,9]}},{"template":"dr_periodic","generator":"power","params":{"base":2,"period":6}}]'
Check "parseClaims array -> 2"        (@(Parse-Claims $twoArr).Count -eq 2)
Check "parseClaims 'null' -> 0"       (@(Parse-Claims 'null').Count -eq 0)
Check "parseClaims '[]' -> 0"         (@(Parse-Claims '[]').Count -eq 0)
$single = '{"template":"dr_constant","generator":"multiple","params":{"k":9,"value":9}}'
Check "parseClaims single obj -> 1"   (@(Parse-Claims $single).Count -eq 1)
$tick = [char]96
$fence = "$tick$tick$tick"
$fenced = $fence + "json`n" + $twoArr + "`n" + $fence
Check "parseClaims fenced -> 2"       (@(Parse-Claims $fenced).Count -eq 2)
$prose = 'here are the claims: ' + $twoArr + ' done'
Check "parseClaims w/ prose -> 2"     (@(Parse-Claims $prose).Count -eq 2)

Write-Host ""
Write-Host ("RESULT: {0} passed, {1} failed" -f $pass, $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
