# Build-76: Smarter Context Routing -- offline, pure PS 5.1, ASCII only.
# Verifies the shared-core short-term topic-memory layer:
#   1. isContextlessFollowUp: continuation cues + bare temporal fragments + length cap
#   2. CONVERSATIONAL_RE guard excludes greetings/acks
#   3. Arabic cue / fragment behavior (built from code points -- no Arabic literals)
#   4. Source wiring: helpers, guards, fold, both orchestrate paths, exports
#   5. router.js decideAction topicHint plumbing
#   6. buildState bumped to Build-76
# No live calls. No Node required (mirrors the pure regex logic + asserts source).

$ErrorActionPreference = 'Stop'
$pass = 0
$fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else       { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$orchPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\orchestrator.js"))
$routerPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\router.js"))
$bsPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\buildState.js"))
$orch   = [IO.File]::ReadAllText($orchPath, [Text.Encoding]::UTF8)
$router = [IO.File]::ReadAllText($routerPath, [Text.Encoding]::UTF8)
$bs     = [IO.File]::ReadAllText($bsPath, [Text.Encoding]::UTF8)

Write-Host "Build-76 smarter context routing verify`n"

# ---------------------------------------------------------------------------
# 1. isContextlessFollowUp -- PS mirror of the JS regex logic (English)
# ---------------------------------------------------------------------------
Write-Host "-- 1. isContextlessFollowUp behavior --"

$cue  = '^(?:and|also|plus|then|alright|what about|how about|and what about|same|the same|do the same|more|even more|again|too|as well|both|all of them|the (?:others?|rest)|that one|those|these|which one|why(?:\s+not)?|really)\b'
$frag = '^(?:the\s+)?(?:last|next|this|previous|prev)\s+(?:week|month|year|quarter|day)\b|^(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\s*[?]?$|^(?:yesterday|today|tonight|tomorrow)\b'

function Is-Followup([string]$m) {
  $m = $m.Trim()
  if (-not $m) { return $false }
  $wc = (($m -split '\s+') | Where-Object { $_ -ne '' }).Count
  if ($wc -gt 12) { return $false }
  return ($m -imatch $cue) -or ($m -imatch $frag)
}

# positives -- bare follow-ups that should inherit the topic
Assert-True "'and last month?' is a follow-up"            (Is-Followup "and last month?")
Assert-True "'what about the dead-ends?' is a follow-up"  (Is-Followup "what about the dead-ends?")
Assert-True "'why?' is a follow-up"                       (Is-Followup "why?")
Assert-True "'why not?' is a follow-up"                   (Is-Followup "why not?")
Assert-True "'more' is a follow-up"                       (Is-Followup "more")
Assert-True "'the others too' is a follow-up"             (Is-Followup "the others too")
Assert-True "'last month?' is a follow-up"               (Is-Followup "last month?")
Assert-True "'the 7th' is a follow-up"                    (Is-Followup "the 7th")
Assert-True "'yesterday' is a follow-up"                  (Is-Followup "yesterday")
Assert-True "'and Ahmed?' is a follow-up"                 (Is-Followup "and Ahmed?")

# negatives -- messages that state their own subject (no carry)
Assert-True "'what's our net this month?' NOT a follow-up"     (-not (Is-Followup "what's our net this month?"))
Assert-True "'tell me a joke' NOT a follow-up"                 (-not (Is-Followup "tell me a joke"))
Assert-True "'show me the driver rankings' NOT a follow-up"    (-not (Is-Followup "show me the driver rankings"))
Assert-True "'what is the capital of France' NOT a follow-up"  (-not (Is-Followup "what is the capital of France"))
Assert-True "long >12-word message NOT a follow-up" (
  -not (Is-Followup "and tell me about the history of rome and its empire and more please")
)
Assert-True "empty string NOT a follow-up"                     (-not (Is-Followup "   "))

# ---------------------------------------------------------------------------
# 2. CONVERSATIONAL_RE guard -- greetings / acks must be excluded
# ---------------------------------------------------------------------------
Write-Host "`n-- 2. conversational guard --"
$conv = '^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|cool|nice|great|good (morning|afternoon|evening|night)|salam)\b'
Assert-True "'ok thanks' is conversational (skip carry)"  ("ok thanks" -imatch $conv)
Assert-True "'thanks!' is conversational"                 ("thanks!" -imatch $conv)
Assert-True "'hello' is conversational"                   ("hello" -imatch $conv)
Assert-True "'and last month?' NOT conversational"        (-not ("and last month?" -imatch $conv))

# ---------------------------------------------------------------------------
# 3. Arabic cue / fragment behavior (code points -- no Arabic literals)
# ---------------------------------------------------------------------------
Write-Host "`n-- 3. Arabic follow-up cues --"
# lesh (why) = U+0644 U+064A U+0634
$lesh    = [string][char]0x0644 + [char]0x064A + [char]0x0634
# nafs (same) = U+0646 U+0641 U+0633
$nafs    = [string][char]0x0646 + [char]0x0641 + [char]0x0633
# embareh (yesterday) = U+0627 U+0645 U+0628 U+0627 U+0631 U+062D
$embareh = [string][char]0x0627 + [char]0x0645 + [char]0x0628 + [char]0x0627 + [char]0x0631 + [char]0x062D
# nazal (dropped) = U+0646 U+0632 U+0644
$nazal   = [string][char]0x0646 + [char]0x0632 + [char]0x0644

$arCue  = '^(?:' + $lesh + '|' + $nafs + ')(?=\s|$|[?])'
$arFrag = '^(?:' + $embareh + ')(?=\s|$|[?])'

Assert-True "Arabic 'lesh nazal' matches cue"  (($lesh + ' ' + $nazal) -match $arCue)
Assert-True "Arabic 'nafs' matches cue"        ($nafs -match $arCue)
Assert-True "Arabic 'embareh' matches fragment" ($embareh -match $arFrag)

# Source carries the Arabic cue/fragment tokens
Assert-True "orchestrator.js FOLLOWUP_CUE_RE contains Arabic lesh" ($orch.Contains($lesh))
Assert-True "orchestrator.js BARE_FRAGMENT_RE contains Arabic embareh" ($orch.Contains($embareh))

# ---------------------------------------------------------------------------
# 4. Source wiring -- helpers, guards, fold, both paths, exports
# ---------------------------------------------------------------------------
Write-Host "`n-- 4. orchestrator.js wiring --"
Assert-True "isContextlessFollowUp defined"  ($orch -match "function isContextlessFollowUp")
Assert-True "inferConversationTopic defined" ($orch -match "function inferConversationTopic")
Assert-True "currentClaimsTopic defined"     ($orch -match "function currentClaimsTopic")
Assert-True "topicMemoryRoute defined"       ($orch -match "function topicMemoryRoute")
Assert-True "FOLLOWUP_CUE_RE present"        ($orch -match "FOLLOWUP_CUE_RE")
Assert-True "BARE_FRAGMENT_RE present"       ($orch -match "BARE_FRAGMENT_RE")
Assert-True "DOMAIN_TOPICS present"          ($orch -match "DOMAIN_TOPICS")
Assert-True "TOPIC_HINT_LABEL present"       ($orch -match "TOPIC_HINT_LABEL")

# guard sequence (the tight safety conditions)
Assert-True "guard: slot-fill-merge bypass" ($orch -match "effectiveMessage !== baseMessage\) return out")
Assert-True "guard: intent NONE only"       ($orch -match "intent !== INTENT.NONE\) return out")
Assert-True "guard: conversational excluded" ($orch -match "CONVERSATIONAL_RE\.test\(baseMessage")
Assert-True "guard: lane-command + personal excluded" ($orch -match "claimsOwnLane\(baseMessage\) \|\| isPersonal\(baseMessage\)")
Assert-True "guard: must be a contextless follow-up" ($orch -match "isContextlessFollowUp\(baseMessage\)")
Assert-True "guard: no double-fire (currentClaimsTopic)" ($orch -match "!currentClaimsTopic\(baseMessage, tmem.topic\)")
Assert-True "fold: anchorQuery prepended to baseMessage" (
  $orch -match 'tmem\.anchorQuery\} \$\{baseMessage'
)

# inferConversationTopic structure: most-recent-first, three domain detectors, web fallback
Assert-True "infer scans user turns newest-first" ($orch -match "for \(let i = h.length - 1, seen = 0")
Assert-True "infer uses looksFleet"   ($orch -match "looksFleet\(q\)")
Assert-True "infer uses looksFinance" ($orch -match "looksFinance\(q\)")
Assert-True "infer uses looksNotebook" ($orch -match "looksNotebook\(q\)")
Assert-True "infer has web fallback"  ($orch -match 'topic: "web"')

# orchestrate() integration
Assert-True "orchestrate calls topicMemoryRoute" ($orch -match "const _tmem = topicMemoryRoute\(")
Assert-True "orchestrate logs topic_carry"       ($orch -match 'log\("topic_carry"')
Assert-True "orchestrate passes topicHint to decideAction" (
  $orch -match "decideAction\(\{ message: effectiveMessage, history, topicHint \}\)"
)

# orchestrateStream() mirror
Assert-True "stream mirrors topicMemoryRoute" ($orch -match "const _tm = topicMemoryRoute\(")
Assert-True "stream uses hasImageAttachments for imgTurn" (
  $orch -match "imgTurn: hasImageAttachments\(attachments\)"
)

# exports for this test
Assert-True "exports topicMemoryRoute trio" (
  $orch -match "isContextlessFollowUp, inferConversationTopic, topicMemoryRoute"
)

# ---------------------------------------------------------------------------
# 5. router.js decideAction topicHint plumbing
# ---------------------------------------------------------------------------
Write-Host "`n-- 5. router.js topicHint --"
Assert-True "decideAction accepts topicHint" ($router -match "async function decideAction\(\{ message, history, topicHint \}\)")
Assert-True "topicLine built from topicHint"  ($router -match "const topicLine = topicHint")
Assert-True "system + topicLine sent to generate" ($router -match "systemInstruction: system \+ topicLine")
Assert-True "CONVERSATION CONTEXT directive present" ($router -match "CONVERSATION CONTEXT:")

# ---------------------------------------------------------------------------
# 6. buildState bumped to Build-76
# ---------------------------------------------------------------------------
Write-Host "`n-- 6. buildState bump --"
Assert-True "buildState updated comment is Build-76" ($bs -match "Build-76 smarter context routing")
Assert-True "buildState live[] has Build-76 entry"   ($bs -match "Build-76 SMARTER CONTEXT ROUTING")
Assert-True "buildState commitFamily mentions Build-76" (
  ([regex]::Matches($bs, "Build-76 SMARTER CONTEXT ROUTING")).Count -ge 2
)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Build-76 smarter context routing verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
