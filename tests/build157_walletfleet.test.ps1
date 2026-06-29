# tests/build157_walletfleet.test.ps1
# Build-157 — WALLET⇄FLEET EXECUTION GATE — PS-5.1 mirror (Node is absent on the host).
#
# THE BUG (live 2026-06-29): the front-door arbiter (B-152) / registry (B-155) routed three
# clearly-FLEET questions to `fleet`, but newer wallet sub-lanes (income/net B-141,
# expense-by-date B-138) were added AFTER B-152 with NO per-lane fleet guard, so
# handleWalletCommand answered them with the owner's PERSONAL money.
#
# THE FIX (lib/orchestrator.js):
#   • CENTRAL GATE at the top of handleWalletCommand:
#       if (arb && (arb.domain === "fleet" || arb.domain === "finance")) return null;
#     → one decision, enforced once, for EVERY wallet sub-lane + BOTH dispatch sites.
#   • V2 FLIP (resolveDomainRoute, behind M8_REGISTRY_CRUD, default OFF): a CLEAR registry
#     winner in {wallet, fleet, finance} REPLACES the arbiter call; an "ask" contest clarifies.
#
# WHAT THIS MIRRORS (the test boundary is the NEW routing logic, not the JS engines):
#   • Get-ArbDomain  — verbatim mirror of domain-arbiter.arbitrate() (from build152_arbiter).
#   • Decide-Registry— verbatim mirror of capability-registry.scoreMessage/pickDomain +
#                       domain-arbiter.classifyAll() deterministic decision (from build155).
#   • Test-WalletAbstains / Get-CrudArb — the NEW B-157 gate + flip.
# looksFleet() is already-tested code (lib/fleet.js), so each row SUPPLIES the fleet verdict
# it returns. For the 3 bug rows looksFleet is TRUE (isFleetQuery lowercases; "drivers"/"fleet"
# match, and "net earnings?" matches "net earning"). Arabic phrasings use the same regexes and
# are covered by the live phone test.

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
function Assert-Eq([string]$label, $expected, $actual) {
  if ("$expected" -eq "$actual") { $script:pass++ }
  else {
    $script:fail++
    Write-Host ("  FAIL: {0}`n        expected=[{1}] actual=[{2}]" -f $label, $expected, $actual) -ForegroundColor Red
  }
}

# ═══ 1. ARBITER MIRROR (verbatim from build152_arbiter.test.ps1) ════════════════
$WALLET_STRONG = '\bmy\s+(spend(?:ing)?|expenses?|wallet|budget|bills?|transactions?)\b|\b(?:did|do|does|how much did)\s+i\s+(?:spend|spent|pay|paid)\b|\bi\s+(?:spent|paid)\b|\bmy\s+(?:last|recent|latest)\s+(?:expense|transaction|purchase)\b'
$WALLET_PRESENT = '\b(expenses?|wallet|spending|budget|bills?)\b|\bspent\b|\bspend\b(?!\s+(?:time|the\s+night|the\s+day))'

function Get-WalletSignal([string]$msg) {
  $strong  = [regex]::IsMatch($msg, $WALLET_STRONG, 'IgnoreCase')
  $present = $strong -or [regex]::IsMatch($msg, $WALLET_PRESENT, 'IgnoreCase')
  return [pscustomobject]@{ present = $present; strong = $strong }
}

# $llm: $null (disabled/no call) OR 'wallet'/'fleet' (simulated model)
function Get-ArbDomain([string]$msg, [bool]$fleetLike, [bool]$memberHit, [bool]$walletRef, [bool]$fleetRef, $llm) {
  $w = Get-WalletSignal $msg
  $wPresent = $w.present -or ($memberHit -and (-not $fleetLike))
  $wStrong  = $w.strong  -or ($memberHit -and (-not $fleetLike))
  if ($wPresent -and (-not $fleetLike)) { return 'wallet' }
  if ($fleetLike -and (-not $wPresent)) { return 'fleet' }
  if ((-not $wPresent) -and (-not $fleetLike)) {
    if ($walletRef) { return 'wallet' }
    if ($fleetRef)  { return 'fleet' }
    return 'neutral'
  }
  if ($wStrong) { return 'wallet' }
  if (($llm -eq 'wallet') -or ($llm -eq 'fleet')) { return $llm }
  return 'ask'
}

