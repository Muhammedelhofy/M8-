# ============================================================================
# M8 Under-routing guard (backlog #12 / Build-40 follow-up).
# Full-classifier PS mirror of lib/intentClassifier.js (English patterns), run
# in BEFORE (no checkable tier) and AFTER (with it) modes so the corpus is
# MEASURED before/after, not just asserted. No local Node -- keep the mirror in
# lockstep with the JS. Pure ASCII; corpus is English-only by design.
#   powershell -File tests/under-routing-verify.ps1
# Corpus + rationale: tests/odysseus/under-routing-corpus.md
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- MIRRORS of lib/intentClassifier.js (English alternations) -------------
$PERSONAL = @(
  '\bmy (fleet|drivers?|bikes?|team|schedule|earnings|salary|riders?|performance|data|stats|numbers)\b',
  '\b(our|my) .{0,25}(this week|this month|today|last week|last month|yesterday)\b'
)
$SELF_STATUS = '\b(?:(?:most\s+recent|latest|last|current|newest|which|what|your)\s+(?:build|version)\b|what\s+build\s+(?:are|is|was|am)\b|build\s+number\b|(?:your|you''?re|are\s+you)\b[^?.!]{0,30}\b(?:version|capabilit|architecture|trained|knowledge\s+cutoff|able\s+to)\b|what\s+(?:can|do)\s+you\s+(?:do|support|handle)\b|did\s+(?:you|we)\s+(?:build|ship|add|implement|finish)\b)'
$DOC = @(
  '\b(make|create|write|draft|build|generate|prepare|put together|design|give me|i need)\b.{0,40}\b(plan|brief|summary|report|deck|slides?|presentation|proposal|outline|document|memo|meeting minutes|agenda|one[- ]?pager|action plan|checklist)\b',
  '\b(slide deck|pitch deck|power ?point)\b'
)
$FACT = @(
  '^(did |has |is it true|was |were )',
  '^is (the |a |an |there ).{2,50}(operational|available|open|closed|working|live|active|running|fully|complete|finished|real|accurate)\b',
  'did .*(launch|open|clos|merg|acqui|announc|releas)'
)
$NEWS = @(
  '\b(latest|recent|news|update|happened|breaking)\b',
  'this (week|month|year)'
)
$LIVE = @(
  '\bflights?\b','\bbook(ing)? (a )?(flight|ticket|seat)\b','\bfly(ing)? (from|to)\b',
  '\b(travel|traveling|travelling|trip|getaway)\b','\b(travel|trip|getaway)\s+to\b',
  '\b(depart|arrive|departure|arrival|layover|stopover)\b','\bairline(s)?\b',
  '\b(stock price|share price|market cap|trading at|ticker)\b','\b(nasdaq|nyse|tadawul|stock market)\b',
  '\bprice of (uber|apple|tesla|aramco|amazon|google|meta|microsoft)\b',
  '\b(exchange rate|currency rate|forex|usd to|sar to|egp to|convert .{1,15} to)\b',
  '\b(weather|temperature|forecast|humidity|rain)\b',
  '\b(hotel|accommodation|hostel|airbnb).{0,30}(book|available|price|cost|night)\b',
  '\b(match|matches|fixture|fixtures|kick-?off|line-?up|scoreline|standings|results?)\b',
  '\b(playing|plays|play)\s+(against|vs\.?|versus|with)\b','\b(vs\.?|versus)\b',
  '\bwhat time\b','\bwhen (is|are|does|do|will|s)\b',
  '\b(world cup|premier league|champions league|la ?liga|bundesliga|serie a|euros?|afcon|olympics|formula ?1|f1)\b'
)
$LOOKUP = @(
  '\b(price|cost|fee|fare|how much)\b','\b(cheap|cheapest|affordable|budget)\b',
  '\bfrom .{2,30} to .{2,30}',
  '\b(near(by)?|nearest|closest|around here)\b',
  '\bin (riyadh|jeddah|dammam|khobar|alexandria|cairo|mecca|medina|saudi|ksa|egypt)\b',
  '\b(restaurant|school|hospital|clinic|pharmacy|gym|mall|salon)\b',
  '\b(find me|show me|get me|give me options)\b',
  '\b(list|enumerate|name) (the |a )?(top|best|major|leading|main|biggest|largest)\b',
  '\b(top|best|leading|major) \d+ \b'
)
$RESEARCH = @(
  '\b(summarize|summary|explain|what is|what are|how does|how do|tell me about)\b',
  '\b(book|article|study|research|report|paper)\b',
  '\b(history|background|overview|introduction)\b'
)
# Build-43 new tier (mirror of CHECKABLE_FACT_RE):
$CHECKABLE = @(
  '\bwhen (?:was|were|did|had|has)\b(?!\s+(?:i|you|we|my|our)\b)',
  '\b(?:what|which) year\b',
  '\bwho (?:founded|owns|owned|acquired|bought|created|invented|developed|built|runs|leads|led|makes|made|designed|launched)\b',
  '\bwho (?:is|was|are|were)\s+(?:the\s+)?(?:current\s+)?(?:ceo|cfo|coo|cto|founder|co-?founder|owner|president|head|chief|director|minister|king|crown\s+prince|prince|mayor|governor|author|inventor|creator|maker)\b'
)
function AnyMatch([string]$m, [string[]]$pats) { foreach ($p in $pats) { if ($m -match $p) { return $true } } return $false }

