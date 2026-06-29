# tests/build159_finish_crud.test.ps1
# Build-159 — FINISH THE ALL-DOMAIN FLIP + currency backlog — PS-5.1 mirror (Node is absent).
#
# JOB 1 — flip the LAST CRUD lanes (tasks / notes / driver_profile) onto the registry.
#   resolveDomainRoute (behind M8_REGISTRY_CRUD, default OFF) carries a CLEAR registry
#   winner in {tasks, notes, driver_profile} as `crud`. capabilityFallback(message, arb,
#   crud) then RESCUES it — but ONLY after every deterministic keyword lane already missed,
#   and (for tasks/notes) ONLY when an ACTION signal is present, so a no-action chat turn is
#   never stolen. UNLIKE wallet/fleet/finance, `arb` is NOT replaced (those lanes own their
#   own front doors and run FIRST). Ambiguous/contest ⇒ crud null ⇒ pre-159 behaviour.
#
# JOB 2 — currency-filtered breakdown. "breakdown on 921 sar" decomposes a SPECIFIC
#   single-currency figure → scope to THAT currency only (was: a SAR+EGP mix).
#   parseBreakdownCurrencyFilter detects the "<N> <cur>" token; getCategoryBreakdown's new
#   optional currencyFilter drops other-currency rows at the source.
#
# THE TEST BOUNDARY (same as build157): this mirrors the NEW routing/aggregation DECISIONS,
# not the JS engines. The deterministic keyword handlers (handleTasksCommand / handleNotes
# Command / handleDriverProfileCommand) run FIRST in prod and win on the phrasings they
# parse; these rows assert what happens for a phrasing that REACHES the safety net. looksFleet
# / looksFinance are already-tested code, so each row SUPPLIES the verdict they return.
# Arabic phrasings use the SAME patterns and are covered by the live phone test.

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

$opt = [Text.RegularExpressions.RegexOptions]::IgnoreCase
function Rgx([string]$p) { return [Text.RegularExpressions.Regex]::new($p, $opt) }

# ═══ 1. REGISTRY MIRROR (verbatim from build155/build157) ════════════════════════
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
# classifyAll()'s DETERMINISTIC decision with the SAME hints resolveDomainRoute passes.
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

# ═══ 2. THE NEW B-159 LOGIC ══════════════════════════════════════════════════════
# (a) resolveDomainRoute's crud attach: a CLEAR (non-ambiguous) registry winner in
#     {tasks, notes, driver_profile} is carried as `crud`; everything else ⇒ null.
function Get-Crud($reg) {
  if ((-not $reg.ambiguous) -and (($reg.domain -eq 'tasks') -or ($reg.domain -eq 'notes') -or ($reg.domain -eq 'driver_profile'))) {
    return $reg.domain
  }
  return $null
}
# (b) capabilityFallback(message, arb, crud)'s lane decision. Returns the card that fires:
#     'money' | 'driver_profile' | 'task' | 'note' | 'none'. arbDomain feeds the money
#     _fleetVeto; $crud is the B-159 winner (or $null when CRUD off / ambiguous).
$CAP_MONEY  = Rgx('\b(expenses?|wallet|balance|transactions?|spend(?:ing)?|spent)\b')
$CAP_TASK   = Rgx('\b(tasks?|reminders?|to-?dos?)\b')
$CAP_NOTE   = Rgx('\b(notes?)\b')
$CAP_ACTION = Rgx('\b(add|new|log|record|remove|delete|drop|cancel|clear|undo|change|update|edit|fix|set|mark|complete|finish|done|scratch|forget)\b|get\s+rid')
function Test-Rescue([string]$msg, [string]$arbDomain, $crud, [bool]$fleetLike, [bool]$financeLike) {
  $fleetVeto = $fleetLike
  if ($arbDomain -eq 'wallet') { $fleetVeto = $false }
  elseif (($arbDomain -eq 'fleet') -or ($arbDomain -eq 'finance')) { $fleetVeto = $true }
  if ($CAP_MONEY.IsMatch($msg) -and (-not $fleetVeto) -and (-not $financeLike)) { return 'money' }
  if ($crud -eq 'driver_profile') { return 'driver_profile' }
  if (($CAP_TASK.IsMatch($msg) -or ($crud -eq 'tasks')) -and $CAP_ACTION.IsMatch($msg)) { return 'task' }
  if (($CAP_NOTE.IsMatch($msg) -or ($crud -eq 'notes')) -and $CAP_ACTION.IsMatch($msg)) { return 'note' }
  return 'none'
}

