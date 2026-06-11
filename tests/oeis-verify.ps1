# M8 -- OEIS Sequence Probe port-verification (Build-8)
# Tests detection + note-building logic ported from lib/discovery.js
# Run: powershell -ExecutionPolicy Bypass -File tests/oeis-verify.ps1

$pass = 0; $fail = 0
function Ok($label, $ok) {
  if ($ok) { Write-Host "  PASS  $label" -ForegroundColor Green; $script:pass++ }
  else      { Write-Host "  FAIL  $label" -ForegroundColor Red;   $script:fail++ }
}

Write-Host "`n-- OEIS detection --`n"

# ── Regexes (ported from discovery.js) ───────────────────────────────────────
$OEIS_ID_RE   = [regex]'\bA\d{6}\b'
$OEIS_ANALYZE = [regex]'(?i)\b(?:analyz|find\s+(?:the\s+)?(?:pattern|formula|rule)|what\s+(?:is\s+the\s+)?(?:pattern|formula|rule)|what\s+(?:formula|rule)\s+generates?|figure\s+out\s+(?:the\s+)?(?:pattern|formula)|stud(?:y|ying?)|examin|investigat)'
$SEQUENCE_NOUN= [regex]'(?i)\b(?:sequence|series|progression|terms?)\b'
$RAW_NUMS_RE  = [regex]'\b\d+(?:[\s,]+\d+){3,}\b'
$BOUND_RE     = [regex]'(?i)\b(?:up\s+to|below|under|first|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|k|m))?|10\s*\^\s*\d+|1e\d+|2\s*\^\s*\d+)\b'
$RESEARCH_TGT = [regex]'(?i)\b(conjecture|hypothesis|collatz|goldbach|twin\s+primes?|primes?|perfect\s+numbers?|fibonacci|oeis|sequence|riemann|mersenne)\b'

# Port of detectOEISProbe logic
function Detect($s) {
  if ($s.Length -lt 8) { return $false }
  if ($OEIS_ID_RE.IsMatch($s)) { return $true }
  if (-not $OEIS_ANALYZE.IsMatch($s)) { return $false }
  $hasRaw  = $RAW_NUMS_RE.IsMatch($s)
  $hasSeq  = $SEQUENCE_NOUN.IsMatch($s)
  $hasRes  = $RESEARCH_TGT.IsMatch($s)
  $hasBnd  = $BOUND_RE.IsMatch($s)
  if (-not $hasRaw -and -not $hasSeq -and -not $hasRes) { return $false }
  if ($hasBnd -and -not $hasRaw) { return $false }
  return $true
}

# Should fire
Ok "OEIS ID A000045"          (Detect "explore OEIS A000045")
Ok "raw sequence + analyze"   (Detect "analyze 1, 1, 2, 3, 5, 8, 13")
Ok "what pattern in nums"     (Detect "what is the pattern in 0, 1, 4, 9, 16, 25")
Ok "find formula Fibonacci"   (Detect "find the formula for Fibonacci numbers")
Ok "study triangular sequence"(Detect "study the triangular numbers sequence")
Ok "analyze twin prime gaps"  (Detect "analyze twin prime gaps")
Ok "what generates sequence"  (Detect "what formula generates this sequence 1 3 6 10 15")
Ok "examine prime sequence"   (Detect "examine the prime number sequence")
Ok "investigate progression"  (Detect "investigate this progression: 2, 6, 12, 20, 30, 42")

# Must NOT fire
Ok "verify Collatz up to N (discovery)"   (-not (Detect "verify Collatz up to 100000"))
Ok "plain compute 7^13"                   (-not (Detect "what is 7 to the power of 13"))
Ok "notebook write"                       (-not (Detect "log a conjecture on collatz"))
Ok "notebook read"                        (-not (Detect "where are we on collatz"))
Ok "bare greeting"                        (-not (Detect "hi"))
Ok "fleet query"                          (-not (Detect "how is my fleet doing today"))
Ok "analyze fleet (not sequence)"         (-not (Detect "analyze my fleet performance"))
Ok "explore with bound (discovery)"       (-not (Detect "explore primes up to 1000"))

Write-Host "`n-- OEIS note building --`n"

# Port of note-building logic
$EXEC_MARKER    = [regex]'(?i)\bcomput|python|ran\s+(?:the\s+)?(?:code|check)|execut|sandbox'
$CONJ_LINE      = [regex]'(?im)^Conjecture:\s*(.+)'
$VERIFIED_RE    = [regex]'(?i)Conjecture\s+verified\s+for\s+n\s*=\s*1\.\.(\d+)'
$FAILS_RE       = [regex]'(?i)Conjecture\s+FAILS\s+at\s+n\s*=\s*(\d+)'

function NoteCount($resp, $thread) {
  if ($resp.Length -lt 40 -or -not $EXEC_MARKER.IsMatch($resp)) { return 0 }
  $cm = $CONJ_LINE.Match($resp)
  if (-not $cm.Success) { return 1 }  # no conjecture -> 1 note note
  if ($FAILS_RE.IsMatch($resp)) { return 1 }  # fails -> 1 evidence-against
  $n = 1  # conjecture
  if ($VERIFIED_RE.IsMatch($resp)) { $n++ }  # + evidence-for
  return $n
}

function NoteKind0($resp) {
  if (-not $EXEC_MARKER.IsMatch($resp)) { return "none" }
  $cm = $CONJ_LINE.Match($resp)
  if (-not $cm.Success) { return "note" }
  if ($FAILS_RE.IsMatch($resp)) { return "evidence-against" }
  return "conjecture"
}

$goodResp = "I ran the code and computed the first 30 terms.`nConjecture: a(n) = n^2`nConjecture verified for n=1..100`nLogged to the notebook."
$failResp = "I computed the sequence.`nConjecture: a(n) = 2n+1.`nConjecture FAILS at n=5 (expected 11, got 25)."
$noCodeResp = "The pattern appears to be n^2. Conjecture: a(n) = n^2. Conjecture verified for n=1..100."
$noConjResp = "I ran the code. First differences: 1,2,3,4... Second differences: 1,1,1,1 (constant)."

Ok "good response: 2 notes (conjecture + evidence)" ((NoteCount $goodResp "test") -eq 2)
Ok "good response: first note is conjecture"        ((NoteKind0 $goodResp) -eq "conjecture")
Ok "fails response: 1 note (evidence-against)"     ((NoteCount $failResp "test") -eq 1)
Ok "fails response: kind is evidence-against"       ((NoteKind0 $failResp) -eq "evidence-against")
Ok "no code exec marker: 0 notes"                  ((NoteCount $noCodeResp "test") -eq 0)
Ok "no conjecture line: 1 note (note kind)"         ((NoteCount $noConjResp "test") -eq 1)
Ok "no conjecture line: first note is note kind"    ((NoteKind0 $noConjResp) -eq "note")

Write-Host "`n-- Summary --"
Write-Host "$pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
if ($fail -gt 0) { exit 1 }