# ═══ 2. REGISTRY MIRROR (verbatim from build155_registry.test.ps1) ══════════════
$opt = [Text.RegularExpressions.RegexOptions]::IgnoreCase
function Rgx([string]$p) { return [Text.RegularExpressions.Regex]::new($p, $opt) }
$R_WALLET_STRONG         = Rgx('\bmy\s+(spend(?:ing)?|expenses?|wallet|budget|bills?|transactions?|money)\b|\b(?:did|do|does|how much did)\s+i\s+(?:spend|spent|pay|paid)\b|\bi\s+(?:spent|paid)\b|\bmy\s+(?:last|recent|latest)\s+(?:expenses?|transactions?|purchases?)\b|\b(?:did|have|has)\s+\w+\s+pa(?:y|id)\b|\b(?:paid|pay)\s+(?:the\s+|for\s+|my\s+|our\s+)?(?:rent|electricity|water|internet|bills?|fees?|school\s+fees?|tuition|subscription|installment)\b')
$R_WALLET_PRESENT        = Rgx('\b(expenses?|wallet|spending|budget|bills?)\b|\bspent\b|\bspend\b(?!\s+(?:time|the\s+night|the\s+day|the\s+weekend))')
$R_DRIVER_PROFILE_STRONG = Rgx('\bdriver\s+profiles?\b|\b(?:set|update)\s+\w+(?:''s)?\s+(?:rental|salary|fuel)\b')
$R_FINANCE_STRONG        = Rgx('\bp\s*&\s*l\b|\bpnl\b|\bprofit\w*\b|\b(?:net\s+|gross\s+)?margin\b|\brevenue\b|\boperating\s+(?:costs?|expenses?)\b|\bunit\s+economics\b|\bbreak[\s-]?even\b|\bbottom\s+line\b|\bcost\s+per\s+order\b|\bfinancial\s+(?:situation|health|analysis)\b')
$R_FLEET_STRONG          = Rgx('\b(drivers?|captains?|couriers?|fleet|riders?)\b')
$R_FLEET_PRESENT         = Rgx('\b(bikes?|motorbikes?|utili[sz]ation|acceptance\s+rate|payroll|earnings|tier|bonus|cash\s+collection|morning\s+brief|daily\s+brief|fleet\s+brief|active\s+drivers?|[56]k\s+target)\b')
$R_TASK_PRESENT          = Rgx('\b(tasks?|reminders?|to-?dos?)\b|\bremind\s+me\b|\b(?:on\s+)?my\s+(?:to-?do\s+)?list\b')
$R_NOTE_STRONG           = Rgx('\b(?:search|check|find\s+in|look\s+in)\s+my\s+notes?\b|^\s*note\s*:|\b(?:take|make|add|leave|write|jot)\s+(?:a\s+|this\s+)?note\b|\bjot\s+(?:this\s+)?down\b')
$R_NOTE_PRESENT          = Rgx('\bnotes?\b|\bnote\s+(?:that|down|about)\b|\b(?:fyi|for\s+the\s+record)\b|\bremember\s+that\b')
$R_KNOWLEDGE_STRONG      = Rgx('\bsearch\s+my\s+(?:books?|docs?|documents?|sources?|cv|resume|knowledge)\b|\bwhat\s+(?:does|do|did)\s+[\w\s]{1,30}?\s+say\s+about\b|\baccording\s+to\s+(?:my\s+)?(?:books?|sources?|cv)\b|\bin\s+my\s+(?:cv|resume|books?|documents?)\b|\bmy\s+cv\b')
$R_MEMORY_PRESENT        = Rgx('\b(?:who\s+(?:is|was|are)|tell\s+me\s+about|what\s+do\s+(?:you|we)\s+know\s+about|do\s+you\s+(?:remember|recall)|what\s+did\s+i\s+(?:say|tell\s+you)\s+about|remind\s+me\s+(?:who|what|about))\b|\bmy\s+(?:wife|husband|brother|sister|son|daughter|mother|father|friend|colleague|boss)\b')
$R_DOCS_STRONG           = Rgx('\b(make|create|write|draft|build|generate|prepare|design|put\s+together|give\s+me|i\s+need)\b.{0,40}\b(plan|brief|summary|report|deck|slides?|presentation|proposal|outline|document|memo|agenda|one[-\s]?pager|action\s+plan|checklist)\b|\b(slide\s+deck|pitch\s+deck|power\s?point)\b')
$R_WEB_PRESENT           = Rgx('\b(weather|temperature|forecast|humidity)\b|\b(scores?|who\s+won|match(?:es)?|fixtures?|standings)\b|\b(exchange\s+rate|stock\s+price|share\s+price|price\s+of)\b|\b(flights?|hotels?|airbnb)\b|\b(latest|recent|breaking)\s+(?:news|updates?)\b|\bnews\b|\b(near(?:by|est)?|closest)\b|\bwho\s+(?:founded|owns|invented|acquired)\b')
$DOMAINS = @('driver_profile','knowledge','docs','notes','tasks','wallet','finance','fleet','memory','web','chat')

