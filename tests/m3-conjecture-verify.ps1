# m3-conjecture-verify.ps1 -- Build-14 (M3-lite) offline verification.
# Three parts (no local node -- JS is verified live after deploy):
#   A) DETECTION: regex ports of detectConjectureGen -- fires only on explicit
#      run-the-generator asks; recall questions, M1 probe asks, discovery asks
#      and long pasted briefs must NOT fire.
#   B) FALSIFIER: a PowerShell mirror of computeFeatureTable + falsify, run at
#      LIM=10,000 and checked against KNOWN Collatz ground truth (sigma_inf(27)
#      = 111 is the first n exceeding 100; sigma(n)=1 exactly for even n;
#      nu2(3n+1)=2 exactly for n = 1 (mod 8) -> density 25% = 2^-2).
#   C) GATE + VACUITY arithmetic: pure-function mirrors with hand cases.
# Pure ASCII (PS 5.1 reads no-BOM UTF-8 as ANSI).

$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
$pass = 0; $fail = 0
function Check([string]$name, $actual, $expected) {
  if ("$actual" -eq "$expected") { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got $actual, want $expected)" -ForegroundColor Red }
}
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}

# ================= A) detection regex ports =================
Write-Host "`n== A) detectConjectureGen regex ports ==" -ForegroundColor Cyan
$M3_TARGET   = '\b(?:collatz|3n\s*\+\s*1|3x\s*\+\s*1)\b'
$M3_GEN_RE   = '\b(?:conjecture\s+generat(?:or|ion)|generate\s+(?:some\s+|new\s+|\d+\s+)?conjectures?|m3[-\s]?lite|m3\s+(?:generator|run)|run\s+m3)\b'
$M3_RUN_VERB = '\b(?:run|generate|execute|launch|fire|start|kick\s+off)\b'

function DetectCore([string]$s) {
  return ([regex]::IsMatch($s, $M3_TARGET, $IC)) -and
         ([regex]::IsMatch($s, $M3_GEN_RE, $IC)) -and
         ([regex]::IsMatch($s, $M3_RUN_VERB, $IC))
}

Check "fires: run the conjecture generator on collatz up to 100,000" (DetectCore "run the conjecture generator on collatz up to 100,000") True
Check "fires: generate conjectures about collatz stopping times" (DetectCore "generate conjectures about collatz stopping times") True
Check "fires: run m3-lite on collatz" (DetectCore "run m3-lite on collatz") True
Check "fires: kick off the m3 generator on 3n+1 up to 50k seed 42" (DetectCore "kick off the m3 generator on 3n+1 up to 50k seed 42") True
Check "fires: generate 20 conjectures on collatz" (DetectCore "generate 20 conjectures on collatz") True
Check "no fire: what conjectures do we have on collatz?" (DetectCore "what conjectures do we have on collatz?") False
Check "no fire: run the structural probes on collatz up to 100000 (M1's)" (DetectCore "run the structural probes on collatz up to 100000") False
Check "no fire: verify collatz up to 100,000 and log it (discovery's)" (DetectCore "verify collatz up to 100,000 and log it") False
Check "no fire: the conjecture generator on collatz is a cool idea" (DetectCore "the conjecture generator on collatz is a cool idea") False
Check "no fire: generate conjectures about goldbach (wrong target)" (DetectCore "generate conjectures about goldbach") False
Check "no fire: tell me about the collatz conjecture" (DetectCore "tell me about the collatz conjecture") False

# sentence-scoping discipline (the S6 coda-leak lesson): a long paste with the
# signal words spread across DIFFERENT sentences must not fire per-sentence.
$paste = "The team reviewed collatz work this week and liked the census. " +
         "We should generate more documentation soon for the wider effort. " +
         "Several conjectures from the literature were discussed in depth too. " +
         "Overall the round went well and the next sync is planned for Friday, with more reviewers joining us then."
$fired = $false
foreach ($sent in ($paste -split '(?<=[.!?])\s+')) { if ($sent.Length -ge 12 -and (DetectCore $sent)) { $fired = $true } }
CheckTrue "no fire: long paste, signals in different sentences" (-not $fired)

