# Build-152 — domain-arbiter PS-5.1 mirror (Node is absent on the host).
# Mirrors lib/domain-arbiter.js: walletSignal() + the arbitrate() decision tree +
# pickedDomain(). The LLM leg can't run here, so a CONTEST with the model disabled
# resolves to "ask" (exactly the JS fallback). looksFleet() is already-tested code,
# so each corpus row SUPPLIES the fleet verdict it would return (the test boundary
# is the arbiter's NEW logic, not a re-implementation of the fleet detector).
#
# Scope: English corpus (robust under PS-5.1 file encoding). Arabic phrasings use
# the SAME regexes and are covered by the live phone test (BUILD152_LIVE_TEST.md).

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0

function Assert-Eq([string]$label, $expected, $actual) {
  if ("$expected" -eq "$actual") {
    $script:pass++
  } else {
    $script:fail++
    Write-Host ("  FAIL: {0}`n        expected=[{1}] actual=[{2}]" -f $label, $expected, $actual) -ForegroundColor Red
  }
}

# ── mirror of walletSignal() ──────────────────────────────────────────────────
$WALLET_STRONG = '\bmy\s+(spend(?:ing)?|expenses?|wallet|budget|bills?|transactions?)\b|\b(?:did|do|does|how much did)\s+i\s+(?:spend|spent|pay|paid)\b|\bi\s+(?:spent|paid)\b|\bmy\s+(?:last|recent|latest)\s+(?:expense|transaction|purchase)\b'
$WALLET_PRESENT = '\b(expenses?|wallet|spending|budget|bills?)\b|\bspent\b|\bspend\b(?!\s+(?:time|the\s+night|the\s+day))'

function Get-WalletSignal([string]$msg) {
  $strong  = [regex]::IsMatch($msg, $WALLET_STRONG, 'IgnoreCase')
  $present = $strong -or [regex]::IsMatch($msg, $WALLET_PRESENT, 'IgnoreCase')
  return [pscustomobject]@{ present = $present; strong = $strong }
}

# ── mirror of arbitrate() decision tree ───────────────────────────────────────
# $llm: $null (disabled/no call) OR 'wallet'/'fleet'/'other' (simulated model)
function Get-ArbDomain([string]$msg, [bool]$fleet, [bool]$memberHit, [bool]$walletRef, [bool]$fleetRef, $llm) {
  $w = Get-WalletSignal $msg
  # A bare household name counts as a wallet hint only when NO fleet signal is present
  # (mirrors lib/domain-arbiter.js — prevents a false contest / needless ASK).
  $wPresent = $w.present -or ($memberHit -and (-not $fleet))
  $wStrong  = $w.strong  -or ($memberHit -and (-not $fleet))

  if ($wPresent -and (-not $fleet)) { return 'wallet' }
  if ($fleet -and (-not $wPresent)) { return 'fleet' }
  if ((-not $wPresent) -and (-not $fleet)) {
    if ($walletRef) { return 'wallet' }   # most-recent turn wins (last turn was wallet)
    if ($fleetRef)  { return 'fleet' }
    return 'neutral'
  }
  # contest: both signals present
  if ($wStrong) { return 'wallet' }
  if (($llm -eq 'wallet') -or ($llm -eq 'fleet')) { return $llm }
  return 'ask'
}

# ── mirror of pickedDomain() ──────────────────────────────────────────────────
$PICK_WALLET = '^\s*(?:my\s+)?(?:personal\s+)?wallet\b|^\s*personal\b|^\s*(?:my\s+)?expenses?\b'
$PICK_FLEET  = '^\s*(?:the\s+)?fleet\b|^\s*drivers?\b|^\s*business\b'
function Get-PickedDomain([string]$msg) {
  $s = $msg.Trim()
  if ($s.Length -gt 40) { return $null }
  if ([regex]::IsMatch($s, $PICK_FLEET, 'IgnoreCase'))  { return 'fleet' }
  if ([regex]::IsMatch($s, $PICK_WALLET, 'IgnoreCase')) { return 'wallet' }
  return $null
}

Write-Host "`n=== Build-152 arbiter mirror ===" -ForegroundColor Cyan

# ── A. The documented failures (the whole point of this build) ────────────────
Write-Host "`n[A] documented wallet->fleet misroutes now route to WALLET"
# msg, fleet(looksFleet), memberHit, walletRef, fleetRef, llm, expect
$A = @(
  @('breakdown of my spend in june',                 $false,$false,$false,$false,$null,'wallet'),
  @('what is my spend in june',                      $false,$false,$false,$false,$null,'wallet'),
  @('how much did Sara spend in june',               $false,$true, $false,$false,$null,'wallet'),
  @('what is my total expense in june',              $false,$false,$false,$false,$null,'wallet'),
  @('how much did I spend this month',               $false,$false,$false,$false,$null,'wallet'),
  @('what is my last expense',                       $false,$false,$false,$false,$null,'wallet'),
  @('am talking about my wallet what is the breakdown of my spend in june', $false,$false,$false,$false,$null,'wallet')
)
foreach ($r in $A) { Assert-Eq $r[0] $r[6] (Get-ArbDomain $r[0] $r[1] $r[2] $r[3] $r[4] $r[5]) }