function Score-Message([string]$s) {
  $sc = [ordered]@{}; foreach ($d in $DOMAINS) { $sc[$d] = 0 }
  if ($R_DRIVER_PROFILE_STRONG.IsMatch($s)) { $sc['driver_profile'] = 2 }
  if ($R_KNOWLEDGE_STRONG.IsMatch($s))      { $sc['knowledge'] = 2 }
  if ($R_DOCS_STRONG.IsMatch($s))           { $sc['docs'] = 2 }
  if     ($R_NOTE_STRONG.IsMatch($s))       { $sc['notes'] = 2 } elseif ($R_NOTE_PRESENT.IsMatch($s)) { $sc['notes'] = 1 }
  if ($R_TASK_PRESENT.IsMatch($s))          { $sc['tasks'] = 1 }
  if     ($R_WALLET_STRONG.IsMatch($s))     { $sc['wallet'] = 2 } elseif ($R_WALLET_PRESENT.IsMatch($s)) { $sc['wallet'] = 1 }
  if ($R_FINANCE_STRONG.IsMatch($s))        { $sc['finance'] = 2 }
  if     ($R_FLEET_STRONG.IsMatch($s))      { $sc['fleet'] = 2 } elseif ($R_FLEET_PRESENT.IsMatch($s)) { $sc['fleet'] = 1 }
  if ($R_MEMORY_PRESENT.IsMatch($s))        { $sc['memory'] = 1 }
  if ($R_WEB_PRESENT.IsMatch($s))           { $sc['web'] = 1 }
  return $sc
}
function Pick-Domain($sc) {
  $best = 'chat'; $bestScore = 0; $second = $null; $secondScore = 0
  foreach ($d in $DOMAINS) {
    $v = [int]$sc[$d]
    if ($v -gt $bestScore) { $second = $best; $secondScore = $bestScore; $best = $d; $bestScore = $v }
    elseif (($v -gt $secondScore) -and ($d -ne $best)) { $second = $d; $secondScore = $v }
  }
  if ($bestScore -eq 0) { return @{ domain = 'chat'; ambiguous = $false } }
  $amb = ($secondScore -eq $bestScore) -and $second -and ($second -ne $best)
  return @{ domain = $best; ambiguous = [bool]$amb }
}

# Mirror of classifyAll()'s DETERMINISTIC decision, taking the SAME explicit hints
# resolveDomainRoute passes (fleetSignal = the REAL looksFleet, memberHit, walletRef, fleetRef).
function Decide-Registry([string]$msg, [bool]$fleetLike, [bool]$memberHit, [bool]$walletRef, [bool]$fleetRef) {
  $sc = Score-Message $msg
  if ($fleetLike) { $sc['fleet'] = [Math]::Max([int]$sc['fleet'], 2) }
  if ($memberHit -and -not $fleetLike) { $sc['wallet'] = [Math]::Max([int]$sc['wallet'], 2) }
  if (([int]$sc['wallet'] -gt 0) -and ([int]$sc['fleet'] -gt 0)) {
    if ([int]$sc['wallet'] -ge 2) { return @{ domain = 'wallet'; ambiguous = $false } }
    return @{ domain = 'ask'; ambiguous = $true }
  }
  $pick = Pick-Domain $sc
  if ($pick.domain -eq 'chat') {
    if ($walletRef) { return @{ domain = 'wallet'; ambiguous = $false } }
    if ($fleetRef)  { return @{ domain = 'fleet';  ambiguous = $false } }
    return @{ domain = 'chat'; ambiguous = $false }
  }
  return @{ domain = $pick.domain; ambiguous = $pick.ambiguous }
}

