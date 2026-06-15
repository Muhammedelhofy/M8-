# tests/nearest-true-verify.ps1
# PS-mirror of lib/kernel-conjecture.js nearestTrueFromLiteral (Build-43 Option-B
# follow-up #1): for a BARE false digital-root claim, M8 must ALWAYS still derive a
# constructive nearest-TRUE pattern from the user's OWN generator (no LLM). Mirror the
# digital-root computation + the constant-or-set selection + the holds check.
# Pure ASCII; flat inline loops.

$script:pass = 0
$script:fail = 0
function Ok($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else       { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

# digital root of k*n : ((k*n) mod 9) with 0 -> 9
function DrMultiple($k, $n) { $r = (($k % 9) * ($n % 9)) % 9; if ($r -eq 0) { return 9 } else { return $r } }

# Derive the nearest-true pattern (constant-or-set) from generator 'multiple' k.
# Returns @{ template; set } ; then assert holds over the bound by re-scanning.
function NearestTrue($k, $bound) {
  $seen = @{}
  $cap = [Math]::Min($bound, 5000)
  for ($n = 1; $n -le $cap; $n++) { $seen[(DrMultiple $k $n)] = 1 }
  $set = @($seen.Keys | Sort-Object)
  if ($set.Count -eq 1) { return [pscustomobject]@{ template = 'dr_constant'; set = $set } }
  return [pscustomobject]@{ template = 'dr_set'; set = $set }
}
# Confirm a dr_set claim HOLDS over [1..bound].
function HoldsSet($k, $set, $bound) {
  $cap = [Math]::Min($bound, 5000)
  $lookup = @{}; foreach ($v in $set) { $lookup[$v] = 1 }
  for ($n = 1; $n -le $cap; $n++) { if (-not $lookup.ContainsKey((DrMultiple $k $n))) { return $false } }
  return $true
}

# Case: "dr of 3n is always 3" (FALSE). Nearest true = dr_set {3,6,9}.
$nt3 = NearestTrue 3 1000
Ok 'dr(3n): nearest-true is a SET (not constant)' ($nt3.template -eq 'dr_set')
Ok 'dr(3n): observed set is {3,6,9}' (($nt3.set -join ',') -eq '3,6,9')
Ok 'dr(3n): the {3,6,9} set claim HOLDS to N' (HoldsSet 3 $nt3.set 1000)
Ok 'dr(3n): the literal "always 3" is FALSE (6 appears at n=2)' ((DrMultiple 3 2) -eq 6)

# Case: "dr of 9n is always 9" (TRUE constant). Nearest true = dr_constant {9}.
$nt9 = NearestTrue 9 1000
Ok 'dr(9n): nearest-true collapses to a CONSTANT' ($nt9.template -eq 'dr_constant')
Ok 'dr(9n): the constant is 9' (($nt9.set -join ',') -eq '9')

# Case: "dr of 6n" visits {3,6,9} as well (6,3,9,6,3,9,...) -> a set.
$nt6 = NearestTrue 6 1000
Ok 'dr(6n): nearest-true is a SET' ($nt6.template -eq 'dr_set')
Ok 'dr(6n): set is {3,6,9}' (($nt6.set -join ',') -eq '3,6,9')
Ok 'dr(6n): set claim HOLDS to N' (HoldsSet 6 $nt6.set 1000)

Write-Host ''
Write-Host ("nearest-true-verify: {0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
