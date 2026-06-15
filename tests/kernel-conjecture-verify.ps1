# ============================================================================
# M8 Build-43 Option D -- Speculative-Kernel -> Conjecture bridge.
# PS mirror of the PURE checker in lib/kernel-conjecture.js (no local Node).
# Asserts: known-true number-pattern claims HOLD, planted-false ones are KILLED
# with a counterexample, off-schema proposals are REJECTED, narration never says
# "proven". Pure ASCII. Math is mirrored INLINE (flat loops) -- nested helper
# calls in PS hot loops are pathologically slow, so we keep the loops flat.
#   powershell -File tests/kernel-conjecture-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Output ("  PASS  " + $label) }
  else       { $script:fail++; Write-Output ("  FAIL  " + $label) }
}
# base^exp mod m  (mirror of modexp)
function ModExp([int]$b, [int]$e, [int]$m) {
  if ($m -eq 1) { return 0 }
  [long]$r = 1; [long]$bb = (($b % $m) + $m) % $m; [int]$ee = $e
  while ($ee -gt 0) { if ($ee -band 1) { $r = ($r * $bb) % $m }; $bb = ($bb * $bb) % $m; $ee = [math]::Floor($ee / 2) }
  return [int]$r
}
# digital root of base^n  (value mod 9, 0 -> 9)
function DrPow([int]$base, [int]$n) { $r = ModExp $base $n 9; if ($r -eq 0) { 9 } else { $r } }
# digital root of k*n
function DrMul([int]$k, [int]$n) { $r = (($k % 9) * ($n % 9)) % 9; if ($r -eq 0) { 9 } else { $r } }
# fib(n) mod m
function FibMod([int]$n, [int]$m) { $a = 0; $b = 1; for ($i = 1; $i -le $n; $i++) { $c = ($a + $b) % $m; $a = $b; $b = $c }; return $a }

Write-Output "`nM8 Build-43 Option D -- kernel-conjecture checker (pure-core mirror)`n"

# ---- 1. KNOWN-TRUE claims HOLD ---------------------------------------------
$h = $true; for ($n = 1; $n -le 600; $n++) { if ((DrPow 2 $n) -ne (DrPow 2 ($n + 6))) { $h = $false; break } }
Ok $h "dr(2^n) periodic period 6 -> HOLDS (the classic doubling/vortex cycle)"
$cyc = ((1..6 | ForEach-Object { DrPow 2 $_ }) -join ',')
Ok ($cyc -eq '2,4,8,7,5,1') "dr(2^n) cycle == 2,4,8,7,5,1 (observed)"
$h = $true; for ($n = 1; $n -le 600; $n++) { if ((DrMul 9 $n) -ne 9) { $h = $false; break } }
Ok $h "dr(9n) == 9 constant -> HOLDS"
$h = $true; for ($n = 1; $n -le 600; $n++) { if ((DrMul 3 $n) -ne (DrMul 3 ($n + 3))) { $h = $false; break } }
Ok $h "dr(3n) periodic period 3 -> HOLDS"
$h = $true; for ($n = 1; $n -le 180; $n++) { if ((FibMod $n 10) -ne (FibMod ($n + 60) 10)) { $h = $false; break } }
Ok $h "fib(n) mod 10 periodic period 60 (Pisano) -> HOLDS"
# Build-43 Option B: dr(3n) is ALWAYS in {3,6,9} (dr_set) -> HOLDS
$set = @(3,6,9); $h = $true; for ($n = 1; $n -le 600; $n++) { if ($set -notcontains (DrMul 3 $n)) { $h = $false; break } }
Ok $h "dr(3n) always in {3,6,9} (dr_set) -> HOLDS (the true pattern behind 'always 3')"

# ---- 2. PLANTED-FALSE claims are KILLED with a counterexample --------------
$ce = 0; for ($n = 1; $n -le 600; $n++) { if ((DrPow 2 $n) -ne (DrPow 2 ($n + 5))) { $ce = $n; break } }
Ok ($ce -gt 0) "dr(2^n) period 5 -> FALSIFIED (counterexample n=$ce)"
$ce = 0; for ($n = 1; $n -le 600; $n++) { if ((DrMul 3 $n) -ne 3) { $ce = $n; break } }
Ok ($ce -gt 0) "dr(3n) == 3 constant -> FALSIFIED (counterexample n=$ce)"
$ce = 0; for ($n = 1; $n -le 600; $n++) { if ((DrPow 2 $n) -ne (DrPow 2 ($n + 4))) { $ce = $n; break } }
Ok ($ce -gt 0) "dr(2^n) period 4 -> FALSIFIED (counterexample n=$ce)"
$ce = 0; for ($n = 1; $n -le 180; $n++) { if ((FibMod $n 10) -ne (FibMod ($n + 30) 10)) { $ce = $n; break } }
Ok ($ce -gt 0) "fib(n) mod 10 period 30 -> FALSIFIED (real Pisano is 60)"
# Build-43 Option B: the LITERAL false claim 'dr(3n) always in {3}' -> FALSIFIED at n=2 (dr=6)
$only3 = @(3); $ce = 0; for ($n = 1; $n -le 600; $n++) { if ($only3 -notcontains (DrMul 3 $n)) { $ce = $n; break } }
Ok ($ce -eq 2) "dr(3n) always in {3} (literal 'always 3') -> FALSIFIED at n=2 (the Scenario-B fix)"