# ═══ 3. THE NEW B-157 LOGIC ═════════════════════════════════════════════════════
# Central gate: lib/orchestrator.js handleWalletCommand top —
#   if (arb && (arb.domain === "fleet" || arb.domain === "finance")) return null;
# Returns $true when the wallet handler ABSTAINS (returns null → fleet/finance path runs).
function Test-WalletAbstains([string]$arbDomain) {
  return ($arbDomain -eq 'fleet') -or ($arbDomain -eq 'finance')
}
# V2 flip: resolveDomainRoute under M8_REGISTRY_CRUD — a clear registry wallet/fleet/finance
# winner (or an "ask" contest) REPLACES arb; otherwise arb is left intact.
function Get-CrudArb([string]$arbDomain, $reg) {
  if ($reg.domain -eq 'ask') { return 'ask' }
  if ((-not $reg.ambiguous) -and (($reg.domain -eq 'wallet') -or ($reg.domain -eq 'fleet') -or ($reg.domain -eq 'finance'))) {
    return $reg.domain
  }
  return $arbDomain
}

Write-Host "`n=== Build-157 wallet/fleet execution gate ===" -ForegroundColor Cyan

# ── [A] THE 3 LIVE-BUG FLEET PHRASINGS → fleet AND the wallet handler ABSTAINS ───
# Default arbiter path (M8_REGISTRY_CRUD OFF). Columns: msg, looksFleet, memberHit,
# walletRef, fleetRef, llm, (then asserted: arb='fleet' AND abstains=True).
Write-Host "`n[A] the 3 documented fleet questions now reach the FLEET path"
$A = @(
  @('how many drivers in the bolt fleet already exceeded net earning of 4000 sar this month', $true,$false,$false,$false,$null), # B-141 income/net lane used to steal it
  @('i want net earning in all june',                                $true, $false,$false,$true, $null),  # looksFleet via "net earning"; also fleetRef after "fleet numbers"
  @('total net earning per driver from 1st of june till 28th of june',$true, $false,$false,$false,$null)  # B-138 expense-by-date lane used to steal it ("Total expenses on Jun 1: 0 SAR")
)
foreach ($r in $A) {
  $d = Get-ArbDomain $r[0] $r[1] $r[2] $r[3] $r[4] $r[5]
  Assert-Eq ("arb=fleet: " + $r[0])      'fleet' $d
  Assert-Eq ("abstains:  " + $r[0])      'True'  (Test-WalletAbstains $d)
}
# the context-only variant of #2 ("after fleet numbers", looksFleet false) still → fleet
$d2 = Get-ArbDomain 'i want net earning in all june' $false $false $false $true $null
Assert-Eq 'arb=fleet (context): i want net earning in all june' 'fleet' $d2
Assert-Eq 'abstains  (context): i want net earning in all june' 'True'  (Test-WalletAbstains $d2)

# ── [B] THE 4 WORKING WALLET QUERIES → wallet AND the handler does NOT abstain ───
Write-Host "[B] the working wallet queries are UNCHANGED (must-not-regress)"
$B = @(
  @("tell me sara's last expense",          $false,$true, $false,$false,$null),  # member + "expense"
  @('her total in june',                    $false,$false,$true, $false,$null),  # anaphora: last turn was wallet
  @('give me the breakdown highest to lowest',$false,$false,$true,$false,$null), # anaphora: last turn was wallet
  @('what is my spend in june',             $false,$false,$false,$false,$null)   # "my spend" strong-wallet
)
foreach ($r in $B) {
  $d = Get-ArbDomain $r[0] $r[1] $r[2] $r[3] $r[4] $r[5]
  Assert-Eq ("arb=wallet:  " + $r[0])     'wallet' $d
  Assert-Eq ("proceeds:    " + $r[0])     'False'  (Test-WalletAbstains $d)
}