function Classify([string]$msg, [bool]$useCheckable) {
  $m = $msg.ToLower()
  if (AnyMatch $m $PERSONAL)              { return 'NONE' }
  if ($m -match $SELF_STATUS)             { return 'NONE' }
  $docStr = if ($m.Length -gt 200) { $m.Substring(0,200) } else { $m }
  if (AnyMatch $docStr $DOC)              { return 'DOC' }
  if (AnyMatch $m $FACT)                  { return 'FACT_CHECK' }
  if (AnyMatch $m $NEWS)                  { return 'NEWS' }
  if (AnyMatch $m $LIVE)                  { return 'LIVE_DATA' }
  if (AnyMatch $m $LOOKUP)                { return 'LOOKUP' }
  if (AnyMatch $m $RESEARCH)              { return 'RESEARCH' }
  if ($useCheckable -and (AnyMatch $m $CHECKABLE)) { return 'LOOKUP' }
  return 'NONE'
}
$SEARCH_INTENTS = @('FACT_CHECK','NEWS','LIVE_DATA','LOOKUP','RESEARCH')
function IsSearch([string]$intent) { return $SEARCH_INTENTS -contains $intent }

Write-Host "`nM8 under-routing guard (backlog #12) -- full-classifier mirror, before/after`n"

# ---- MUST-SEARCH: NONE before, a SEARCH intent (LOOKUP) after ---------------
$mustSearch = @(
  'when was bolt food founded',
  'who founded keeta',
  'who is the ceo of careem',
  'what year did aramco go public',
  'who owns the noon app',
  'who is the current ceo of uber',
  'when was the riyadh metro completed',
  'who acquired careem',
  "what year was aramco's ipo",
  'who developed the keeta platform'
)
Write-Host "-- MUST-SEARCH (under-routed misses) --"
$fixed = 0
foreach ($q in $mustSearch) {
  $before = Classify $q $false
  $after  = Classify $q $true
  Ok ($before -eq 'NONE') ("BEFORE NONE: '$q' (was $before)")
  Ok (IsSearch $after)    ("AFTER  search: '$q' -> $after")
  if (($before -eq 'NONE') -and (IsSearch $after)) { $fixed++ }
}

# ---- MUST-NOT-SEARCH: NONE before AND after (no over-routing regression) -----
$mustNot = @(
  'why is the sky blue',
  'write a haiku about the desert',
  'give me three ideas to motivate my drivers',
  'tell me a joke',
  "what's a good morning routine",
  'should i raise driver pay',
  'draft a short thank-you message to my top driver',
  'suggest a name for my fleet dashboard',
  'what should i name my new bike model',
  'remind me to call the workshop',
  'i feel stuck, any advice on growing the business',
  'make my drivers a motivational poster'
)
Write-Host "`n-- MUST-NOT-SEARCH (must stay local) --"
foreach ($q in $mustNot) {
  $before = Classify $q $false
  $after  = Classify $q $true
  Ok ($before -eq 'NONE' -and $after -eq 'NONE') ("STAYS NONE before+after: '$q' (before=$before after=$after)")
}

# ---- Negative-lookahead guard: self/personal temporal stays NONE ------------
Write-Host "`n-- temporal lookahead guard (no self/personal web search) --"
# clean phrasings (no other trigger token) so the LOOKAHEAD is what suppresses them:
# without the negative lookahead these would hit the temporal tier -> LOOKUP.
foreach ($q in @('when did i last log in','when did you start','when did we begin')) {
  Ok ((Classify $q $true) -eq 'NONE') ("self/personal temporal -> NONE: '$q'")
}
# ...but a real external temporal fact still fires:
Ok ((Classify 'when did saudi aramco list on tadawul' $true) -ne 'NONE') "external temporal still fires: 'when did saudi aramco list...'"

# ---- Regression: a documented existing route is untouched -------------------
Write-Host "`n-- regression (existing routes untouched) --"
Ok ((Classify 'latest keeta news' $true) -eq 'NEWS')                 "NEWS intact: 'latest keeta news'"
Ok ((Classify 'what is rider utilization' $true) -eq 'RESEARCH')     "RESEARCH intact: 'what is rider utilization'"
Ok ((Classify "what's your most recent build" $true) -eq 'NONE')     "self-status intact: most-recent-build -> NONE"

Write-Host ("`n==== under-routing-verify: {0} passed, {1} failed ({2}/{3} misses fixed) ====" -f $script:pass, $script:fail, $fixed, $mustSearch.Count) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