# seed + bound extraction
$m = [regex]::Match("kick off the m3 generator on collatz up to 50k seed 42", '\bseed\s+(\d{1,9})\b', $IC)
Check "seed parsed" $m.Groups[1].Value "42"
$b = [regex]::Match("run the conjecture generator on collatz up to 100,000", '\b(?:up\s+to|below|under|to)\s+(?:n\s*=\s*)?(\d[\d,_]*)', $IC)
Check "bound parsed" ($b.Groups[1].Value -replace ',','') "100000"

# ================= B) falsifier mirror vs known ground truth =================
Write-Host "`n== B) feature table + falsifier mirror (LIM=10,000) ==" -ForegroundColor Cyan
$LIM = 10000   # NOTE: PS variables are case-insensitive - $N would collide with loop counter $n
$sigma = New-Object int[] ($LIM + 1)
$total = New-Object double[] ($LIM + 1)
$peak  = New-Object double[] ($LIM + 1)
$nu    = New-Object int[] ($LIM + 1)
$total[1] = 0; $peak[1] = 1

for ($n = 2; $n -le $LIM; $n++) {
  $v = [double]$n; $steps = 0.0; $pk = [double]$n; $sg = 0
  while ($true) {
    if ($v % 2 -eq 0) { $v = $v / 2 } else { $v = 3 * $v + 1 }
    $steps++
    if ($v -gt $pk) { $pk = $v }
    if ($v -lt $n) {
      $sg = [int]$steps
      $steps += $total[[int]$v]
      if ($peak[[int]$v] -gt $pk) { $pk = $peak[[int]$v] }
      break
    }
  }
  $sigma[$n] = $sg; $total[$n] = $steps; $peak[$n] = $pk
  if ($n % 2 -eq 1) {
    $x = 3 * $n + 1; $k = 0
    while ($x % 2 -eq 0) { $x = $x / 2; $k++ }
    $nu[$n] = $k
  }
}

# ground truth anchors (literature)
Check "sigma_inf(27) = 111" $total[27] 111
Check "peak(27) = 9232" $peak[27] 9232
Check "sigma(even) = 1 (n=9998)" $sigma[9998] 1

# falsify mirror: A_total_log-style flat bound "sigma_inf(n) <= 100" must be
# killed with FIRST counterexample n=27 (no smaller n exceeds 100).
$counter = 0
for ($n = 2; $n -le $LIM; $n++) { if ($total[$n] -gt 100) { $counter = $n; break } }
Check "first n with sigma_inf > 100 is 27" $counter 27

# A_res_sigma_max mirror on an all-even class would be trivial (sigma=1):
# the template excludes it -- classHasOdd(m even, r even) = false.
function ClassHasOdd([int]$m, [int]$r) { return ($m % 2 -eq 1) -or ($r % 2 -eq 1) }
Check "classHasOdd(6,4) excluded" (ClassHasOdd 6 4) False
Check "classHasOdd(6,1) allowed"  (ClassHasOdd 6 1) True
Check "classHasOdd(3,0) allowed (odd modulus = mixed class)" (ClassHasOdd 3 0) True

# Live-run A2 catch (Build-14 hotfix): n = 1 (mod 4) has sigma(n) = 3 PROVABLY,
# so sigma-templates must exclude classes that pin n = 1 (mod 4).
function SigmaClassNontrivial([int]$m, [int]$r) {
  return (ClassHasOdd $m $r) -and -not (($m % 4 -eq 0) -and ($r % 4 -eq 1))
}
Check "sigma class (12,1) excluded (pins n=1 mod 4)" (SigmaClassNontrivial 12 1) False
Check "sigma class (12,5) excluded (5 = 1 mod 4)"    (SigmaClassNontrivial 12 5) False
Check "sigma class (12,3) allowed (3 mod 4 varies)"  (SigmaClassNontrivial 12 3) True
Check "sigma class (6,1) allowed (mod 6 doesn't pin mod 4)" (SigmaClassNontrivial 6 1) True
# and the identity itself, against the real feature table:
$ok = $true
for ($n = 5; $n -le $LIM; $n += 4) { if ($sigma[$n] -ne 3) { $ok = $false; break } }
CheckTrue "sigma(n) = 3 for ALL n = 1 (mod 4), 5..10000 (the provable identity)" $ok

