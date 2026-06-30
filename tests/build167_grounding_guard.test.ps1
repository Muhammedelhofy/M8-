# tests/build167_grounding_guard.test.ps1
# PS-5.1 MIRROR of Build-167 — the GROUNDING / HONESTY GUARD wired into
# lib/orchestrator.js orchestrate() behind the NEW flag M8_GROUNDING_GUARD.
# Node is absent on the host, so this test:
#   (1) re-implements the guard's helpers in PowerShell (entityCardNameFrom,
#       isCheckableFact, asksContactInfo, the possessive detector, cleanEntityLabel,
#       looksLikePersonName, looksAffirmative) and drives the FULL personal-vs-public
#       gate over the brief's REAL prod probe cases:
#         - "who is Khalid Al-Otaibi and his phone number?" + no match  -> DECLINE (no PII)
#         - "who is the president of Egypt?"                            -> WEB (public/role, unchanged)
#         - "tell me about my kafala operation" + KG hit               -> serve CITED docs
#         - "tell me about my kafala operation" + no hit               -> DECLINE
#         - "how many drivers in Dubai?" / score / weather             -> SKIP (not our shape; fleet/live unchanged)
#       and proves flag OFF = no-op (the pre-167 web/normal path);
#   (2) STATICALLY proves the orchestrator wire: the guard + the consented-search +
#       the follow-up are ALL gated by M8_GROUNDING_GUARD, are fail-OPEN (try/catch),
#       the decline both saves + returns, a KG hit forces the cited path (never web),
#       the public/role ask is excluded (!isCheckableFact), and the NONE-router gate
#       carries the new !_ggAcceptedSearch term (the "yes" turn is not double-searched).
#
# ASCII-only by design: Arabic framings are covered by the LIVE prod probe, not here
# (a UTF-8/PS-5.1 source-encoding mismatch would give a false fail — see the
# PS-test-mirror gotchas note). "PASS" = all checks (exit 0); any FAIL -> exit 1.

$ErrorActionPreference = 'Stop'
$script:fail = 0
function Check([string]$name, [bool]$cond) {
  if ($cond) { Write-Host ("  PASS  " + $name) }
  else { Write-Host ("  FAIL  " + $name); $script:fail = $script:fail + 1 }
}

$root    = Split-Path $PSScriptRoot -Parent
$orcFile = Join-Path $root 'lib\orchestrator.js'
$icFile  = Join-Path $root 'lib\intentClassifier.js'
foreach ($f in @($orcFile, $icFile)) {
  if (-not (Test-Path $f)) { Write-Host ("  FAIL  missing file: " + $f); exit 1 }
}
$orc = [IO.File]::ReadAllText($orcFile, [Text.Encoding]::UTF8)

# ============================ PS MIRRORS OF THE GUARD HELPERS ============================
# entityCardNameFrom — ENTITY_CARD_QUERY_RE (terminator class trimmed to ASCII for the
# English mirror; the JS keeps the Arabic terminator too).
function Get-EntityCardName([string]$msg) {
  $re = '\b(?:tell\s+me\s+about|who\s+(?:is|was|are)|what\s+(?:do|did|does)\s+(?:you|we)\s+(?:know|recall|remember|have)\s+(?:about|on)|what(?:''s|\s+is)\s+(?:the\s+)?(?:history|story|background)\s+(?:of|about|on)|info(?:rmation)?\s+(?:about|on)|background\s+on)\s+(.{3,80}?)(?:\s*[?.,!]|$)'
  $m = [regex]::Match($msg, $re, 'IgnoreCase')
  if (-not $m.Success) { return '' }
  $name = ($m.Groups[1].Value.Trim() -replace '[?.,!]+$', '').Trim()
  if ($name.Length -ge 2) { return $name } else { return '' }
}

# isCheckableFact — the public/role + who-founded + when-was/what-year shapes.
function Test-IsCheckableFact([string]$msg) {
  $p = '\bwhen\s+(?:was|were|did|had|has)\b(?!\s+(?:i|you|we|my|our)\b)' +
       '|\b(?:what|which)\s+year\b' +
       '|\bwho\s+(?:founded|owns|owned|acquired|bought|created|invented|developed|built|runs|leads|led|makes|made|designed|launched)\b' +
       '|\bwho\s+(?:is|was|are|were)\s+(?:the\s+)?(?:current\s+)?(?:ceo|cfo|coo|cto|founder|co-?founder|owner|president|head|chief|director|minister|king|crown\s+prince|prince|mayor|governor|author|inventor|creator|maker)\b'
  return [regex]::IsMatch($msg, $p, 'IgnoreCase')
}

function Test-AsksContactInfo([string]$msg) {
  return [regex]::IsMatch($msg, '\b(?:phone|mobile|cell|telephone|number|whats\s?app|e-?mail|contact|address)\b', 'IgnoreCase')
}

