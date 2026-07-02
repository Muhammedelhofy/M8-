# Build-169a — follow-up gate on the wallet/fleet context lean
# PS 5.1 mirror of isBareFollowUp() + static checks that BOTH lean sites are gated.
# Evidence base: live misroutes 2026-07-02 (m8_router_misses + screenshots) —
# sports/weather/date questions hijacked by wallet_context/fleet_context (0.60).

$ErrorActionPreference = "Stop"
$pass = 0; $fail = 0
function Check([string]$name, [bool]$ok) {
  if ($ok) { $script:pass++; Write-Host "PASS  $name" }
  else     { $script:fail++; Write-Host "FAIL  $name" -ForegroundColor Red }
}

# ── mirror of isBareFollowUp (keep in sync with lib/domain-arbiter.js) ────────
$CONT_START = [regex]'^(?:and|also|ok(?:ay)?|now|then|so|what about|how about|طيب|كمان|وبعدين|و)\b'
$ANAPHOR    = [regex]'\b(?:it|that|this|these|those|them|same|instead|too|again|نفس|ده|دي|كده|هي|هو)\b'
function Is-BareFollowUp([string]$message) {
  $s = ([string]$message).Trim()
  if ($s.Length -eq 0) { return $false }
  $words = @($s -split '\s+' | Where-Object { $_.Length -gt 0 })
  if ($words.Count -le 3) { return $true }
  if ($words.Count -le 7) {
    if ($CONT_START.IsMatch($s.ToLower()) -or $ANAPHOR.IsMatch($s.ToLower())) { return $true }
  }
  return $false
}

# ── the LIVE misroutes must be gated (lean must NOT fire) ─────────────────────
Check "senegal question gated"  (-not (Is-BareFollowUp "What is the result of sengal vs Belgium in world cupt 2026 ?"))
Check "weather question gated"  (-not (Is-BareFollowUp "What is the weather in riyadh today"))
Check "date question gated"     (-not (Is-BareFollowUp "What date is today?"))
Check "world-cup pick gated"    (-not (Is-BareFollowUp "If i asked you to pick one country which one you will pick to win the world cup?"))
Check "notes question gated"    (-not (Is-BareFollowUp "Is there any notes or todo that i am missing ?"))

# ── real follow-ups must still lean (the reason the lean exists) ──────────────
Check "'In EGP' leans"              (Is-BareFollowUp "In EGP")
Check "'now in sar' leans"          (Is-BareFollowUp "now in sar")
Check "'what's the breakdown?' leans" (Is-BareFollowUp "what's the breakdown?")
Check "'what about last week?' leans" (Is-BareFollowUp "what about last week?")
Check "'and for sara?' leans"       (Is-BareFollowUp "and for sara?")
Check "'make that june instead' leans" (Is-BareFollowUp "make that june instead")
Check "arabic tayeb leans"          (Is-BareFollowUp ("طيب " + "وشهر يونيه كله ؟"))
Check "empty string false"          (-not (Is-BareFollowUp ""))

# ── static checks on the JS ───────────────────────────────────────────────────
$root = Split-Path -Parent $PSScriptRoot
$js = Get-Content (Join-Path $root "lib\domain-arbiter.js") -Raw

Check "s1 kill switch M8_LEAN_GATE"     ($js.Contains("M8_LEAN_GATE"))
Check "s2 isBareFollowUp defined"       ($js.Contains("function isBareFollowUp"))
Check "s3 exported for tests"           ($js.Contains("isBareFollowUp, // Build-169a"))
$gatedCount = ([regex]::Matches($js, 'why: "lean_gated"')).Count
Check "s4 BOTH lean sites gated"        ($gatedCount -eq 2)
$leanAllowedCalls = ([regex]::Matches($js, 'leanAllowed\(s\)')).Count
Check "s5 both sites call leanAllowed"  ($leanAllowedCalls -eq 2)
# the gate must sit BEFORE the walletRef/fleetRef leans at both sites
$orderOk = $true
foreach ($m in [regex]::Matches($js, '(?s)leanAllowed\(s\).{0,400}?opts\.walletRef')) { }
if (([regex]::Matches($js, '(?s)if \(!leanAllowed\(s\)\)[^\r\n]*\r?\n\s*if \(opts\.walletRef\)')).Count -ne 2) { $orderOk = $false }
Check "s6 gate precedes the lean (x2)"  $orderOk

# ── B-169b static checks (downstream lanes must respect the gate) ─────────────
$fleet = Get-Content (Join-Path $root "lib\fleet.js") -Raw
$orch2 = Get-Content (Join-Path $root "lib\orchestrator.js") -Raw

Check "b1 wallet-sentinel skip in recentlyDiscussedFleet" ($fleet.Contains("_MONEY_REPLY_SENTINEL"))
Check "b2 sentinel skip is assistant-only"                ($fleet.Contains('m.role === "assistant" && m.content.indexOf(_MONEY_REPLY_SENTINEL)'))
Check "b3 date-only fleet follow-up gated"                ($fleet.Contains("!!dateRef && _dateFollowOk"))
Check "b4 fleet gate shares the M8_LEAN_GATE kill switch" (([regex]::Matches($fleet, "M8_LEAN_GATE")).Count -ge 1)
Check "b5 fleet gate fails OPEN on require error"         ($fleet.Contains("catch (_) { return true; }"))
Check "b6 wallet lanes veto lean_gated turns"             ($orch2.Contains('arb.why === "lean_gated"') -and $orch2.Contains("return null"))
# the veto must sit inside handleWalletCommand, right after the B-157 fleet/finance gate
$vetoPlaced = ([regex]::Matches($orch2, '(?s)arb\.domain === "fleet" \|\| arb\.domain === "finance"\)\) return null;.{0,700}?lean_gated.{0,80}?return null;')).Count
Check "b7 veto placed after the B-157 central gate"       ($vetoPlaced -eq 1)
# regression guards: range/verb-phrase fleet follow-ups must NOT be gated
Check "b8 range follow-up leg untouched"                  ($fleet.Contains("rangeRef(message) || hasVerbCands"))

Write-Host ""
Write-Host ("RESULT: {0} passed, {1} failed" -f $pass, $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
