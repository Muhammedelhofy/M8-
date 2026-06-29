# tests/build156_lookup.test.ps1
# PS-5.1 MIRROR of the Build-156 LOOKUP-BOUNDARY FLIP.
#
# Node is absent on the host, so this re-implements the registry scorer
# (lib/capability-registry.js) + domain-arbiter.classifyAll()'s DETERMINISTIC decision
# in PowerShell and runs it against tests/routing_corpus.jsonl PLUS inline B-156 cases.
#
# WHAT B-156 ACTUALLY CHANGES
#   resolveDomainRoute() attaches classifyAll()'s decision as `_route.lookup` and
#   orchestrate() ACTS on it — but ONLY for a CLEAR (non-ambiguous) winner in a
#   read-only lookup lane {knowledge, web, memory}. `chat` and any AMBIGUOUS winner are
#   NOT acted on (no attach) ⇒ the pre-156 behaviour wins, so the flip never steals a
#   docs/fleet/notes turn. This mirror models that exact rule as `routed` below.
#
# WHAT "PASS" MEANS (three hard gates — any failure exits 1):
#   GATE A — MONEY SAFETY (B-155 parity): zero wallet<->fleet/finance crit mis-routes.
#   GATE B — NO LEAK INTO LOOKUP: no money/write turn (expect wallet/fleet/finance/tasks/
#            notes/driver_profile) is force-routed into a read-only lookup lane. This is
#            the regression guard for the flip — the ~170 working paths must be untouched.
#   GATE C — LOOKUP PRECISION: every clean-signal lookup row (expect knowledge|web) routes
#            to that exact lane. memory/chat are softer (entity-card/recall handle them and
#            we never FORCE them) so they are reported for coverage, not gated.
#
# Arabic rows are SKIPPED (the mirror patterns are ASCII-safe so PS 5.1 can't mangle them);
# the JS registry carries the Arabic branches and is validated live on the phone.

$ErrorActionPreference = 'Stop'
$opt = [Text.RegularExpressions.RegexOptions]::IgnoreCase
function Rgx([string]$p) { return [Text.RegularExpressions.Regex]::new($p, $opt) }

