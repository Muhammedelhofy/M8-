# Phase 1.1 hardening — PS 5.1 mirror of the deterministic guards added to the wallet
# AI-stage (lib/orchestrator.js) + masking (lib/intent-router.js). The model call itself
# can't run offline (Node absent) — this covers the parts that DON'T need the model:
# digit-masking, deterministic amount parse, the "writes need a real number" gate,
# the numeric-sanity cap, and the long-paste length guard.
$ErrorActionPreference = 'Stop'

function Mask-Amounts([string]$s) { return ($s -replace '\d[\d.,]*', '#') }

# Mirror of parseAmountCurrency (digit path) + the orchestrator's `sane` check.
function Get-AmountCur([string]$s) {
  $mm = [regex]::Match($s, '(\d+(?:\.\d+)?)')
  if (-not $mm.Success) { return $null }
  $amt = [double]$mm.Groups[1].Value
  $cur = 'SAR'
  if ([regex]::IsMatch($s, '\b(egp|le|pound|pounds)\b', 'IgnoreCase')) { $cur = 'EGP' }
  [pscustomobject]@{ amount = $amt; currency = $cur }
}

# Mirror of the ADD branch decision: 'skip-gate' (too long), 'confirm <amt> <cur>', or 'clarify'.
function Decide-Add([string]$msg) {
  if ($msg.Length -gt 200) { return 'skip-gate' }
  $ac = Get-AmountCur $msg
  $sane = ($null -ne $ac) -and ($ac.amount -gt 0) -and ($ac.amount -le 1000000)
  if (-not $sane) { return 'clarify' }
  return "confirm $($ac.amount) $($ac.currency)"
}

# --- masking ---
$maskFail = 0
$maskCases = @(
  @{ inp = 'throw 30 egp to groceries'; want = 'throw # egp to groceries' }
  @{ inp = 'add 50 sar lunch';          want = 'add # sar lunch' }
  @{ inp = 'no numbers here';           want = 'no numbers here' }
)
foreach ($c in $maskCases) {
  $got = Mask-Amounts $c.inp
  if ($got -eq $c.want) { Write-Host "PASS mask: '$got'" } else { $maskFail++; Write-Host "FAIL mask: got '$got' want '$($c.want)'" }
}

# --- add-gate decision ---
$gateFail = 0
$gateCases = @(
  @{ msg = 'throw 30 egp to groceries';          want = 'confirm 30 EGP' }
  @{ msg = 'put down fifty riyals for lunch';    want = 'clarify' }          # spelled-out -> no digit -> ask
  @{ msg = 'add 50 sar lunch';                   want = 'confirm 50 SAR' }
  @{ msg = 'log 9999999 sar gift';               want = 'clarify' }          # absurd -> sanity cap
  @{ msg = ('please record my expense ' * 10);   want = 'skip-gate' }        # long paste (>200 chars)
)
foreach ($c in $gateCases) {
  $got = Decide-Add $c.msg
  if ($got -eq $c.want) { Write-Host "PASS gate: [$got] $($c.msg.Substring(0,[Math]::Min(34,$c.msg.Length)))" }
  else { $gateFail++; Write-Host "FAIL gate: got '$got' want '$($c.want)' :: $($c.msg.Substring(0,[Math]::Min(40,$c.msg.Length)))" }
}

$fail = $maskFail + $gateFail
Write-Host ''
if ($fail -eq 0) { Write-Host ("ALL {0} CASES PASSED" -f ($maskCases.Count + $gateCases.Count)) }
else { Write-Host ("{0} FAILURE(S)" -f $fail); exit 1 }