# ── [C] CENTRAL-GATE TRUTH TABLE (the literal new guard) ────────────────────────
Write-Host "[C] central gate: fleet/finance abstain; wallet/neutral proceed"
Assert-Eq 'gate fleet -> abstain'   'True'  (Test-WalletAbstains 'fleet')
Assert-Eq 'gate finance -> abstain' 'True'  (Test-WalletAbstains 'finance')
Assert-Eq 'gate wallet -> proceed'  'False' (Test-WalletAbstains 'wallet')
Assert-Eq 'gate neutral -> proceed' 'False' (Test-WalletAbstains 'neutral')
# 'ask' never reaches the gate (resolveDomainRoute returns the clarifier before
# handleWalletCommand is called), so the gate's behaviour on it is irrelevant.

# ── [D] V2 REGISTRY FLIP (M8_REGISTRY_CRUD=1) — same 7 rows + finance + contest ──
Write-Host "[D] registry flip routes the SAME way (and adds finance/contest coverage)"
# 3 fleet rows → registry 'fleet' → flipped arb 'fleet' → abstains
foreach ($r in $A) {
  $reg = Decide-Registry $r[0] $r[1] $r[2] $r[3] $r[4]
  Assert-Eq ("reg=fleet:   " + $r[0]) 'fleet' $reg.domain
  $flip = Get-CrudArb 'neutral' $reg
  Assert-Eq ("flip abstains: " + $r[0]) 'True' (Test-WalletAbstains $flip)
}
# 4 wallet rows → registry 'wallet' → flipped arb 'wallet' → proceeds
foreach ($r in $B) {
  $reg = Decide-Registry $r[0] $r[1] $r[2] $r[3] $r[4]
  Assert-Eq ("reg=wallet:  " + $r[0]) 'wallet' $reg.domain
  $flip = Get-CrudArb 'neutral' $reg
  Assert-Eq ("flip proceeds: " + $r[0]) 'False' (Test-WalletAbstains $flip)
}
# finance: a P&L question → registry 'finance' → flip abstains (wallet won't answer a P&L)
$rf = Decide-Registry 'what is our p&l this month' $false $false $false $false
Assert-Eq 'reg=finance: p&l this month'  'finance' $rf.domain
Assert-Eq 'flip abstains: p&l this month' 'True'   (Test-WalletAbstains (Get-CrudArb 'neutral' $rf))
# money-safety contest (wallet present + fleet, wallet not strong) → 'ask' → clarify
$rc = Decide-Registry 'how did we do on spending and driver costs' $true $false $false $false
Assert-Eq 'reg=ask: spending vs driver costs' 'ask'  $rc.domain
Assert-Eq 'flip clarifies: spending vs driver costs' 'ask' (Get-CrudArb 'neutral' $rc)

# ── [E] WRITE-LANE no-regression: confirm/add are not vetoed unless truly fleet ─
Write-Host "[E] write lanes (confirm/add) are not stolen by the gate"
# bare "yes" while a wallet confirm card is on screen → wallet_context → proceeds
$dy = Get-ArbDomain 'yes' $false $false $true $false $null
Assert-Eq 'confirm yes -> wallet' 'wallet' $dy
Assert-Eq 'confirm yes -> proceeds' 'False' (Test-WalletAbstains $dy)
# explicit add with no fleet word → neutral → add lane still runs (gate only vetoes fleet/finance)
$da = Get-ArbDomain 'add 50 sar groceries' $false $false $false $false $null
Assert-Eq 'add groceries -> not fleet/finance' 'False' (Test-WalletAbstains $da)

# ── [F] flag DEFAULT-OFF: no env => arb is the unchanged B-152 decision ─────────
Write-Host "[F] M8_REGISTRY_CRUD default OFF leaves arb untouched"
Assert-Eq 'crud env default' '' ([string]$env:M8_REGISTRY_CRUD)   # not set in this session
# with CRUD off, the live code never calls Get-CrudArb, so arb stays as Get-ArbDomain:
$doff = Get-ArbDomain 'what is my spend in june' $false $false $false $false $null
Assert-Eq 'default-off arb unchanged' 'wallet' $doff

# ═══ summary ════════════════════════════════════════════════════════════════════
$summaryColor = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("`n=== RESULT: {0} passed, {1} failed ===" -f $script:pass, $script:fail) -ForegroundColor $summaryColor
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