# --- patterns: Latin branches mirror lib/capability-registry.js (Arabic omitted) -------
$WALLET_STRONG         = Rgx('\bmy\s+(spend(?:ing)?|expenses?|wallet|budget|bills?|transactions?|money)\b|\b(?:did|do|does|how much did)\s+i\s+(?:spend|spent|pay|paid)\b|\bi\s+(?:spent|paid)\b|\bmy\s+(?:last|recent|latest)\s+(?:expenses?|transactions?|purchases?)\b|\b(?:did|have|has)\s+\w+\s+pa(?:y|id)\b|\b(?:paid|pay)\s+(?:the\s+|for\s+|my\s+|our\s+)?(?:rent|electricity|water|internet|bills?|fees?|school\s+fees?|tuition|subscription|installment)\b')
$WALLET_PRESENT        = Rgx('\b(expenses?|wallet|spending|budget|bills?)\b|\bspent\b|\bspend\b(?!\s+(?:time|the\s+night|the\s+day|the\s+weekend))')
$DRIVER_PROFILE_STRONG = Rgx('\bdriver\s+profiles?\b|\b(?:set|update)\s+\w+(?:''s)?\s+(?:rental|salary|fuel)\b')
$FINANCE_STRONG        = Rgx('\bp\s*&\s*l\b|\bpnl\b|\bprofit\w*\b|\b(?:net\s+|gross\s+)?margin\b|\brevenue\b|\boperating\s+(?:costs?|expenses?)\b|\bunit\s+economics\b|\bbreak[\s-]?even\b|\bbottom\s+line\b|\bcost\s+per\s+order\b|\bfinancial\s+(?:situation|health|analysis)\b')
$FLEET_STRONG          = Rgx('\b(drivers?|captains?|couriers?|fleet|riders?)\b')
$FLEET_PRESENT         = Rgx('\b(bikes?|motorbikes?|utili[sz]ation|acceptance\s+rate|payroll|earnings|tier|bonus|cash\s+collection|morning\s+brief|daily\s+brief|fleet\s+brief|active\s+drivers?|[56]k\s+target)\b')
$TASK_PRESENT          = Rgx('\b(tasks?|reminders?|to-?dos?)\b|\bremind\s+me\b|\b(?:on\s+)?my\s+(?:to-?do\s+)?list\b')
$NOTE_STRONG           = Rgx('\b(?:search|check|find\s+in|look\s+in)\s+my\s+notes?\b|^\s*note\s*:|\b(?:take|make|add|leave|write|jot)\s+(?:a\s+|this\s+)?note\b|\bjot\s+(?:this\s+)?down\b')
$NOTE_PRESENT          = Rgx('\bnotes?\b|\bnote\s+(?:that|down|about)\b|\b(?:fyi|for\s+the\s+record)\b|\bremember\s+that\b')
$KNOWLEDGE_STRONG      = Rgx('\bsearch\s+my\s+(?:books?|docs?|documents?|sources?|cv|resume|knowledge)\b|\bwhat\s+(?:does|do|did)\s+[\w\s]{1,30}?\s+say\s+about\b|\baccording\s+to\s+(?:my\s+)?(?:books?|sources?|cv)\b|\bin\s+my\s+(?:cv|resume|books?|documents?)\b|\bmy\s+cv\b')
$MEMORY_PRESENT        = Rgx('\b(?:who\s+(?:is|was|are)|tell\s+me\s+about|what\s+do\s+(?:you|we)\s+know\s+about|do\s+you\s+(?:remember|recall)|what\s+did\s+i\s+(?:say|tell\s+you)\s+about|remind\s+me\s+(?:who|what|about))\b|\bmy\s+(?:wife|husband|brother|sister|son|daughter|mother|father|friend|colleague|boss)\b')
$DOCS_STRONG           = Rgx('\b(make|create|write|draft|build|generate|prepare|design|put\s+together|give\s+me|i\s+need)\b.{0,40}\b(plan|brief|summary|report|deck|slides?|presentation|proposal|outline|document|memo|agenda|one[-\s]?pager|action\s+plan|checklist)\b|\b(slide\s+deck|pitch\s+deck|power\s?point)\b')
$WEB_PRESENT           = Rgx('\b(weather|temperature|forecast|humidity)\b|\b(scores?|who\s+won|match(?:es)?|fixtures?|standings)\b|\b(exchange\s+rate|stock\s+price|share\s+price|price\s+of)\b|\b(flights?|hotels?|airbnb)\b|\b(latest|recent|breaking)\s+(?:news|updates?)\b|\bnews\b|\b(near(?:by|est)?|closest)\b|\bwho\s+(?:founded|owns|invented|acquired)\b')

$DOMAINS = @('driver_profile','knowledge','docs','notes','tasks','wallet','finance','fleet','memory','web','chat')
$LOOKUP  = @('knowledge','web','memory')                       # the read-only lanes B-156 ACTS on (chat = the no-op fallback)
$MONEY_WRITE = @('wallet','fleet','finance','tasks','notes','driver_profile') # turns the flip must NEVER force into a lookup lane