function Test-Possessive([string]$msg) {
  return [regex]::IsMatch($msg, '\b(?:tell\s+me\s+about|who\s+(?:is|are|was)|what\s+do\s+you\s+know\s+about|info(?:rmation)?\s+(?:about|on)|background\s+on)\s+(?:my|our)\b', 'IgnoreCase')
}

function Get-CleanEntityLabel([string]$name) {
  $s = $name.Trim()
  $s = [regex]::Replace($s, '^(?:my|our|the)\s+', '', 'IgnoreCase')
  $s = [regex]::Replace($s, '[\s,]+(?:and\s+|&\s+|with\s+)?(?:his|her|their|its)?\s*(?:phone|mobile|cell|telephone|number|whats\s?app|e-?mail|contact|address)(?:\s+(?:number|details?|info(?:rmation)?))?\b[\s\S]*$', '', 'IgnoreCase')
  $s = ($s -replace '[?.,!]+$', '').Trim()
  return $s
}

function Test-LooksLikePersonName([string]$label) {
  $s = $label.Trim()
  if ([string]::IsNullOrEmpty($s)) { return $false }
  if ([regex]::IsMatch($s, '\d')) { return $false }
  if ([regex]::IsMatch($s, '\b(?:the|a|an|best|top|nearest|cheapest|near|of|for|about|operation|system|company|theory|history|capital|president|ceo|cfo|cto|king|queen|prince|minister|mayor|governor|weather|price|score|league|match|news)\b', 'IgnoreCase')) { return $false }
  $toks = @($s -split '\s+')
  if ($toks.Count -lt 1 -or $toks.Count -gt 4) { return $false }
  $nameLike = 0
  foreach ($t in $toks) {
    $w = [regex]::Replace($t, '^[^A-Za-z]+', '')
    if ([regex]::IsMatch($w, '^(?:al|el|bin|ibn|abu|umm?|abd|abdul|abdel|van|von|de|da|del|st)\.?$', 'IgnoreCase')) { $nameLike = $nameLike + 1; continue }
    if ([regex]::IsMatch($t, "^[A-Z][A-Za-z'.-]*$")) { $nameLike = $nameLike + 1; continue }
    return $false
  }
  return ($nameLike -ge 1)
}

function Test-LooksAffirmative([string]$msg) {
  $s = $msg.Trim()
  if ([string]::IsNullOrEmpty($s) -or $s.Length -gt 40) { return $false }
  return [regex]::IsMatch($s, '^\s*(?:yes|yep|yeah|yup|sure|ok(?:ay)?|please(?:\s+do)?|go(?:\s+ahead)?|do\s+it|search(?:\s+it)?|look\s+it\s+up)\b', 'IgnoreCase')
}

# FULL gate — returns 'off' | 'skip' | 'web' | 'force_kg' | 'decline' (mirrors the
# orchestrate() block: flag -> entity-shaped -> not-suppressed -> not-accepted ->
# not-public -> personal -> KG hit? -> decline).
function Get-GuardDecision([string]$msg, [bool]$flagOn, [bool]$suppress, [bool]$accepted, [bool]$kgHit) {
  if (-not $flagOn) { return 'off' }                                   # OFF = pre-167 path
  $name = Get-EntityCardName $msg
  if ([string]::IsNullOrEmpty($name)) { return 'skip' }                # not an identity ask
  if ($suppress) { return 'skip' }                                     # known card/member already grounds it
  if ($accepted) { return 'skip' }                                     # the consented "yes" turn
  if (Test-IsCheckableFact $msg) { return 'web' }                      # public/role -> normal web path
  $label = Get-CleanEntityLabel $name
  if ([string]::IsNullOrEmpty($label) -or $label.Length -lt 2) { return 'web' }
  $personal = (Test-AsksContactInfo $msg) -or (Test-Possessive $msg) -or (Test-LooksLikePersonName $label)
  if (-not $personal) { return 'web' }                                 # general concept -> normal path
  if ($kgHit) { return 'force_kg' }                                    # grounded in his docs -> cited
  return 'decline'                                                     # nothing grounded -> honest decline
}