# ── B. Anaphora: "what's the breakdown?" after a wallet vs fleet answer ────────
Write-Host "[B] bare anaphora leans to the domain on screen"
$B = @(
  @('breakdown of the 497 sar',  $false,$false,$true, $false,$null,'wallet'),  # after a wallet total
  @("what's the breakdown",      $false,$false,$true, $false,$null,'wallet'),  # wallet on screen
  @("what's the breakdown",      $false,$false,$false,$true, $null,'fleet'),   # fleet on screen
  @('i want to see the amounts in sar', $false,$false,$true,$true,$null,'wallet'), # BUG: last turn wallet wins over an earlier fleet brief still in window
  @('give me the breakdown',     $false,$false,$false,$false,$null,'neutral')  # fresh -> wallet lane asks
)
foreach ($r in $B) { Assert-Eq ("anaphora: " + $r[0]) $r[6] (Get-ArbDomain $r[0] $r[1] $r[2] $r[3] $r[4] $r[5]) }

# ── C. Contest (both signals): strong-wallet wins; else model; else ASK ───────
Write-Host "[C] genuine wallet<->fleet contests"
$C = @(
  @('breakdown of my spend vs the fleet',         $true,$false,$false,$false,$null,   'wallet'), # "my spend" strong -> wallet
  @('how did we do on spending and driver costs', $true,$false,$false,$false,$null,   'ask'),    # contest, no model -> ask
  @('how did we do on spending and driver costs', $true,$false,$false,$false,'wallet','wallet'), # model breaks the tie
  @('how did we do on spending and driver costs', $true,$false,$false,$false,'fleet', 'fleet')
)
foreach ($r in $C) { Assert-Eq ("contest: " + $r[0]) $r[6] (Get-ArbDomain $r[0] $r[1] $r[2] $r[3] $r[4] $r[5]) }

# ── D. No regression: fleet + non-money stay exactly as before (neutral/fleet) ─
Write-Host "[D] fleet + general turns unaffected"
$D = @(
  @('how are my drivers doing',  $true, $false,$false,$false,$null,'fleet'),
  @('net earnings yesterday',    $true, $false,$false,$false,$null,'fleet'),
  @("how's the fleet this week", $true, $false,$false,$false,$null,'fleet'),
  @('Sara called me about the drivers', $true,$true,$false,$false,$null,'fleet'), # name+fleet, no money word -> NOT an over-ask
  @('good morning',              $false,$false,$false,$false,$null,'neutral'),
  @('who is the president of egypt', $false,$false,$false,$false,$null,'neutral'),
  @('remind me to call ahmad',   $false,$false,$false,$false,$null,'neutral')
)
foreach ($r in $D) { Assert-Eq ("noregress: " + $r[0]) $r[6] (Get-ArbDomain $r[0] $r[1] $r[2] $r[3] $r[4] $r[5]) }

# ── E. walletSignal strength is correct ───────────────────────────────────────
Write-Host "[E] walletSignal present/strong"
Assert-Eq 'strong: my spend'        'True' (Get-WalletSignal 'my spend in june').strong
Assert-Eq 'strong: i paid'          'True' (Get-WalletSignal 'i paid 50 for lunch').strong
Assert-Eq 'strong: my last expense' 'True' (Get-WalletSignal 'what is my last expense').strong
Assert-Eq 'present-not-strong: expenses' 'True'  (Get-WalletSignal 'show expenses').present
Assert-Eq 'present-not-strong: expenses (not strong)' 'False' (Get-WalletSignal 'show expenses').strong
Assert-Eq 'no-signal: spend time'   'False' (Get-WalletSignal 'i want to spend time with family').present
Assert-Eq 'no-signal: drivers'      'False' (Get-WalletSignal 'how are the drivers').present

# ── F. clarifier follow-up parsing ────────────────────────────────────────────
Write-Host "[F] pickedDomain after a clarifier"
Assert-Eq 'pick wallet'        'wallet' (Get-PickedDomain 'wallet')
Assert-Eq 'pick my wallet'     'wallet' (Get-PickedDomain 'my wallet')
Assert-Eq 'pick personal'      'wallet' (Get-PickedDomain 'personal')
Assert-Eq 'pick fleet'         'fleet'  (Get-PickedDomain 'the fleet')
Assert-Eq 'pick drivers'       'fleet'  (Get-PickedDomain 'drivers')
Assert-Eq 'pick none (long)'   ''       ([string](Get-PickedDomain 'actually can you show me everything across both please'))

# ── summary ───────────────────────────────────────────────────────────────────
$summaryColor = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("`n=== RESULT: {0} passed, {1} failed ===" -f $script:pass, $script:fail) -ForegroundColor $summaryColor
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