# ═══ 3. JOB 2 — currency-filtered breakdown ══════════════════════════════════════
function Cur-Token([string]$s) {
  $t = ($s.ToLower()) -replace 's$',''
  if ($t -eq 'sar' -or $t -eq 'sr' -or $t -eq 'riyal') { return 'SAR' }
  if ($t -eq 'egp' -or $t -eq 'pound') { return 'EGP' }
  return $null
}
# Mirror of parseBreakdownCurrencyFilter: a number immediately followed by a currency token.
function Parse-BreakdownCur([string]$raw) {
  $en = [regex]::Match($raw.ToLower(), '\d[\d.,]*\s*(sar|sr|riyals?|egp|pounds?)\b')
  if ($en.Success) { return Cur-Token $en.Groups[1].Value }
  return $null
}
# Mirror of getCategoryBreakdown's per-category aggregation WITH the B-159 currencyFilter.
# Returns @{ total=<native sum>; currencies=<sorted distinct currency list> }.
function Get-FilteredBreakdown($txns, $cf) {
  # NB (PS-5.1 gotcha): variables are case-INSENSITIVE, so a local named $CF would ALIAS
  # the param $cf — `$CF = $null` would then clobber $cf before we read it. Use $want.
  $want = $null; if ($cf) { $want = ([string]$cf).ToUpper() }
  $total = 0.0
  $curs = New-Object System.Collections.Generic.HashSet[string]
  foreach ($t in $txns) {
    if ($t.type -ne 'expense') { continue }
    if ($want -and ($t.currency -ne $want)) { continue }
    $total += [double]$t.amount
    [void]$curs.Add([string]$t.currency)
  }
  $list = @($curs) | Sort-Object
  return @{ total = $total; currencies = ($list -join ',') }
}

Write-Host "`n=== Build-159 finish-crud + currency filter ===" -ForegroundColor Cyan

# ── [A] JOB 1: tasks / notes / driver_profile route to the RIGHT rescue lane ──────
# Each row: msg, fleetLike, memberHit, walletRef, fleetRef  (CRUD flag ON for this block).
# Asserted: registry domain, the carried crud, AND the rescued card lane.
Write-Host "`n[A] CRUD winners route via the registry (M8_REGISTRY_CRUD=1)"
$A = @(
  @('remind me to update the car registration', 'tasks',          'task'),            # TASK_PRESENT "remind me" (narrow _CAP_TASK_RE misses); action "update"
  @('fyi, set the alarm for the vehicle inspection', 'notes',      'note'),            # NOTE_PRESENT "fyi" (narrow _CAP_NOTE_RE misses); action "set"
  @("update Ahmad's salary",                   'driver_profile',  'driver_profile'),  # DRIVER_PROFILE_STRONG, no "driver" word ⇒ no fleet tie
  @("set Khalid's fuel to 400",                'driver_profile',  'driver_profile'),   # canonical upsert phrasing
  @('add a reminder to renew the iqama',       'tasks',           'task')             # TASK_PRESENT "reminder"; action "add"/"renew"
)
foreach ($r in $A) {
  $reg  = Decide-Registry $r[0] $false $false $false $false
  $crud = Get-Crud $reg
  Assert-Eq ("reg=" + $r[1] + ": " + $r[0])   $r[1]  $reg.domain
  Assert-Eq ("crud carried: " + $r[0])        $r[1]  ([string]$crud)
  $lane = Test-Rescue $r[0] 'neutral' $crud $false $false
  Assert-Eq ("rescue lane=" + $r[2] + ": " + $r[0]) $r[2] $lane
}

# ── [B] NO TURN STOLEN: a no-action chat turn that merely NAMES the noun ───────────
Write-Host "[B] no-action chat turns are NOT stolen (the ACTION gate holds)"
$B = @(
  'what are my main tasks in life',          # tasks=1 clear, but NO action verb ⇒ none
  'any interesting notes from the lecture',  # notes=1 clear, but NO action verb ⇒ none
  'what is a good to-do app'                 # tasks=1 clear, no action ⇒ none (falls to LLM)
)
foreach ($m in $B) {
  $reg  = Decide-Registry $m $false $false $false $false
  $crud = Get-Crud $reg
  $lane = Test-Rescue $m 'neutral' $crud $false $false
  Assert-Eq ("not stolen: " + $m) 'none' $lane
}

# ── [C] ZERO MONEY MIS-ROUTES (the privacy-critical invariant) ────────────────────
# The 3 documented fleet phrasings (looksFleet TRUE): the registry says fleet, crud is
# null (fleet is NOT a CRUD-rescue domain), and NO wallet/task/note card fires.
Write-Host "[C] fleet questions never produce a wallet/task/note card; money stays put"
$C = @(
  'how many drivers in the bolt fleet already exceeded net earning of 4000 sar this month',
  'total net earning per driver from 1st of june till 28th of june',
  'i want net earning in all june'
)
foreach ($m in $C) {
  $reg  = Decide-Registry $m $true $false $false $false   # looksFleet TRUE
  Assert-Eq ("reg=fleet: " + $m) 'fleet' $reg.domain
  $crud = Get-Crud $reg
  Assert-Eq ("crud null (fleet not a CRUD lane): " + $m) '' ([string]$crud)
  # arb for these = 'fleet' (the wallet⇄fleet gate) → money branch vetoed; crud null → no card.
  $lane = Test-Rescue $m 'fleet' $crud $true $false
  Assert-Eq ("no card for fleet Q: " + $m) 'none' $lane
}
# a real wallet question still maps to the money card (not stolen by a CRUD lane)…
$wReg  = Decide-Registry 'what is my spend in june' $false $false $false $false
$wCrud = Get-Crud $wReg
Assert-Eq 'wallet stays wallet (no crud): what is my spend in june' '' ([string]$wCrud)
Assert-Eq 'money card for a wallet Q' 'money' (Test-Rescue 'what is my spend in june' 'wallet' $wCrud $false $false)
# …and a finance/P&L question is never grabbed by a CRUD card.
Assert-Eq 'no card for a P&L Q' 'none' (Test-Rescue 'what is our p&l this month' 'finance' $null $false $true)