# B_sigma_freq mirror: sigma(n) <= 1 holds for exactly the even n.
# evens in [2,10000] = 5000 of 9999 values -> 50.005%.
$cnt = 0
for ($n = 2; $n -le $LIM; $n++) { if ($sigma[$n] -le 1) { $cnt++ } }
$obs = 100.0 * $cnt / ($LIM - 1)
CheckTrue "B_sigma_freq observed ~50.005% (got $([math]::Round($obs,3)))" ([math]::Abs($obs - 50.005) -lt 0.01)
CheckTrue "claim 'at least 49%' survives" ($obs -ge 49)
CheckTrue "claim 'at least 51%' is killed" (-not ($obs -ge 51))

# B_nu_geo mirror: nu2(3n+1)=2 exactly when n = 1 (mod 8) -> density 25% = 2^-2.
$cnt = 0; $odd = 0
for ($n = 3; $n -le $LIM; $n += 2) { if ($nu[$n] -eq 2) { $cnt++ }; $odd++ }
$obs = 100.0 * $cnt / $odd
$dev = [math]::Abs($obs - 25.0)
CheckTrue "B_nu_geo k=2 deviation from 25% under 0.25pp (dev=$([math]::Round($dev,4)))" ($dev -le 0.25)

# A_nu_total_max domain sanity: odd n with nu>=4 exist below 10k and their
# sigma_inf varies (non-local feature -- the A2-safe implication target).
$mx = 0; $found = 0
for ($n = 3; $n -le $LIM; $n += 2) { if ($nu[$n] -ge 4) { $found++; if ($total[$n] -gt $mx) { $mx = $total[$n] } } }
CheckTrue "nu>=4 class non-empty ($found members)" ($found -gt 100)
CheckTrue "nu>=4 max sigma_inf varies (max=$mx > 20)" ($mx -gt 20)

# ================= C) GATE v2 (Wilson/Newcombe) + vacuity arithmetic =================
Write-Host "`n== C) gate v2 (Wilson difference) + vacuity mirrors ==" -ForegroundColor Cyan
# Build-15 (round-3 Q2): gate = 95% lower bound of (p_mined - p_baseline) > 0.
# Mirrors wilsonCI + newcombeDiffLower in lib/conjecture-gen.js exactly.
$WZ = 1.96
function WilsonLo([int]$k, [int]$n) {
  if ($n -eq 0) { return 0.0 }
  $p = $k / $n; $z2 = $WZ * $WZ
  $den = 1 + $z2 / $n
  $center = ($p + $z2 / (2 * $n)) / $den
  $half = ($WZ * [math]::Sqrt(($p * (1 - $p)) / $n + $z2 / (4 * $n * $n))) / $den
  return [math]::Max(0.0, $center - $half)
}
function WilsonHi([int]$k, [int]$n) {
  if ($n -eq 0) { return 0.0 }
  $p = $k / $n; $z2 = $WZ * $WZ
  $den = 1 + $z2 / $n
  $center = ($p + $z2 / (2 * $n)) / $den
  $half = ($WZ * [math]::Sqrt(($p * (1 - $p)) / $n + $z2 / (4 * $n * $n))) / $den
  return [math]::Min(1.0, $center + $half)
}
function NewcombeLower([int]$k1, [int]$n1, [int]$k2, [int]$n2) {
  $p1 = 0.0; if ($n1 -gt 0) { $p1 = $k1 / $n1 }
  $p2 = 0.0; if ($n2 -gt 0) { $p2 = $k2 / $n2 }
  $lo1 = WilsonLo $k1 $n1; $hi2 = WilsonHi $k2 $n2
  return ($p1 - $p2) - [math]::Sqrt([math]::Pow($p1 - $lo1, 2) + [math]::Pow($hi2 - $p2, 2))
}
function GateV2([int]$ms, [int]$mt, [int]$bs, [int]$bt) {
  if ($ms -lt 1) { return $false }
  return ((NewcombeLower $ms $mt $bs $bt) -gt 0)
}
# Wilson sanity: 0/120 has hi = z^2/(n+z^2) (textbook value)
$hi0 = WilsonHi 0 120
CheckTrue "Wilson hi(0/120) = z^2/(n+z^2) (got $([math]::Round($hi0,4)))" ([math]::Abs($hi0 - (3.8416 / 123.8416)) -lt 0.0005)
Check "gate v2: 12/120 vs 2/120 -> PASS (clear separation)" (GateV2 12 120 2 120) True
Check "gate v2: 40/120 vs 10/120 -> PASS" (GateV2 40 120 10 120) True
Check "gate v2: 5/120 vs 2/120 -> FAIL (2.5x ratio, CI too wide -- v1 would have passed)" (GateV2 5 120 2 120) False
Check "gate v2: 1/120 vs 0/120 -> FAIL (lone survivor no longer auto-passes -- v1 passed this)" (GateV2 1 120 0 120) False
Check "gate v2: 0/120 vs 0/120 -> FAIL (no survivors)" (GateV2 0 120 0 120) False
Check "gate v2: equal rates 10/120 vs 10/120 -> FAIL" (GateV2 10 120 10 120) False

