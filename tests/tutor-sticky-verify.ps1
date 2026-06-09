# M8 Sticky Tutor Session - PowerShell .NET-regex port
# Mirrors detectStickyTutor() + TUTOR_EXIT in lib/orchestrator.js
# Run: powershell -ExecutionPolicy Bypass -File tests/tutor-sticky-verify.ps1

$ErrorActionPreference = 'Stop'
$opts = [Text.RegularExpressions.RegexOptions]::IgnoreCase

# ported from lib/orchestrator.js (keep in sync)
$TUTOR_TRIGGER   = '^\s*(tutor(?:\s+me)?|teach(?:\s+me)?|quiz\s+me|test\s+me|coach\s+me|be\s+my\s+tutor)\b[\s:,\-]+'
$TUTOR_HEURISTIC = '\b(help\s+me\s+(?:learn|understand|master|study|grasp)|i\s+want\s+to\s+(?:learn|understand|master)|i''?m\s+trying\s+to\s+(?:learn|understand|wrap\s+my\s+head)|explain\s+(?:it\s+)?like\s+i''?m|eli5|can\s+you\s+teach\s+me|study\s+(?:with|for))\b'
$TUTOR_EXIT      = '\b(end\s+(?:tutor(?:ing)?|session|lesson|teaching|the\s+lesson)|stop\s+(?:tutor(?:ing)?|teach(?:ing)?|the\s+lesson)|exit\s+(?:tutor(?:ing)?|teach(?:ing)?)|quit\s+(?:tutoring|the\s+lesson)|just\s+(?:tell|give)\s+me\s+(?:the\s+answer|directly|straight)|skip\s+the\s+(?:questions?|socratic)|go\s+back\s+to\s+normal|regular\s+mode|answer\s+directly|stop\s+being\s+socratic)\b'

function DetectTutor([string]$m) {
  if ([regex]::IsMatch($m, $TUTOR_TRIGGER, $opts)) {
    $c = [regex]::Replace($m, $TUTOR_TRIGGER, '', $opts).Trim()
    if ($c -eq '') { $c = $m }
    return @{ tutor = $true; cleaned = $c }
  }
  if ([regex]::IsMatch($m, $TUTOR_HEURISTIC, $opts)) { return @{ tutor = $true; cleaned = $m } }
  return @{ tutor = $false; cleaned = $m }
}

function IsExit([string]$m) {
  return [regex]::IsMatch($m, $TUTOR_EXIT, $opts)
}

function Msg([string]$role, [string]$content) { return @{ role=$role; content=$content } }

# detectStickyTutor port
function DetectStickyTutor($history) {
  if ($null -eq $history -or $history.Count -lt 2) { return $null }

  $tutorStartIdx = -1
  $topic = ''
  $usersSeen = 0

  for ($i = $history.Count - 1; $i -ge 0; $i--) {
    $msg = $history[$i]
    if ($msg.role -ne 'user') { continue }
    $usersSeen++
    if ($usersSeen -gt 6) { break }
    if (IsExit $msg.content) { break }
    $ttm = DetectTutor $msg.content
    if ($ttm.tutor) { $tutorStartIdx = $i; $topic = $ttm.cleaned; break }
  }

  if ($tutorStartIdx -lt 0) { return $null }

  for ($i = $tutorStartIdx + 1; $i -lt $history.Count; $i++) {
    if ($history[$i].role -eq 'user' -and (IsExit $history[$i].content)) { return $null }
  }

  $last_q = ''
  for ($i = $history.Count - 1; $i -gt $tutorStartIdx; $i--) {
    if ($history[$i].role -ne 'assistant') { continue }
    $text = $history[$i].content
    $sentences = [regex]::Split($text, '(?<=[.!?])\s+|(?<=[.!?])$')
    for ($k = $sentences.Count - 1; $k -ge 0; $k--) {
      $s = $sentences[$k].Trim()
      if ($s.EndsWith('?')) { $last_q = $s; break }
    }
    break
  }

  return @{ topic = $topic; last_question = $last_q }
}