# ---------------------------------------------------------------------------------------
Write-Host "[1] helper truth tables (PS mirror of the JS regexes)"
Check "label looks like a person: 'Khalid Al-Otaibi'"      (Test-LooksLikePersonName 'Khalid Al-Otaibi')
Check "label looks like a person: 'Elon Musk'"             (Test-LooksLikePersonName 'Elon Musk')
Check "label looks like a person: 'Sara'"                  (Test-LooksLikePersonName 'Sara')
Check "NOT a person: 'quantum computing' (lowercase)"      (-not (Test-LooksLikePersonName 'quantum computing'))
Check "NOT a person: 'the president of egypt' (role/stop)" (-not (Test-LooksLikePersonName 'the president of egypt'))
Check "NOT a person: 'best restaurant nearby'"             (-not (Test-LooksLikePersonName 'best restaurant nearby'))
Check "contact-info: '...his phone number' -> true"        (Test-AsksContactInfo 'who is Khalid Al-Otaibi and his phone number')
Check "contact-info: '...email' -> true"                   (Test-AsksContactInfo 'what is his email')
Check "contact-info: plain 'who is X' -> false"            (-not (Test-AsksContactInfo 'who is Khalid Al-Otaibi'))
Check "cleanLabel strips contact tail -> 'Khalid Al-Otaibi'" ((Get-CleanEntityLabel 'Khalid Al-Otaibi and his phone number') -eq 'Khalid Al-Otaibi')
Check "cleanLabel strips leading my -> 'kafala operation'" ((Get-CleanEntityLabel 'my kafala operation') -eq 'kafala operation')
Check "cleanLabel leaves a plain name -> 'Elon Musk'"      ((Get-CleanEntityLabel 'Elon Musk') -eq 'Elon Musk')
Check "possessive: 'tell me about my kafala' -> true"      (Test-Possessive 'tell me about my kafala operation')
Check "possessive: 'who is the president' -> false"        (-not (Test-Possessive 'who is the president of egypt'))
Check "affirmative: 'yes' -> true"                         (Test-LooksAffirmative 'yes')
Check "affirmative: 'yes please' -> true"                  (Test-LooksAffirmative 'yes please')
Check "affirmative: 'go ahead' -> true"                    (Test-LooksAffirmative 'go ahead')
Check "affirmative: 'no' -> false"                         (-not (Test-LooksAffirmative 'no'))
Check "affirmative: a fresh question -> false"             (-not (Test-LooksAffirmative 'who is somebody else entirely please'))
Check "isCheckableFact: 'who is the president of egypt'"   (Test-IsCheckableFact 'who is the president of egypt')
Check "isCheckableFact: 'who is the ceo of uber'"          (Test-IsCheckableFact 'who is the ceo of uber')
Check "isCheckableFact: 'who founded google'"              (Test-IsCheckableFact 'who founded google')
Check "isCheckableFact: 'who is Khalid Al-Otaibi' -> NO"   (-not (Test-IsCheckableFact 'who is Khalid Al-Otaibi'))
Check "entityCardName: 'who is X' captures"                ((Get-EntityCardName 'who is Khalid Al-Otaibi and his phone number?') -ne '')
Check "entityCardName: 'how many drivers in Dubai?' -> none" ((Get-EntityCardName 'how many drivers in Dubai?') -eq '')

# ---------------------------------------------------------------------------------------
Write-Host "[2] FULL personal-vs-public gate over the brief's REAL prod probes"
# THE must-fix: bare name + PII, no match -> honest decline (never a stranger's PII).
Check "Khalid + phone, flag ON, no match -> DECLINE"        ((Get-GuardDecision 'who is Khalid Al-Otaibi and his phone number?' $true  $false $false $false) -eq 'decline')
Check "Khalid + phone, flag OFF -> off (byte-for-byte)"     ((Get-GuardDecision 'who is Khalid Al-Otaibi and his phone number?' $false $false $false $false) -eq 'off')
Check "bare 'who is Khalid Al-Otaibi', no match -> DECLINE" ((Get-GuardDecision 'who is Khalid Al-Otaibi?'                     $true  $false $false $false) -eq 'decline')
# MUST-NOT-REGRESS the working honesty / public lanes:
Check "public 'who is the president of Egypt?' -> WEB"      ((Get-GuardDecision 'who is the president of Egypt?'               $true  $false $false $false) -eq 'web')
Check "public 'who is the CEO of Uber?' -> WEB"             ((Get-GuardDecision 'who is the CEO of Uber?'                     $true  $false $false $false) -eq 'web')
Check "'how many drivers in Dubai?' -> SKIP (fleet path)"   ((Get-GuardDecision 'how many drivers in Dubai?'                  $true  $false $false $false) -eq 'skip')
Check "'what is the score of brazil and morocco?' -> SKIP"  ((Get-GuardDecision 'what is the score of brazil and morocco?'    $true  $false $false $false) -eq 'skip')
Check "'who is winning the match?' -> WEB (live, not personal)" ((Get-GuardDecision 'who is winning the match?'               $true  $false $false $false) -eq 'web')
Check "'tell me about quantum computing' -> WEB (concept)"  ((Get-GuardDecision 'tell me about quantum computing'             $true  $false $false $false) -eq 'web')
# kafala: served from his docs when present (cited), declined honestly when absent.
Check "kafala, flag ON, KG HIT -> force_kg (cited docs)"    ((Get-GuardDecision 'tell me about my kafala operation'           $true  $false $false $true ) -eq 'force_kg')
Check "kafala, flag ON, NO hit -> DECLINE"                  ((Get-GuardDecision 'tell me about my kafala operation'           $true  $false $false $false) -eq 'decline')
# known person (member/profile already matched) -> existing memory-ground, guard stays out.
Check "known member 'who is Sara?' (suppress) -> SKIP"      ((Get-GuardDecision 'who is Sara?'                                $true  $true  $false $false) -eq 'skip')
# the consented "yes" turn is handled by the consented-search, not the decline.
Check "accepted 'yes' turn -> SKIP (consented search runs)" ((Get-GuardDecision 'who is Khalid Al-Otaibi?'                    $true  $false $true  $false) -eq 'skip')

