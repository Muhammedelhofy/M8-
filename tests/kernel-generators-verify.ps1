# tests/kernel-generators-verify.ps1
# PS-mirror of the NEW kernel-conjecture generators (Build-46): lucas, pentagonal,
# hexagonal. Confirms the digital-root math + the periodic patterns the engine would
# test. Pure modular arithmetic, tiny ranges, no big ints, no Lean. Pure ASCII.

$script:pass = 0
$script:fail = 0
function Ok($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else       { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

# digital root helpers (mirror digitalRootOfGen: value mod 9, 0 -> 9)
function DrFromVal($v) { $r = $v % 9; if ($r -eq 0) { return 9 } else { return $r } }
function DrPent($n) { return (DrFromVal ([int](($n * (3 * $n - 1)) / 2))) }
function DrHex($n)  { return (DrFromVal ([int]($n * (2 * $n - 1)))) }
function DrLucas($n) { $a = 2; $b = 1; for ($i = 1; $i -le $n; $i++) { $c = ($a + $b) % 9; $a = $b; $b = $c }; return (DrFromVal $a) }

# ---- pentagonal digital roots ------------------------------------------------
$pentExp = @(1,5,3,4,8,6,7,2,9,1)
$pentGot = @(); for ($n = 1; $n -le 10; $n++) { $pentGot += (DrPent $n) }
Ok 'pentagonal dr(1..10) = 1,5,3,4,8,6,7,2,9,1' (($pentGot -join ',') -eq ($pentExp -join ','))
$pp = $true; for ($n = 1; $n -le 60; $n++) { if ((DrPent $n) -ne (DrPent ($n + 9))) { $pp = $false; break } }
Ok 'pentagonal dr is periodic with period 9 (observed to 60)' $pp

# ---- hexagonal digital roots -------------------------------------------------
$hexExp = @(1,6,6,1,9,3,1,3,9,1)
$hexGot = @(); for ($n = 1; $n -le 10; $n++) { $hexGot += (DrHex $n) }
Ok 'hexagonal dr(1..10) = 1,6,6,1,9,3,1,3,9,1' (($hexGot -join ',') -eq ($hexExp -join ','))
$hp = $true; for ($n = 1; $n -le 60; $n++) { if ((DrHex $n) -ne (DrHex ($n + 9))) { $hp = $false; break } }
Ok 'hexagonal dr is periodic with period 9 (observed to 60)' $hp

# ---- lucas digital roots -----------------------------------------------------
Ok 'lucas dr(1..5) = 1,3,4,7,2' ((((1..5) | ForEach-Object { DrLucas $_ }) -join ',') -eq '1,3,4,7,2')
$lp24 = $true; for ($n = 1; $n -le 72; $n++) { if ((DrLucas $n) -ne (DrLucas ($n + 24))) { $lp24 = $false; break } }
Ok 'lucas dr is periodic with period 24 (observed to 72)' $lp24
# a SHORTER period should NOT hold (guards against a trivial/wrong period)
$lp6 = $true; for ($n = 1; $n -le 40; $n++) { if ((DrLucas $n) -ne (DrLucas ($n + 6))) { $lp6 = $false; break } }
Ok 'lucas dr is NOT period 6 (sanity: period must be the real 24)' (-not $lp6)

# ---- generator whitelist (mirror: the engine accepts these names) ------------
$gens = @('n','multiple','power','square','cube','triangular','fib','lucas','pentagonal','hexagonal')
Ok 'whitelist includes lucas'      ($gens -contains 'lucas')
Ok 'whitelist includes pentagonal' ($gens -contains 'pentagonal')
Ok 'whitelist includes hexagonal'  ($gens -contains 'hexagonal')

Write-Host ''
Write-Host ("kernel-generators-verify: {0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
