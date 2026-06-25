# Build-153 — currency-convert PS-5.1 mirror (Node is absent on the host).
# Mirrors lib/orchestrator.js parseCurrencyConvert() (detection + target) and
# renderConvertedBreakdown() (the base→target math + total). Arabic cues use the
# SAME patterns and are covered by the live phone test (BUILD153_LIVE_TEST.md).

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
function Assert-Eq([string]$label, $expected, $actual) {
  if ("$expected" -eq "$actual") { $script:pass++ }
  else { $script:fail++; Write-Host ("  FAIL: {0}  expected=[{1}] actual=[{2}]" -f $label, $expected, $actual) -ForegroundColor Red }
}

# ── mirror of _curToken + parseCurrencyConvert (English) ──────────────────────
function Cur-Token([string]$s) {
  $t = ($s.ToLower()) -replace 's$',''
  if ($t -eq 'sar' -or $t -eq 'sr' -or $t -eq 'riyal') { return 'SAR' }
  if ($t -eq 'egp' -or $t -eq 'pound') { return 'EGP' }
  return $null
}
function Parse-ConvTarget([string]$m) {
  if ([string]::IsNullOrWhiteSpace($m) -or $m.Length -gt 160) { return $null }
  $low = $m.ToLower()
  $inTo = [regex]::Match($low, '\b(?:in|to|into|as)\s+(sar|sr|riyals?|egp|pounds?)\b')
  $target = $null
  if ($inTo.Success) { $target = Cur-Token $inTo.Groups[1].Value }
  if ([regex]::IsMatch($m, '\b(convert|unify|consolidat\w*)\b', 'IgnoreCase')) { if ($target) { return $target } else { return 'SAR' } }
  if ([regex]::IsMatch($m, '\b(?:one|single|same|unified)\s+currenc(?:y|ies)\b', 'IgnoreCase')) { if ($target) { return $target } else { return 'SAR' } }
  if ($target) {
    $cue = ([regex]::IsMatch($m, '\b(?:all|everything|put|show|give|make|express|breakdown|spend\w*|spent|total|expenses?|combine)\b','IgnoreCase')) -or `
           ([regex]::IsMatch($low, '^(?:in|to|into|as)\s+(?:sar|sr|riyals?|egp|pounds?)\b'))
    if ($cue) { return $target }
  }
  return $null
}

# ── mirror of renderConvertedBreakdown math ───────────────────────────────────
function To-Target([double]$amtBase, [string]$base, [string]$target, [double]$rate) {
  if ($target -eq $base) { return $amtBase }
  if ($base -eq 'SAR' -and $target -eq 'EGP') { return $amtBase * $rate }
  if ($base -eq 'EGP' -and $target -eq 'SAR') { return $amtBase / $rate }
  return $amtBase
}
function Fmt-Round([double]$n) { return [math]::Round($n, 0, [System.MidpointRounding]::AwayFromZero) }

Write-Host "`n=== Build-153 currency-convert mirror ===" -ForegroundColor Cyan

# ── A. detection: the conversion requests M8 must catch ───────────────────────
Write-Host "[A] conversion requests detected + target"
$A = @(
  @('put all currency in sar','SAR'),         # the exact phrase he typed
  @('convert to sar','SAR'),
  @('convert it to egp','EGP'),
  @('show it all in sar','SAR'),
  @('in sar','SAR'),
  @('one currency','SAR'),
  @('same currency please','SAR'),
  @('breakdown of my spend in sar','SAR'),
  @('how much did i spend in egp','EGP'),
  @('put it in egp','EGP'),
  @('give me everything in riyals','SAR')
)
foreach ($r in $A) { Assert-Eq ("detect: " + $r[0]) $r[1] ([string](Parse-ConvTarget $r[0])) }

# ── B. must NOT fire (no false steals) ────────────────────────────────────────
Write-Host "[B] non-conversion turns stay null"
$B = @(
  'how much did i spend in june',   # month, not a currency
  'did i pay rent in sar',          # payment check owns this (no conversion cue)
  'add 50 sar lunch',               # an add (digit) — caught upstream anyway
  "what's my last expense",
  'how are my drivers'
)
foreach ($m in $B) { Assert-Eq ("null: " + $m) '' ([string](Parse-ConvTarget $m)) }

# ── C. conversion math (his real breakdown, rate 13) ──────────────────────────
Write-Host "[C] base->target math + total"
# bd.base amounts already in SAR (as getCategoryBreakdown computes them)
$rate = 13.0
$cats = @(
  @{ category='Iqos';            base=300.0;     cur='SAR' },
  @{ category="Alia's clothes";  base=(3440.0/$rate); cur='EGP' },  # 264.6
  @{ category='Food';            base=80.0;      cur='SAR' },
  @{ category='Dining';          base=75.0;      cur='SAR' },
  @{ category="Marioma's gift";  base=(600.0/$rate);  cur='EGP' }   # 46.15
)
# total in SAR
$totSar = 0.0; foreach ($c in $cats) { $totSar += (To-Target $c.base 'SAR' 'SAR' $rate) }
Assert-Eq 'total all-in-SAR' 766 (Fmt-Round $totSar)            # 300+264.6+80+75+46.15 = 765.8 -> 766
Assert-Eq "Alia's clothes in SAR" 265 (Fmt-Round (To-Target ($cats[1].base) 'SAR' 'SAR' $rate))
Assert-Eq "Marioma's gift in SAR" 46  (Fmt-Round (To-Target ($cats[4].base) 'SAR' 'SAR' $rate))
# total in EGP (base SAR -> *rate)
$totEgp = 0.0; foreach ($c in $cats) { $totEgp += (To-Target $c.base 'SAR' 'EGP' $rate) }
Assert-Eq 'total all-in-EGP' 9955 (Fmt-Round $totEgp)          # 765.77 * 13 = 9955
Assert-Eq 'Iqos in EGP' 3900 (Fmt-Round (To-Target ($cats[0].base) 'SAR' 'EGP' $rate))

# ── D. mixed-currency note logic ──────────────────────────────────────────────
Write-Host "[D] rate note only when a real conversion happened"
$mixedYes = $false; foreach ($c in $cats) { if ($c.cur -ne 'SAR') { $mixedYes = $true } }
Assert-Eq 'mixed (has EGP) -> note' 'True' "$mixedYes"
$allSar = @(@{cur='SAR'}, @{cur='SAR'})
$mixedNo = $false; foreach ($c in $allSar) { if ($c.cur -ne 'SAR') { $mixedNo = $true } }
Assert-Eq 'all-SAR -> no note' 'False' "$mixedNo"

$summaryColor = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("`n=== RESULT: {0} passed, {1} failed ===" -f $script:pass, $script:fail) -ForegroundColor $summaryColor
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
