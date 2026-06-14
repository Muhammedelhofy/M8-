# tests/notebook-readscope-verify.ps1
# Build-25: sentence-scope the notebook READ_STEM + READ_CONTEXT pairing in
# lib/notebook.js isNotebookRead() (last item on the post-window backlog).
# PS mirror (node is not available in this shell, per standing project note).
#
# Bug: the old isNotebookRead() tested READ_STEM and READ_CONTEXT against the
# WHOLE message body independently. A multi-sentence message where sentence 1
# has a generic stem ("what's our status") and an UNRELATED sentence 2 happens
# to contain a context word ("next steps", "research", "conjecture", ...) was
# misclassified as a notebook read, even though neither sentence alone is one.
#
# Fix: split body on sentence/clause boundaries ([.!?\n]+) and require STEM +
# CONTEXT to both match within the SAME part. READ_DIRECT and WHERE_ON stay
# whole-body checks (self-contained phrases; adjacency is already enforced by
# the regex itself).

$ErrorActionPreference = "Stop"
$pass = 0
$fail = 0

function Test-True($name, $cond) {
  if ($cond) { $script:pass++; Write-Host "PASS: $name" }
  else       { $script:fail++; Write-Host "FAIL: $name" -ForegroundColor Red }
}

$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

$READ_DIRECT  = '\bresearch\s+(?:notebook|ledger|memory|notes?|threads?|status|log|progress)\b|\b(?:the\s+|my\s+|our\s+)?notebook\b|\b(?:what|which)\s+(?:dead\s*ends?|conjectures?|counter\s*-?\s*examples?|findings?|evidence|threads?|next\s+steps?)\s+(?:have|did|do|are|were)\b'
$READ_STEM    = '\b(where\s+(?:are|do|did|were)\s+we|what''?s\s+(?:our|the)\s+(?:status|progress|state|latest|standing)|catch\s+me\s+up|pick\s+up\s+where|recap|review|pull\s+up|status\s+of|update\s+me)\b'
$READ_CONTEXT = '\b(research|notebook|ledger|conjectures?|inquir|investigation|dead[\s-]?ends?|line\s+of\s+inquiry|next\s+steps?|findings?|threads?)\b'
$WHERE_ON     = '\b(?:where\s+(?:are|do|did|were)\s+we|what''?s\s+(?:our\s+)?(?:next\s+step|status|progress|standing|plan)|how\s+are\s+we\s+doing|update\s+(?:on|me\s+on))\s+(?:on|with|for|regarding|about)\b'
$SENTENCE_SPLIT = '[.!?\n]+'

function Test-IsNotebookRead([string]$body) {
  if ([regex]::IsMatch($body, $READ_DIRECT, $IC)) { return $true }
  if ([regex]::IsMatch($body, $WHERE_ON, $IC))    { return $true }
  foreach ($part in [regex]::Split($body, $SENTENCE_SPLIT)) {
    if ([regex]::IsMatch($part, $READ_STEM, $IC) -and [regex]::IsMatch($part, $READ_CONTEXT, $IC)) { return $true }
  }
  return $false
}

# ── The fix: cross-sentence stem+context no longer misfires ────────────────
Test-True "status-stem + unrelated 'next steps' in another sentence -> not a read (was a read)" (
  -not (Test-IsNotebookRead "What's our status today? Also send the fleet earnings and any next steps for the maintenance schedule.")
)
Test-True "'catch me up' on the fleet + unrelated 'research article' elsewhere -> not a read (was a read)" (
  -not (Test-IsNotebookRead "Catch me up on the fleet numbers. By the way I read an interesting research article on Collatz.")
)
Test-True "'recap' the meeting + unrelated 'dead end' street name -> not a read (was a read)" (
  -not (Test-IsNotebookRead "Can you recap the meeting notes from today? Also the delivery van is stuck on Dead End Road.")
)

# ── Same-sentence stem+context still fires (no regression) ─────────────────
Test-True "where are we on the collatz research -> read (same sentence)" (
  Test-IsNotebookRead "Where are we on the collatz research?"
)
Test-True "recap the notebook for me -> read (same sentence)" (
  Test-IsNotebookRead "Can you recap the notebook for me?"
)
Test-True "stem+context in sentence 1, unrelated sentence 2 -> still a read" (
  Test-IsNotebookRead "What's our progress on the collatz conjecture? Also send today's fleet earnings."
)

# ── READ_DIRECT / WHERE_ON remain whole-body, unaffected by sentence split ──
Test-True "'what's in the notebook' buried in a later sentence -> read (READ_DIRECT)" (
  Test-IsNotebookRead "Quick one. Also, what's in the notebook?"
)
Test-True "'where are we on goldbach' -> read (WHERE_ON)" (
  Test-IsNotebookRead "So, where are we on goldbach?"
)

# ── Ordinary chat, no stem/context anywhere -> not a read ───────────────────
Test-True "plain fleet question -> not a read" (
  -not (Test-IsNotebookRead "How much did we make yesterday?")
)
Test-True "plain greeting + unrelated question -> not a read" (
  -not (Test-IsNotebookRead "Good morning. What's the weather like for the drivers today?")
)

Write-Host ""
Write-Host "=== notebook-readscope-verify.ps1 (Build-25) ==="
Write-Host "PASS: $pass  FAIL: $fail"
if ($fail -gt 0) { exit 1 }
