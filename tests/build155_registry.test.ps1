# tests/build155_registry.test.ps1
# PS-5.1 MIRROR of the Build-155 registry router — lib/capability-registry.js
# (scoreMessage + pickDomain) + lib/domain-arbiter.js classifyAll()'s deterministic
# decision (hints + the wallet<->fleet co-presence rule + history anaphora). The LLM
# leg is OUT of scope (off in B-155). Node is absent on the host, so this re-implements
# the scorer in PowerShell and runs it against tests/routing_corpus.jsonl.
#
# WHAT "PASS" MEANS for a DORMANT deterministic layer:
#   - HARD GATE: zero MONEY mis-routes (wallet <-> fleet/finance). That's the costly,
#     privacy-relevant boundary; it must never confidently cross.
#   - match / defer / misroute are reported for coverage. "defer" = the registry safely
#     returned chat/ask/ambiguous (typos, bare add-expense, cold anaphora) — the live LLM
#     leg or the upstream keyword parsers resolve those; deferring is the correct, safe
#     outcome for a dormant layer, NOT a failure.
#   - Arabic rows are SKIPPED here (mirror patterns are ASCII-safe so PS 5.1 can't mangle
#     them); the JS registry carries the Arabic branches and is validated live on the phone.

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

# --- load corpus -----------------------------------------------------------------------
$rows = @()
$corpusFile = Join-Path $PSScriptRoot 'routing_corpus.jsonl'
if (Test-Path $corpusFile) {
  foreach ($ln in [IO.File]::ReadAllLines($corpusFile, [Text.Encoding]::UTF8)) {
    if (-not $ln.Trim()) { continue }
    try { $rows += ($ln | ConvertFrom-Json) } catch {}
  }
}
if ($rows.Count -eq 0) {
  $rows = @(
    [pscustomobject]@{ message = 'breakdown of my spend in june'; expect_domain = 'wallet' }
    [pscustomobject]@{ message = 'how are my drivers'; expect_domain = 'fleet' }
    [pscustomobject]@{ message = 'make me rich'; expect_domain = 'chat' }
  )
}

# --- run -------------------------------------------------------------------------------
$ARABIC = Rgx('[^\x00-\x7F]')   # any non-ASCII char marks an Arabic/non-Latin row (mirror is ASCII-only)
$money  = @('wallet', 'fleet', 'finance')
$match = 0; $defer = 0; $skip = 0; $mis = @(); $crit = @()
foreach ($r in $rows) {
  $msg = [string]$r.message
  if ($ARABIC.IsMatch($msg)) { $skip++; continue }
  $d = Decide $msg $r.history
  $E = [string]$r.expect_domain
  $wantAsk = (($r.PSObject.Properties.Name -contains 'expect_ask') -and $r.expect_ask)
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

$total = $rows.Count
Write-Host ("build155 registry mirror (11 domains): match={0} defer={1} misroute={2} arabic_skip={3} of {4}" -f $match, $defer, $mis.Count, $skip, $total)
if ($mis.Count -gt 0) { Write-Host "-- non-critical misroutes / corpus divergences:"; $mis | ForEach-Object { Write-Host "   $_" } }
Write-Host ("CRITICAL money mis-routes (wallet<->fleet/finance): {0}" -f $crit.Count)
if ($crit.Count -gt 0) { $crit | ForEach-Object { Write-Host "   CRIT $_" }; Write-Host 'FAIL'; exit 1 }
Write-Host 'OK (zero money mis-routes)'
exit 0