$pass = 0; $fail = 0
function Check($name, $cond, $expected) {
  $ok = ($cond -eq $expected)
  if ($ok) { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$cond', expected '$expected')" -ForegroundColor Red }
}

Write-Host "`n-- TUTOR_EXIT fires --"
Check "end tutor"               (IsExit "end tutor") $true
Check "end tutoring"            (IsExit "end tutoring") $true
Check "end session"             (IsExit "end session") $true
Check "stop teaching"           (IsExit "stop teaching") $true
Check "just tell me the answer" (IsExit "just tell me the answer") $true
Check "just give me directly"   (IsExit "just give me directly") $true
Check "go back to normal"       (IsExit "go back to normal") $true
Check "regular mode"            (IsExit "regular mode please") $true
Check "answer directly"         (IsExit "answer directly") $true
Check "stop being socratic"     (IsExit "stop being socratic") $true
Check "exit tutoring"           (IsExit "exit tutoring") $true
Check "quit tutoring"           (IsExit "quit tutoring") $true
Check "skip the questions"      (IsExit "skip the questions") $true

Write-Host "`n-- TUTOR_EXIT does NOT fire on normal messages --"
Check "normal question"         (IsExit "what is compound interest?") $false
Check "fleet question"          (IsExit "how did the fleet do yesterday?") $false
Check "good morning"            (IsExit "good morning") $false
Check "answer a question"       (IsExit "can you answer a question for me?") $false
Check "i want to learn"         (IsExit "i want to learn bayes theorem") $false

Write-Host "`n-- active session: trigger in prior turn --"
$h1 = @(
  (Msg 'user'      'tutor: compound interest'),
  (Msg 'assistant' "Let's explore this. What do you think happens to your principal over time - does it change?")
)
$r1 = DetectStickyTutor $h1
Check "topic extracted"      ($r1.topic)         "compound interest"
Check "last_question found"  ($r1.last_question.EndsWith('?')) $true

Write-Host "`n-- active session: topic + 2 turns deep --"
$h2 = @(
  (Msg 'user'      'tutor: bayes theorem'),
  (Msg 'assistant' "Good. What do you already know about probability?"),
  (Msg 'user'      'just basic probability, like P(A)'),
  (Msg 'assistant' "Nice. So given that, how would you describe conditional probability - P(A|B)?")
)
$r2 = DetectStickyTutor $h2
Check "topic 2-turn"         ($r2.topic)         "bayes theorem"
Check "last_q 2-turn"        ($r2.last_question) "So given that, how would you describe conditional probability - P(A|B)?"

Write-Host "`n-- no active session: no tutor trigger in history --"
$h3 = @(
  (Msg 'user'      'how did the fleet do yesterday?'),
  (Msg 'assistant' "June 8 net was 4535 SAR.")
)
$r3 = DetectStickyTutor $h3
Check "no session (fleet)"   ($null -eq $r3) $true

Write-Host "`n-- session ended: exit signal after trigger --"
$h4 = @(
  (Msg 'user'      'tutor: calculus'),
  (Msg 'assistant' "What do you know about limits?"),
  (Msg 'user'      'end tutor'),
  (Msg 'assistant' "Sure, back to normal. What do you need?"),
  (Msg 'user'      'what is a derivative?')
)
$r4 = DetectStickyTutor $h4
Check "exit kills session"   ($null -eq $r4) $true

Write-Host "`n-- session ended: exit in followup message --"
$h5 = @(
  (Msg 'user'      'tutor: set theory'),
  (Msg 'assistant' "What sets do you know?"),
  (Msg 'user'      'just tell me the answer please')
)
$r5 = DetectStickyTutor $h5
Check "exit in followup"     ($null -eq $r5) $true

Write-Host "`n-- lookback limit: trigger older than 6 user turns --"
$h6 = @(
  (Msg 'user'      'tutor: integrals'),
  (Msg 'assistant' "What is an integral?"),
  (Msg 'user'      'a sum?'),
  (Msg 'assistant' "Good. Riemann sums?"),
  (Msg 'user'      'yes'),
  (Msg 'assistant' "And the fundamental theorem?"),
  (Msg 'user'      'ok I think I get it'),
  (Msg 'assistant' "Great. What about improper integrals?"),
  (Msg 'user'      'hmm not sure'),
  (Msg 'assistant' "Let me check: when does an integral diverge?"),
  (Msg 'user'      'when it goes to infinity?'),
  (Msg 'assistant' "Exactly. How about this..."),
  (Msg 'user'      'what is the integral of 1/x from 1 to e?')
)
$r6 = DetectStickyTutor $h6
Check "lookback limit"       ($null -eq $r6) $true

Write-Host "`n-- single-turn history: no sticky possible --"
$h7 = @( (Msg 'user' 'hello') )
$r7 = DetectStickyTutor $h7
Check "too short"            ($null -eq $r7) $true

Write-Host "`n-- TUTOR_EXIT check on current message --"
Check "exit fires on current"  (IsExit "stop being socratic") $true
Check "exit silent on normal"  (IsExit "what is the next step?") $false

Write-Host "`n-- session with no question in assistant turn --"
$h8 = @(
  (Msg 'user'      'help me understand bayes theorem'),
  (Msg 'assistant' "Of course! Thomas Bayes worked on conditional probability. Here is the formula: P(A|B) = P(B|A)P(A)/P(B). This is the core idea.")
)
$r8 = DetectStickyTutor $h8
Check "heuristic trigger active" ($null -ne $r8) $true
Check "no ? -> empty last_q"    ($r8.last_question) ''

Write-Host "`n-- empty history --"
$r9 = DetectStickyTutor @()
Check "null on empty"        ($null -eq $r9) $true

Write-Host "`n-- exit in TRIGGER message itself (not prior) --"
$h10 = @(
  (Msg 'user'      'tutor: set theory'),
  (Msg 'assistant' "What do you know about sets?"),
  (Msg 'user'      'end tutor, just answer directly')
)
$r10 = DetectStickyTutor $h10
Check "exit in latest user"  ($null -eq $r10) $true

Write-Host ""
$total = $pass + $fail
if ($fail -eq 0) {
  Write-Host "ALL $total TESTS PASSED" -ForegroundColor Green
} else {
  Write-Host "$fail/$total FAILED" -ForegroundColor Red
  exit 1
}