# ---------------------------------------------------------------------------------------
Write-Host "[3] orchestrator wire is flag-gated + fail-open + correct (static)"
Check "NEW flag M8_GROUNDING_GUARD gates the guard" ($orc.Contains('process.env.M8_GROUNDING_GUARD === "1"'))
Check "guard condition excludes the public/role ask" ($orc.Contains('!entityCardSuppressSearch && !_ggAcceptedSearch && !isCheckableFact(baseMessage)'))
Check "isCheckableFact imported from intentClassifier" ($orc.Contains('isSelfStatus, isCheckableFact, classifyDriverProfile'))
Check "decline is initialised null (OFF => stays null => no return)" ($orc.Contains('let groundingDecline = null;'))
Check "accepted-search is initialised null (OFF => inert)" ($orc.Contains('let _ggAcceptedSearch = null;'))
Check "decline SAVES then RETURNS (conversation continuity)" (($orc.Contains('await saveMemory(sessionId, message, groundingDecline)')) -and ($orc.Contains('return groundingDecline;')))
Check "KG hit forces the CITED docs path (never web-scrape)" (($orc.Contains('grounding_guard_kg_hit')) -and ($orc.Contains('forceKnowledgeLookup = true;')))
Check "consented search uses search(_ggAcceptedSearch, INTENT.LOOKUP)" ($orc.Contains('searchData = await search(_ggAcceptedSearch, INTENT.LOOKUP)'))
Check "follow-up resolves the asked name via the arbiter helper" ($orc.Contains('_arbiter.originalQuestion(history)'))
Check "NONE-router gate carries the new !_ggAcceptedSearch term" ($orc.Contains('!entityCardSuppressSearch && !forceKnowledgeLookup && !_ggAcceptedSearch)'))
Check "GROUNDING_SENTINEL marker defined" ($orc.Contains('const GROUNDING_SENTINEL'))
Check "guard helpers present" (($orc.Contains('function looksLikePersonName')) -and ($orc.Contains('function asksContactInfo')) -and ($orc.Contains('function cleanEntityLabel')) -and ($orc.Contains('function lastWasGroundingOffer')) -and ($orc.Contains('function looksAffirmative')))

# fail-OPEN: the guard body is wrapped in its own try/catch and the KG check fails toward
# NOT declining (a missed guard is fine; a wrong decline is not).
$gi = $orc.IndexOf('GROUNDING / HONESTY GUARD (behind M8_GROUNDING_GUARD')
$gj = $orc.IndexOf('if (groundingDecline) {', [Math]::Max(0,$gi))
Check "guard block located" (($gi -ge 0) -and ($gj -gt $gi))
if (($gi -ge 0) -and ($gj -gt $gi)) {
  $block = $orc.Substring($gi, $gj - $gi)
  Check "guard block has its own try/catch (fail-open)" ($block.Contains('catch (e)') -and $block.Contains('grounding guard error'))
  Check "guard declines ONLY on a clean KG no-hit (_kgOk && !_kgHit)" ($block.Contains('_kgOk && !_kgHit'))
  Check "grounding check searches KG by the CLEANED LABEL (not the full turn)" ($block.Contains('searchKnowledgeGraph(_label, 6)'))
  Check "grounding check does NOT search by the full message (avoids phone/number false hits)" (-not $block.Contains('searchKnowledgeGraph(effectiveMessage'))
  Check "guard never reassigns arb/searchData inside the decision" ((-not [regex]::IsMatch($block, '\barb\s*=')) -and (-not [regex]::IsMatch($block, '\bsearchData\s*=')))
}

# ---------------------------------------------------------------------------------------
Write-Host ""
if ($script:fail -gt 0) {
  Write-Host ("build167 grounding-guard mirror: FAIL ({0} check(s) failed)" -f $script:fail)
  exit 1
}
Write-Host "build167 grounding-guard mirror: OK (all checks passed)"
exit 0
