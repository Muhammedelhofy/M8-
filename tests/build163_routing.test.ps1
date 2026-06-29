# tests/build163_routing.test.ps1 -- Build-163 routing: read-my-docs DOMINANT.
# Bug: "what does my CV say about my EARNINGS" tied knowledge=2 with fleet=2 ("earnings")
# -> AMBIGUOUS -> the B-156 lookup flip never forced searchKnowledgeGraph (ask-my-docs
# starved). Fix: an explicit doc reference (cv/resume/docs/documents/books/sources) in a
# read context -> knowledge, non-ambiguous, BEFORE the fleet hint + wallet/fleet contest.
# SAFETY (this is the risky one): negative cases prove it does NOT steal wallet/fleet/notes.
# PS-5.1: ASCII-only mirror of DOC_READ_DOMINANT (drops the optional accent branch).

$pass = 0; $fail = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }

$arb = Get-Content -Raw (Join-Path $PSScriptRoot "..\lib\domain-arbiter.js")

# ---------------------------------------------------------------------------
# 1. STATIC guards (incl. ordering: override must precede the wallet/fleet contest)
# ---------------------------------------------------------------------------
Write-Host "`n-- Static source guards --" -ForegroundColor Cyan
CheckTrue "DOC_READ_DOMINANT defined"            ($arb.Contains('const DOC_READ_DOMINANT'))
CheckTrue "override returns why=doc_read_dominant" ($arb.Contains('"doc_read_dominant"'))
CheckTrue "excludes notes (not in doc nouns)"    (-not ($arb -match '_DOC_NOUN[^\r\n]*notes'))
$iOverride = $arb.IndexOf('doc_read_dominant')
$iContest  = $arb.IndexOf('contest_wallet_fleet')
CheckTrue "override runs BEFORE wallet/fleet contest" ($iOverride -gt 0 -and $iContest -gt 0 -and $iOverride -lt $iContest)

# ---------------------------------------------------------------------------
# 2. Behavioral mirror of DOC_READ_DOMINANT
# ---------------------------------------------------------------------------
$DOC = 'cv|resumes?|docs?|documents?|books?|sources?|knowledge\s*base'
$re = '\bmy\s+(?:' + $DOC + ')\b[^?.!]{0,45}?\b(?:say|says|said|states?|mentions?|shows?|covers?|includes?|about)\b' +
      '|\b(?:in|according\s+to|from|search(?:ing)?|pull\s+from|look\s+in|check)\s+(?:my\s+)?(?:' + $DOC + ')\b' +
      '|\bwhat(?:''?s| is| are| does| do| did)?\b[^?.!]{0,30}?\bmy\s+(?:' + $DOC + ')\b'
function IsDocRead([string]$m) { return ($m -match $re) }

Write-Host "`n-- POSITIVE: should route to knowledge (ask-my-docs) --" -ForegroundColor Cyan
CheckTrue "CV + earnings (the fixed case)"   (IsDocRead "what does my CV say about my earnings and acquisition results")
CheckTrue "CV + Careem (still works)"         (IsDocRead "what does my CV say about my Careem experience")
CheckTrue "CV + salary (money word, but doc)" (IsDocRead "what does my CV say about my salary")
CheckTrue "in my resume"                      (IsDocRead "in my resume, what experience do I have with operations")
CheckTrue "according to my sources"           (IsDocRead "according to my sources, what is the trend")
CheckTrue "search my docs"                    (IsDocRead "search my docs for the supply playbook")
CheckTrue "what's in my cv"                   (IsDocRead "what's in my cv about leadership")
CheckTrue "my resume mentions"               (IsDocRead "does my resume mention any management roles")

Write-Host "`n-- NEGATIVE: must NOT be stolen into knowledge --" -ForegroundColor Cyan
CheckFalse "notes store stays notes"         (IsDocRead "search my notes for the fleet strategy")
CheckFalse "wallet spend (my files generic)" (IsDocRead "how much did I spend on my files")
CheckFalse "fleet net query"                 (IsDocRead "what's my net today")
CheckFalse "fleet report (no doc noun)"      (IsDocRead "write me a report on fleet performance")
CheckFalse "threshold count (fleet)"         (IsDocRead "how many drivers are above 4000 net")
CheckFalse "wallet add"                       (IsDocRead "add 50 sar groceries")
CheckFalse "wallet balance"                  (IsDocRead "what's my balance")
CheckFalse "generic chat"                     (IsDocRead "how are you doing today")
CheckFalse "kafala (no doc ref -> stays memory; honest non-goal)" (IsDocRead "tell me about my kafala operation")

Write-Host "`n================ B-163 ROUTING RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