# ── [D] FLAG DEFAULT-OFF: CRUD off ⇒ crud is always null ⇒ pre-159 behaviour ───────
Write-Host "[D] M8_REGISTRY_CRUD default OFF: no crud rescue, narrow regex only"
Assert-Eq 'crud env default' '' ([string]$env:M8_REGISTRY_CRUD)
# With CRUD off the live code never carries crud, so a phrasing the narrow _CAP regex
# misses falls through (the pre-159 behaviour we are rescuing). Modelled by crud=$null:
Assert-Eq 'off: remind-me task NOT rescued' 'none' (Test-Rescue 'remind me to update the car registration' 'neutral' $null $false $false)
Assert-Eq 'off: fyi note NOT rescued'       'none' (Test-Rescue 'fyi, set the alarm for the vehicle inspection' 'neutral' $null $false $false)
# (the keyword handlers still catch the phrasings they DO parse — unchanged either way)

# ── [E] JOB 2: "<N> <cur>" filter detection (distinct from convert "in <cur>") ─────
Write-Host "[E] breakdown currency-FILTER detection"
$E = @(
  @("what's the breakdown on 921 sar", 'SAR'),
  @('breakdown of the 497 egp',        'EGP'),
  @('break it down on 1,250 sar',      'SAR'),
  @('show the 80 riyals breakdown',    'SAR')
)
foreach ($r in $E) { Assert-Eq ("filter: " + $r[0]) $r[1] ([string](Parse-BreakdownCur $r[0])) }
# must NOT fire (these are conversions or plain breakdowns owned by other lanes):
$Enull = @(
  'breakdown of my spend',          # no number+currency
  'put all currency in sar',        # convert lane (no digit before sar)
  'i want the amounts in sar',      # convert lane
  'how much did i spend in june'    # month, not a currency figure
)
foreach ($m in $Enull) { Assert-Eq ("no filter: " + $m) '' ([string](Parse-BreakdownCur $m)) }

# ── [F] JOB 2: the filter is SAR-ONLY (no EGP leaks into the 921 SAR total) ────────
Write-Host "[F] currency-filtered aggregation is single-currency"
$txns = @(
  @{ type='expense'; category='Iqos';   currency='SAR'; amount=300.0 },
  @{ type='expense'; category='Food';   currency='SAR'; amount=121.0 },
  @{ type='expense'; category='Dining'; currency='SAR'; amount=500.0 },
  @{ type='expense'; category='Gifts';  currency='EGP'; amount=3440.0 },
  @{ type='income';  category='Salary'; currency='SAR'; amount=9000.0 }   # income excluded
)
# The canonical bug case end-to-end: "breakdown on 921 sar" → SAR filter → SAR-only.
$cur = Parse-BreakdownCur "what's the breakdown on 921 sar"
Assert-Eq 'canonical detect -> SAR' 'SAR' ([string]$cur)
$sar = Get-FilteredBreakdown $txns $cur
Assert-Eq 'SAR-filter total = 921'        921 ([int]$sar.total)
Assert-Eq 'SAR-filter currencies = SAR'   'SAR' $sar.currencies   # NO EGP present
# pre-159 (no filter) would MIX EGP in — proving the bug the filter fixes:
$mix = Get-FilteredBreakdown $txns $null
Assert-Eq 'unfiltered total mixes (921 SAR + 3440 EGP = 4361 nonsense)' 4361 ([int]$mix.total)
Assert-Eq 'unfiltered currencies = EGP,SAR (the bug)'   'EGP,SAR' $mix.currencies
# EGP filter is symmetric (only the Gifts row):
$egp = Get-FilteredBreakdown $txns (Parse-BreakdownCur 'breakdown of the 3440 egp')
Assert-Eq 'EGP-filter total = 3440'      3440 ([int]$egp.total)
Assert-Eq 'EGP-filter currencies = EGP'  'EGP' $egp.currencies

# ═══ summary ════════════════════════════════════════════════════════════════════
$summaryColor = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("`n=== RESULT: {0} passed, {1} failed ===" -f $script:pass, $script:fail) -ForegroundColor $summaryColor
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