# vacuity (Type A ratio rule, VACUITY_RATIO=1.5): claimed c vs needed c
function VacA([double]$c, [double]$need) { return $c -gt ([math]::Max($need, 1) * 1.5) }
Check "vacuous: sigma claim c=119 when observed max 60" (VacA 119 60) True
Check "not vacuous: c=65 when observed max 60" (VacA 65 60) False
# vacuity (B_sigma_freq, VAC_FREQ_PP=5): observed - claimed > 5pp
function VacBFreq([double]$obsv, [double]$p) { return ($obsv - $p) -gt 5 }
Check "vacuous: claims 40% when observed 50%" (VacBFreq 50 40) True
Check "not vacuous: claims 49.5% when observed 50%" (VacBFreq 50 49.5) False

# canonical statement determinism (the graph dedup key)
function StmtResSigma([int]$mm, [int]$rr, [int]$cc, [string]$NN) {
  return "for all n <= $NN with n = $rr (mod $mm): stopping time sigma(n) <= $cc"
}
Check "statement canonical + deterministic" (StmtResSigma 6 1 96 "100,000") (StmtResSigma 6 1 96 "100,000")

# ================= E) MICRO-PROVER mirror (Build-15, round-3 Q4) =================
Write-Host "`n== E) micro-prover mirror vs ground truth ==" -ForegroundColor Cyan
# Mirrors residueDecided in lib/conjecture-gen.js: zero-variance, then constant-
# within-every-(n mod 2^J)-bucket for J=1..8, every bucket >= 3 members,
# slice >= 16. Reuses the LIM=10,000 feature tables from Part B.
function ResidueDecided([int[]]$ns, $vals, [bool]$residueDomain) {
  if ($ns.Count -lt 16) { return "" }
  $const = $true
  for ($i = 1; $i -lt $vals.Count; $i++) { if ($vals[$i] -ne $vals[0]) { $const = $false; break } }
  if ($const) { return "zero_variance" }
  if (-not $residueDomain) { return "" }
  for ($J = 1; $J -le 8; $J++) {
    $mod = [math]::Pow(2, $J)
    $bv = @{}; $bc = @{}
    $ok = $true
    for ($i = 0; $i -lt $ns.Count; $i++) {
      $b = $ns[$i] % $mod
      if (-not $bv.ContainsKey($b)) { $bv[$b] = $vals[$i]; $bc[$b] = 1 }
      elseif ($bv[$b] -ne $vals[$i]) { $ok = $false; break }
      else { $bc[$b] = $bc[$b] + 1 }
    }
    if (-not $ok) { continue }
    $occupied = $true
    foreach ($cnt in $bc.Values) { if ($cnt -lt 3) { $occupied = $false; break } }
    if (-not $occupied) { break }
    if ($bv.Count -ge 2) { return "covering_set_mod_2^$J" }
  }
  return ""
}
# slice cap mirror (4096) keeps these fast
$CAP = 4096

# 1) ZERO-VARIANCE catch: sigma on the class n = 1 (mod 4) is constant 3 -- the
#    Build-14 A2 leak class now dies automatically, no hand exclusion needed.
$ns1 = New-Object System.Collections.Generic.List[int]
$vs1 = New-Object System.Collections.Generic.List[object]
for ($n = 5; $n -le $LIM -and $ns1.Count -lt $CAP; $n += 4) { $ns1.Add($n); $vs1.Add($sigma[$n]) }
Check "zero-variance: sigma on n=1 (mod 4) -> trivial" (ResidueDecided $ns1.ToArray() $vs1 $true) "zero_variance"

