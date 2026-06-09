# M8 Socratic Tutor mode - PowerShell .NET-regex verification port
# Mirrors detectTutorMode() in lib/orchestrator.js so the gate can be verified
# WITHOUT local node (project's standard no-node path). Run:
#   powershell -File tests/tutor-mode-verify.ps1
# Pure-ASCII on purpose (PS 5.1 mangles multibyte in no-BOM UTF-8 .ps1).

$ErrorActionPreference = 'Stop'
$opts = [Text.RegularExpressions.RegexOptions]::IgnoreCase

# -- ported from lib/orchestrator.js (keep in sync) --
$TUTOR_TRIGGER   = '^\s*(tutor(?:\s+me)?|teach(?:\s+me)?|quiz\s+me|test\s+me|coach\s+me|be\s+my\s+tutor)\b[\s:,\-]+'
$TUTOR_HEURISTIC = '\b(help\s+me\s+(?:learn|understand|master|study|grasp)|i\s+want\s+to\s+(?:learn|understand|master)|i''?m\s+trying\s+to\s+(?:learn|understand|wrap\s+my\s+head)|explain\s+(?:it\s+)?like\s+i''?m|eli5|can\s+you\s+teach\s+me|study\s+(?:with|for))\b'

# detectTutorMode equivalent -> @{ tutor=$bool; cleaned=$str }
function DetectTutor([string]$m) {
  if ([regex]::IsMatch($m, $TUTOR_TRIGGER, $opts)) {
    $c = [regex]::Replace($m, $TUTOR_TRIGGER, '', $opts).Trim()
    if ($c -eq '') { $c = $m }
    return @{ tutor = $true; cleaned = $c }
  }
  if ([regex]::IsMatch($m, $TUTOR_HEURISTIC, $opts)) { return @{ tutor = $true; cleaned = $m } }
  return @{ tutor = $false; cleaned = $m }
}

$pass = 0; $fail = 0
function Check($name, $cond, $expected) {
  $ok = ($cond -eq $expected)
  if ($ok) { $script:pass++ } else { $script:fail++; Write-Host "  FAIL: $name (got $cond, expected $expected)" -ForegroundColor Red }
}

Write-Host "`n-- TRIGGER prefixes fire (and strip) --"
Check "tutor:"            (DetectTutor "tutor: bayes theorem").tutor $true
Check "teach me"          (DetectTutor "teach me how compound interest works").tutor $true
Check "teach <subj>"      (DetectTutor "teach calculus from scratch").tutor $true
Check "quiz me"           (DetectTutor "quiz me on set theory").tutor $true
Check "test me on"        (DetectTutor "test me on multiplication tables").tutor $true
Check "coach me"          (DetectTutor "coach me through this proof").tutor $true
Check "be my tutor"       (DetectTutor "be my tutor for linear algebra").tutor $true

Write-Host "`n-- prefix stripped into cleaned --"
Check "strip tutor:"      ((DetectTutor "tutor: bayes theorem").cleaned -eq "bayes theorem") $true
Check "strip teach me"    ((DetectTutor "teach me eigenvalues").cleaned -eq "eigenvalues") $true
# bare "teach me" still fires (user wants teaching); residue "me" is harmless -
# the directive's calibrate step asks what to learn.
Check "bare teach me fires" (DetectTutor "teach me").tutor $true
Check "empty body -> fallback" ((DetectTutor "tutor:").cleaned -eq "tutor:") $true

Write-Host "`n-- HEURISTIC fires (no prefix, clear learn intent) --"
Check "help me understand"   (DetectTutor "help me understand eigenvalues").tutor $true
Check "i want to learn"      (DetectTutor "I want to learn probability").tutor $true
Check "i'm trying to learn"  (DetectTutor "I'm trying to understand gradient descent").tutor $true
Check "explain like i'm 5"   (DetectTutor "explain it like I'm 5: entropy").tutor $true
Check "eli5"                 (DetectTutor "eli5 recursion").tutor $true
Check "can you teach me"     (DetectTutor "can you teach me regex").tutor $true
Check "study for"            (DetectTutor "let's study for my stats exam").tutor $true

Write-Host "`n-- NEGATIVES do NOT fire (operational / quick-answer) --"
Check "fleet net"            (DetectTutor "what's the fleet net yesterday").tutor $false
Check "compute prefix"       (DetectTutor "compute 17 factorial").tutor $false
Check "verify prefix"        (DetectTutor "verify: FV of 1000 a month").tutor $false
Check "explain the bug"      (DetectTutor "explain the bug in this code").tutor $false
Check "help me fix"          (DetectTutor "help me fix this error").tutor $false
Check "summarize"            (DetectTutor "summarize this article").tutor $false
Check "morning brief"        (DetectTutor "give me the morning brief").tutor $false
Check "mid-sentence teach"   (DetectTutor "what does this experience teach us").tutor $false
Check "greeting"             (DetectTutor "hey, how's it going").tutor $false

Write-Host "`n-- COMPOSITION with compute (chain: compute then tutor) --"
# orchestrator chains: cm = detectCompute(message); tm = detectTutor(cm.cleaned)
$COMPUTE_TRIGGER = '^\s*(compute|calc(?:ulate)?|run\s+(?:the\s+)?code|simulate|crunch(?:\s+the\s+numbers)?)\b[\s:,\-]+'
function DetectCompute([string]$m) {
  if ([regex]::IsMatch($m, $COMPUTE_TRIGGER, $opts)) {
    $c = [regex]::Replace($m, $COMPUTE_TRIGGER, '', $opts).Trim(); if ($c -eq '') { $c = $m }
    return @{ compute = $true; cleaned = $c }
  }
  return @{ compute = $false; cleaned = $m }
}
# "tutor: compute fib" -> compute prefix does NOT match (starts with tutor), tutor strips -> useCompute via tutorMode
$cm1 = DetectCompute "tutor: compute the 10th fibonacci"
$tm1 = DetectTutor $cm1.cleaned
Check "tutor:+compute -> tutor true"   $tm1.tutor $true
Check "tutor:+compute -> compute false" $cm1.compute $false
Check "tutor:+compute cleaned"          ($tm1.cleaned -eq "compute the 10th fibonacci") $true
# "compute: tutor me on primes" -> compute strips first, then tutor strips
$cm2 = DetectCompute "compute: tutor me on primes"
$tm2 = DetectTutor $cm2.cleaned
Check "compute:+tutor -> compute true" $cm2.compute $true
Check "compute:+tutor -> tutor true"   $tm2.tutor $true
Check "compute:+tutor cleaned"         ($tm2.cleaned -eq "on primes") $true

Write-Host "`n===================================================="
$col = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("RESULT: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $col
if ($fail -gt 0) { exit 1 }