# ---- 3. validateClaim whitelist gate (mirror of the rules) -----------------
function ValidShape($c) {
  $templates = @('dr_periodic','dr_constant','dr_set','mod_cycle')
  $gens = @('n','multiple','power','square','cube','triangular','fib')
  if ($null -eq $c) { return $false }
  if ($templates -notcontains $c.template) { return $false }
  if ($gens -notcontains $c.generator) { return $false }
  $p = $c.params
  if ($c.generator -eq 'multiple' -and -not ($p.k -ge 1 -and $p.k -le 10000)) { return $false }
  if ($c.generator -eq 'power' -and -not ($p.base -ge 2 -and $p.base -le 10000)) { return $false }
  if ($c.template -eq 'dr_periodic' -and -not ($p.period -ge 1 -and $p.period -le 100)) { return $false }
  if ($c.template -eq 'dr_constant' -and -not ($p.value -ge 1 -and $p.value -le 9)) { return $false }
  if ($c.template -eq 'dr_set') {
    if (-not ($p.set -is [array]) -or $p.set.Count -lt 1 -or $p.set.Count -gt 9) { return $false }
    foreach ($x in $p.set) { if (-not ($x -ge 1 -and $x -le 9)) { return $false } }
  }
  if ($c.template -eq 'mod_cycle' -and -not (($p.m -ge 2 -and $p.m -le 1000) -and ($p.period -ge 1 -and $p.period -le 100))) { return $false }
  return $true
}
Ok (ValidShape @{ template='dr_periodic'; generator='power'; params=@{ base=2; period=6 } })   "validate: well-formed power/dr_periodic -> accepted"
Ok (-not (ValidShape @{ template='energy_geometry'; generator='power'; params=@{ base=2 } })) "validate: bogus template 'energy_geometry' -> REJECTED"
Ok (-not (ValidShape @{ template='dr_periodic'; generator='vortex'; params=@{ period=6 } }))  "validate: bogus generator 'vortex' -> REJECTED"
Ok (-not (ValidShape @{ template='dr_constant'; generator='multiple'; params=@{ k=9; value=42 } })) "validate: dr value out of 1..9 -> REJECTED"
Ok (-not (ValidShape @{ template='power'; generator='power'; params=@{ base=2 } }))            "validate: template==generator garbage -> REJECTED"
Ok (ValidShape @{ template='dr_set'; generator='multiple'; params=@{ k=3; set=@(3,6,9) } })    "validate: dr_set {3,6,9} -> accepted"
Ok (-not (ValidShape @{ template='dr_set'; generator='multiple'; params=@{ k=3; set=@(3,6,42) } })) "validate: dr_set with out-of-range member 42 -> REJECTED"

# ---- 4. NARRATION honesty contract (static source check) -------------------
$src = Get-Content -Raw -Path (Join-Path $PSScriptRoot '..\lib\kernel-conjecture.js')
Ok ($src -match 'NOT a proof for all n')         "narration: held claim says 'NOT a proof for all n'"
Ok ($src -match 'never proven')                  "narration: explicitly 'never proven'"
Ok ($src -match 'stays speculative')             "narration: speculative leap stays speculative"
Ok ($src -notmatch 'proven for all|is now proven|is proven\b') "narration: never claims the target proven"
Ok ($src -match 'failed attempt')                "narration: falsified claim recorded as a failed attempt (data)"
Ok ($src -match "heldVerificationState[\s\S]{0,80}empirical") "honesty: held state capped at 'empirical' (never 'proven')"
# Build-43 Option B: literal-claim-first flow + nearest-true fallback
Ok ($src -match 'your stated claim')             "Option B: tests the user's STATED claim (literal-first)"
Ok ($src -match 'Nearest TRUE pattern')          "Option B: offers the nearest TRUE pattern when the literal claim is false"
Ok ($src -match 'stays SPECULATIVE either way')  "Option B: speculative leap stays speculative regardless of the pattern result"
Ok ($src -match 'proposeLiteralClaim')           "Option B: proposeLiteralClaim present (fidelity over truth)"

# ---- 5. detection routing (mirror of detectKernelTest) ---------------------
$KT  = '\b(?:test|check|verify|falsif(?:y|ies)|extract(?:\s+and\s+(?:test|check))?)\b[^?.!]{0,30}\b(?:kernel|established core|real (?:arithmetic|math|core)|number[- ]pattern|digital[- ]root|conjecture)\b'
$CV  = '\b(?:test|check|verify|falsif(?:y|ies))\b[^?.!]{0,30}\b(?:claim|pattern)\b'
$MS  = '\b(?:digital[- ]root|digit sum|modul[oa]r?\b|mod \d|2\s*\^|3n\b|\d+\s*\^\s*n|fibonacci|sequence|periodic|cycles?\b|vortex)\b'
function Detect([string]$m) { return ($m -match $KT) -or (($m -match $CV) -and ($m -match $MS)) }
Ok (Detect "test the number pattern: the digital root of 3n is always 3") "detect: 'test the number pattern: ...' -> fires"
Ok (Detect "test the kernel of this vortex idea: doubling and digital root cycles") "detect: 'test the kernel of [vortex idea]' -> fires"
Ok (Detect "check this claim: the digital root of 2^n cycles with period 6") "detect: 'check this claim' + math signal -> fires"
Ok (-not (Detect "check this claim with the insurance company tomorrow")) "detect: 'check this claim' (insurance, no math) -> does NOT fire"
Ok (-not (Detect "test a new pricing pattern for the night shift drivers")) "detect: 'test a new pattern' (fleet, no math) -> does NOT fire"

Write-Output ("`n==== kernel-conjecture-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