# 2) COVERING-SET catch: the B_nu_geo k=2 indicator over odd n is decided by
#    n mod 8 -- the geometric law is PROVABLE, the whole template retires.
$ns2 = New-Object System.Collections.Generic.List[int]
$vs2 = New-Object System.Collections.Generic.List[object]
for ($n = 3; $n -le $LIM -and $ns2.Count -lt $CAP; $n += 2) { $ns2.Add($n); $vs2.Add($(if ($nu[$n] -eq 2) { 1 } else { 0 })) }
Check "covering-set: nu2=2 indicator over odd n -> trivial at J=3" (ResidueDecided $ns2.ToArray() $vs2 $true) "covering_set_mod_2^3"

# 3) COVERING-SET catch: the B_sigma_freq t=3 indicator is decided by n mod 4
#    (even -> sigma=1; 1 mod 4 -> sigma=3; 3 mod 4 -> sigma>3).
$ns3 = New-Object System.Collections.Generic.List[int]
$vs3 = New-Object System.Collections.Generic.List[object]
for ($n = 2; $n -le $LIM -and $ns3.Count -lt $CAP; $n++) { $ns3.Add($n); $vs3.Add($(if ($sigma[$n] -le 3) { 1 } else { 0 })) }
Check "covering-set: sigma<=3 indicator over all n -> trivial at J=2" (ResidueDecided $ns3.ToArray() $vs3 $true) "covering_set_mod_2^2"

# 4) UNDER-KILL: sigma_inf over all n is dynamics-dependent -- NOT decided.
$ns4 = New-Object System.Collections.Generic.List[int]
$vs4 = New-Object System.Collections.Generic.List[object]
for ($n = 2; $n -le $LIM -and $ns4.Count -lt $CAP; $n++) { $ns4.Add($n); $vs4.Add($total[$n]) }
Check "not trivial: sigma_inf over all n (dynamics, not residue)" (ResidueDecided $ns4.ToArray() $vs4 $true) ""

# 5) UNDER-KILL: sigma over a MIXED class (n = 3 mod 4 contains varying sigma).
$ns5 = New-Object System.Collections.Generic.List[int]
$vs5 = New-Object System.Collections.Generic.List[object]
for ($n = 3; $n -le $LIM -and $ns5.Count -lt $CAP; $n += 4) { $ns5.Add($n); $vs5.Add($sigma[$n]) }
Check "not trivial: sigma on n=3 (mod 4) varies beyond J=8" (ResidueDecided $ns5.ToArray() $vs5 $true) ""

# 6) DOMAIN FLAG: a dynamics-defined domain (B_cond_peak_nu, peak/n >= t) must
#    NOT get the covering-set inference even when the VALUE is residue-pinned
#    (nu2=1 iff n=3 mod 4 -- value decidable, claim about domain composition).
$ns6 = New-Object System.Collections.Generic.List[int]
$vs6 = New-Object System.Collections.Generic.List[object]
for ($n = 3; $n -le $LIM -and $ns6.Count -lt $CAP; $n += 2) { if (($peak[$n] / $n) -ge 5) { $ns6.Add($n); $vs6.Add($(if ($nu[$n] -eq 1) { 1 } else { 0 })) } }
CheckTrue "B_cond_peak_nu domain non-trivial size ($($ns6.Count) members)" ($ns6.Count -ge 100)
Check "covering-set NOT applied on dynamics-defined domain (flag false)" (ResidueDecided $ns6.ToArray() $vs6 $false) ""

# 7) v1.1 conditional template falsifier sanity: domain odd n with nu2>=3 is
#    non-empty and peak/n on it VARIES (a real cross-feature claim surface).
$cnt7 = 0; $mn7 = 1e9; $mx7 = 0
for ($n = 3; $n -le $LIM; $n += 2) { if ($nu[$n] -ge 3) { $cnt7++; $r = $peak[$n] / $n; if ($r -lt $mn7) { $mn7 = $r }; if ($r -gt $mx7) { $mx7 = $r } } }
CheckTrue "A_cond_nu_peak domain non-empty ($cnt7 members)" ($cnt7 -gt 200)
CheckTrue "peak/n varies on nu2>=3 domain (min $([math]::Round($mn7,2)) max $([math]::Round($mx7,2)))" ($mx7 -gt (2 * $mn7))

# ================= summary =================
Write-Host "`n=================================================="
Write-Host ("  M3-lite offline verification: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
