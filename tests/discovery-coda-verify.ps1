# discovery-coda-verify.ps1 — port-verify for the S6 discovery-coda-leak fix.
# Mirrors lib/discovery.js detection logic (regexes + sentence scoping) in PS
# because there is no local node — the JS source of truth is deployed and
# live-tested; this script catches logic regressions offline.
#
# THE BUG (2026-06-12, found in team round 2): a long plan-review message
# contained a run verb, a research word, and a stray "to 4" in DIFFERENT
# sentences → whole-message detection fired → discovery lane claimed a
# conversational turn → "▶ Next probe: verify sse up to 40 and log it" coda +
# a bogus next_step row. Fix = (1) sentence-scoped detection for messages
# > 240 chars, (2) orchestrator only appends the coda when evidence notes
# were actually staged (ranOk).

$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ── ports of lib/discovery.js regexes (keep in sync) ─────────────────────────
$RUN_VERB        = '\b(verify|check|test|explore|search|scan|run|confirm|probe|compute)\b'
$RESEARCH_TARGET = '\b(conjecture|hypothesis|collatz|goldbach|twin\s+primes?|primes?|perfect\s+numbers?|abundant|amicable|fibonacci|oeis|sequence|riemann|mersenne|fermat|abc\s+conjecture|beal|counterexamples?|digit\s+sums?|happy\s+numbers?|palindrom)\b'
$BOUND_RE        = '\b(?:up\s+to|below|under|first|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|k|m))?|10\s*\^\s*\d+|1e\d+|2\s*\^\s*\d+)\b'
$LOG_INTENT      = '\b(?:log|record|save|capture|note|write)\b[^.?!]{0,40}\b(?:notebook|ledger|finding|result|outcome|evidence)\b|\bnotebook\b'
$SHORT_ASK_MAX   = 240

function Detect-Core([string]$s) {
  if (-not [regex]::IsMatch($s, $RUN_VERB, $IC))        { return $false }
  if (-not [regex]::IsMatch($s, $RESEARCH_TARGET, $IC)) { return $false }
  $bound    = [regex]::IsMatch($s, $BOUND_RE, $IC)
  $wantsLog = [regex]::IsMatch($s, $LOG_INTENT, $IC)
  return ($bound -or $wantsLog)
}

function Detect-New([string]$msg) {
  $s = $msg.Trim()
  if ($s.Length -lt 8) { return $false }
  if ($s.Length -le $SHORT_ASK_MAX) { return (Detect-Core $s) }
  $sentences = [regex]::Split($s, '\n+|(?<=[.!?])\s+')
  foreach ($sent in $sentences) {
    $t = $sent.Trim()
    if ($t.Length -lt 8) { continue }
    if (Detect-Core $t) { return $true }
  }
  return $false
}

function Detect-Old([string]$msg) {   # pre-fix behavior: whole message, any length
  $s = $msg.Trim()
  if ($s.Length -lt 8) { return $false }
  return (Detect-Core $s)
}

# ── harness ──────────────────────────────────────────────────────────────────
$pass = 0; $fail = 0
function Check([string]$name, $actual, $expected) {
  if ($actual -eq $expected) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got $actual, want $expected)" -ForegroundColor Red }
}

Write-Host "`n== Genuine asks still fire (regression) ==" -ForegroundColor Cyan
Check "bounded collatz check"      (Detect-New "verify the Collatz conjecture up to 100000") $true
Check "goldbach below 10^6"        (Detect-New "check Goldbach for every even number below 10^6") $true
Check "twin primes + log"          (Detect-New "explore twin primes up to 1e7 and log what you find") $true
Check "looped ask"                 (Detect-New "verify collatz up to 10,000 and keep going for 3 steps") $true
Check "plain compute -> no"        (Detect-New "what is 7^13") $false
Check "notebook read -> no"        (Detect-New "where are we on collatz") $false

Write-Host "`n== THE LEAK: long conversational turns must NOT fire ==" -ForegroundColor Cyan
$review = "Here is my honest review of the round-2 plan as requested. We should test SSE for latency before the window closes, since streaming is the weakest UX point today. The ladder now runs from M1 to 4 separate middle layers before L5 ever activates. The falsifier should kill each weak conjecture early, and the notebook stays the ledger of record for everything we keep."
Check "review msg fired under OLD logic (repro)" (Detect-Old $review) $true
Check "review msg does NOT fire under NEW logic" (Detect-New $review) $false

$brief = "Q1: should the generator come before literature ingestion? My view: yes. Q2: the Type B schema must cover trend claims, please check the density shapes too. Q3: gates need a random baseline of at least 2x. Q4: scaffolding to 5 lemmas max. Q5: the conjecture pipeline writes to the notebook only after the falsifier passes."
Check "attack-questions brief does NOT fire"     (Detect-New $brief) $false

Write-Host "`n== Genuine ask embedded in a long message still fires ==" -ForegroundColor Cyan
$longAsk = "I have been reading about the 3n+1 problem all evening and I want to push the search further than last time, because the previous run only went to ten thousand and that felt shallow given what the literature says about stopping times. Now verify collatz up to 100,000 and log it to the notebook. Then tomorrow we can talk about parity vectors."
Check "embedded single-sentence ask fires"       (Detect-New $longAsk) $true

Write-Host "`n== Leaked coda command itself is inert ==" -ForegroundColor Cyan
Check "'verify sse up to 40 and log it' -> no (sse is not a research target)" (Detect-New "verify sse up to 40 and log it") $false

Write-Host "`n$pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