function Score-Message([string]$s) {
  $sc = [ordered]@{}; foreach ($d in $DOMAINS) { $sc[$d] = 0 }
  if ($DRIVER_PROFILE_STRONG.IsMatch($s)) { $sc['driver_profile'] = 2 }
  if ($KNOWLEDGE_STRONG.IsMatch($s))      { $sc['knowledge'] = 2 }
  if ($DOCS_STRONG.IsMatch($s))           { $sc['docs'] = 2 }
  if     ($NOTE_STRONG.IsMatch($s))       { $sc['notes'] = 2 } elseif ($NOTE_PRESENT.IsMatch($s)) { $sc['notes'] = 1 }
  if ($TASK_PRESENT.IsMatch($s))          { $sc['tasks'] = 1 }
  if     ($WALLET_STRONG.IsMatch($s))     { $sc['wallet'] = 2 } elseif ($WALLET_PRESENT.IsMatch($s)) { $sc['wallet'] = 1 }
  if ($FINANCE_STRONG.IsMatch($s))        { $sc['finance'] = 2 }
  if     ($FLEET_STRONG.IsMatch($s))      { $sc['fleet'] = 2 } elseif ($FLEET_PRESENT.IsMatch($s)) { $sc['fleet'] = 1 }
  if ($MEMORY_PRESENT.IsMatch($s))        { $sc['memory'] = 1 }
  if ($WEB_PRESENT.IsMatch($s))           { $sc['web'] = 1 }
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

$WALLET_REF = Rgx('spend|sar|egp|wallet|budget|breakdown|total|expense')
$FLEET_REF  = Rgx('fleet|driver|captain|brief')

function Last-Assistant($history) {
  if (-not $history) { return '' }
  $arr = @($history)
  for ($i = $arr.Count - 1; $i -ge 0; $i--) {
    if ($arr[$i].role -eq 'assistant') { return [string]$arr[$i].content }
  }
  return ''
}

# Mirror of domain-arbiter.classifyAll()'s DETERMINISTIC decision (LLM leg off).
function Decide([string]$msg, $history) {
  $sc = Score-Message $msg
  $fleetSignal = ([int]$sc['fleet'] -gt 0)              # approx looksFleet via registry fleet
  $memberHit   = [bool]($msg -match '\bsara\b')          # approx matchMember with the known member
  if ($fleetSignal) { $sc['fleet'] = [Math]::Max([int]$sc['fleet'], 2) }
  if ($memberHit -and -not $fleetSignal) { $sc['wallet'] = [Math]::Max([int]$sc['wallet'], 2) }
  # wallet<->fleet money-safety contest
  if (([int]$sc['wallet'] -gt 0) -and ([int]$sc['fleet'] -gt 0)) {
    if ([int]$sc['wallet'] -ge 2) { return @{ domain = 'wallet'; ambiguous = $false } }
    return @{ domain = 'ask'; ambiguous = $true }
  }
  $pick = Pick-Domain $sc
  if ($pick.domain -eq 'chat') {
    $la = Last-Assistant $history
    if ($la -and $WALLET_REF.IsMatch($la)) { return @{ domain = 'wallet'; ambiguous = $false } }
    if ($la -and $FLEET_REF.IsMatch($la))  { return @{ domain = 'fleet';  ambiguous = $false } }
    return @{ domain = 'chat'; ambiguous = $false }
  }
  return @{ domain = $pick.domain; ambiguous = $pick.ambiguous }
}

# The orchestrator ACTS on a lookup lane ONLY when it is a CLEAR (non-ambiguous) winner
# in {knowledge, web, memory}. Everything else -> $null = "no force, pre-156 path wins".
function Routed-Lookup($decision) {
  if (($LOOKUP -contains $decision.domain) -and (-not $decision.ambiguous)) { return $decision.domain }
  return $null
}

# --- load corpus -----------------------------------------------------------------------
$rows = @()
$corpusFile = Join-Path $PSScriptRoot 'routing_corpus.jsonl'
if (Test-Path $corpusFile) {
  foreach ($ln in [IO.File]::ReadAllLines($corpusFile, [Text.Encoding]::UTF8)) {
    if (-not $ln.Trim()) { continue }
    try { $rows += ($ln | ConvertFrom-Json) } catch {}
  }
}

# --- inline B-156 cases: strengthen the thin lookup coverage + pin the leak guards ------
# (kept OUT of the shared corpus to avoid cross-session merge conflicts; this file is mine)
$inline = @(
  # knowledge — the ask-my-docs win (corpus has only 2; these are clean strong signals)
  [pscustomobject]@{ message = 'what does my cv say about leadership'; expect_domain = 'knowledge' }
  [pscustomobject]@{ message = 'in my resume what does it say about python'; expect_domain = 'knowledge' }
  [pscustomobject]@{ message = 'according to my books what is the lychrel definition'; expect_domain = 'knowledge' }
  [pscustomobject]@{ message = 'search my documents for the leave policy'; expect_domain = 'knowledge' }
  # web
  [pscustomobject]@{ message = 'whats the score of the match today'; expect_domain = 'web' }
  [pscustomobject]@{ message = 'price of gold today'; expect_domain = 'web' }
  # memory (softer — reported only)
  [pscustomobject]@{ message = 'do you remember my brother name'; expect_domain = 'memory' }
  # chat
  [pscustomobject]@{ message = 'i feel tired today'; expect_domain = 'chat' }
  # LEAK GUARDS — money/docs turns that share a lookup word must NOT route to a lookup lane
  [pscustomobject]@{ message = 'how much did i spend on books'; expect_domain = 'wallet' }   # 'books' must not pull knowledge
  [pscustomobject]@{ message = 'write me a one-pager from my cv'; expect_domain = 'docs' }    # docs<->knowledge collision -> defer
)
$rows += $inline

# --- run -------------------------------------------------------------------------------
$ARABIC = Rgx('[^\x00-\x7F]')   # any non-ASCII char marks an Arabic/non-Latin row (mirror is ASCII-only)
$money  = @('wallet', 'fleet', 'finance')
$match = 0; $defer = 0; $skip = 0; $mis = @(); $crit = @()
$leak = @(); $lookupMiss = @()
$lookupCovered = 0; $lookupExpected = 0
foreach ($r in $rows) {
  $msg = [string]$r.message
  if ($ARABIC.IsMatch($msg)) { $skip++; continue }
  $d = Decide $msg $r.history
  $routed = Routed-Lookup $d
  $E = [string]$r.expect_domain
  $wantAsk = (($r.PSObject.Properties.Name -contains 'expect_ask') -and $r.expect_ask)

  # ----- GATE B: a money/write turn must never be FORCED into a read-only lookup lane ----
  if (($MONEY_WRITE -contains $E) -and $routed) {
    $leak += "expect=$E force-routed to lookup '$routed': $msg"
  }

  # ----- GATE C: every clean-signal lookup row (knowledge|web) must route to that lane ----
  if (($E -eq 'knowledge') -or ($E -eq 'web')) {
    $lookupExpected++
    if ($routed -eq $E) { $lookupCovered++ } else { $lookupMiss += "expect=$E routed=$([string]$routed) decided=$($d.domain)$(if($d.ambiguous){'|amb'}): $msg" }
  } elseif (($E -eq 'memory') -or ($E -eq 'chat')) {
    # softer lanes — report coverage but don't gate
    $lookupExpected++
    if (($routed -eq $E) -or (($E -eq 'chat') -and (-not $routed))) { $lookupCovered++ }
  }

  # ----- coverage bookkeeping + GATE A (crit ONLY on a genuine cross-domain misroute,
  #       mirrors build155 — a want=wallet/got=wallet MATCH is never a crit) -----
  if ($wantAsk) {
    if (($d.domain -eq 'ask') -or $d.ambiguous) { $match++ } else { $mis += "want=ask got=$($d.domain): $msg" }
    continue
  }
  if ($d.domain -eq $E) { $match++ }
  elseif (($d.domain -eq 'chat') -or ($d.domain -eq 'ask') -or $d.ambiguous) { $defer++ }
  else {
    $line = "want=$E got=$($d.domain): $msg"
    $mis += $line
    $isCrit = (($E -eq 'wallet') -and ($money -contains $d.domain)) -or `
              ((($E -eq 'fleet') -or ($E -eq 'finance')) -and ($d.domain -eq 'wallet'))
    if ($isCrit) { $crit += $line }
  }
}

$total = $rows.Count - $skip
Write-Host ("build156 lookup mirror: rows={0} (arabic_skip={1})  match={2} defer={3} non-crit-misroute={4}" -f $total, $skip, $match, $defer, $mis.Count)
Write-Host ("lookup coverage (knowledge/web/memory/chat routed correctly): {0}/{1}" -f $lookupCovered, $lookupExpected)
if ($mis.Count -gt 0) { Write-Host '-- non-critical misroutes / corpus divergences:'; $mis | ForEach-Object { Write-Host "   $_" } }

$fail = $false
Write-Host ''
Write-Host ("GATE A  money-safety crit (wallet<->fleet/finance): {0}" -f $crit.Count)
if ($crit.Count -gt 0) { $crit | ForEach-Object { Write-Host "   CRIT $_" }; $fail = $true }

Write-Host ("GATE B  money/write turns leaked into a lookup lane: {0}" -f $leak.Count)
if ($leak.Count -gt 0) { $leak | ForEach-Object { Write-Host "   LEAK $_" }; $fail = $true }

Write-Host ("GATE C  clean-signal lookup rows (knowledge|web) mis-routed: {0}" -f $lookupMiss.Count)
if ($lookupMiss.Count -gt 0) { $lookupMiss | ForEach-Object { Write-Host "   MISS $_" }; $fail = $true }

Write-Host ''
if ($fail) { Write-Host 'FAIL'; exit 1 }
Write-Host 'OK (zero money mis-routes; zero leaks; all clean lookup rows routed)'
exit 0
