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

# ---- 2. PLANTED-FALSE claims are KILLED with a counterexample --------------
$ce = 0; for ($n = 1; $n -le 600; $n++) { if ((DrPow 2 $n) -ne (DrPow 2 ($n + 5))) { $ce = $n; break } }
Ok ($ce -gt 0) "dr(2^n) period 5 -> FALSIFIED (counterexample n=$ce)"
$ce = 0; for ($n = 1; $n -le 600; $n++) { if ((DrMul 3 $n) -ne 3) { $ce = $n; break } }
Ok ($ce -gt 0) "dr(3n) == 3 constant -> FALSIFIED (counterexample n=$ce)"
$ce = 0; for ($n = 1; $n -le 600; $n++) { if ((DrPow 2 $n) -ne (DrPow 2 ($n + 4))) { $ce = $n; break } }
Ok ($ce -gt 0) "dr(2^n) period 4 -> FALSIFIED (counterexample n=$ce)"
$ce = 0; for ($n = 1; $n -le 180; $n++) { if ((FibMod $n 10) -ne (FibMod ($n + 30) 10)) { $ce = $n; break } }
Ok ($ce -gt 0) "fib(n) mod 10 period 30 -> FALSIFIED (real Pisano is 60)"

# ---- 3. validateClaim whitelist gate (mirror of the rules) -----------------
function ValidShape($c) {
  $templates = @('dr_periodic','dr_constant','mod_cycle')
  $gens = @('n','multiple','power','square','cube','triangular','fib')
  if ($null -eq $c) { return $false }
  if ($templates -notcontains $c.template) { return $false }
  if ($gens -notcontains $c.generator) { return $false }
  $p = $c.params
  if ($c.generator -eq 'multiple' -and -not ($p.k -ge 1 -and $p.k -le 10000)) { return $false }
  if ($c.generator -eq 'power' -and -not ($p.base -ge 2 -and $p.base -le 10000)) { return $false }
  if ($c.template -eq 'dr_periodic' -and -not ($p.period -ge 1 -and $p.period -le 100)) { return $false }
  if ($c.template -eq 'dr_constant' -and -not ($p.value -ge 1 -and $p.value -le 9)) { return $false }
  if ($c.template -eq 'mod_cycle' -and -not (($p.m -ge 2 -and $p.m -le 1000) -and ($p.period -ge 1 -and $p.period -le 100))) { return $false }
  return $true
}
Ok (ValidShape @{ template='dr_periodic'; generator='power'; params=@{ base=2; period=6 } })   "validate: well-formed power/dr_periodic -> accepted"
Ok (-not (ValidShape @{ template='energy_geometry'; generator='power'; params=@{ base=2 } })) "validate: bogus template 'energy_geometry' -> REJECTED"
Ok (-not (ValidShape @{ template='dr_periodic'; generator='vortex'; params=@{ period=6 } }))  "validate: bogus generator 'vortex' -> REJECTED"
Ok (-not (ValidShape @{ template='dr_constant'; generator='multiple'; params=@{ k=9; value=42 } })) "validate: dr value out of 1..9 -> REJECTED"
Ok (-not (ValidShape @{ template='power'; generator='power'; params=@{ base=2 } }))            "validate: template==generator garbage -> REJECTED"

# ---- 4. NARRATION honesty contract (static source check) -------------------
$src = Get-Content -Raw -Path (Join-Path $PSScriptRoot '..\lib\kernel-conjecture.js')
Ok ($src -match 'NOT a proof for all n')         "narration: held claim says 'NOT a proof for all n'"
Ok ($src -match 'never proven')                  "narration: explicitly 'never proven'"
Ok ($src -match 'stays speculative')             "narration: speculative leap stays speculative"
Ok ($src -notmatch 'proven for all|is now proven|is proven\b') "narration: never claims the target proven"
Ok ($src -match 'failed attempt')                "narration: falsified claim recorded as a failed attempt (data)"
Ok ($src -match "heldVerificationState[\s\S]{0,80}empirical") "honesty: held state capped at 'empirical' (never 'proven')"

Write-Output ("`n==== kernel-conjecture-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
