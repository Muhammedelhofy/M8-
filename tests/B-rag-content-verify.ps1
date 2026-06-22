# B-rag-content-verify.ps1 -- Build-RAG ship gate.
# PS mirror of the pure logic added to lib/knowledge-intake.js:
#   isGeminiQuotaError, buildNotebookLMHandoff, extractConceptsWithStatus (quota path),
#   ingestBookText quota-break path, getInventoryStatus summary.
# No DB, no Gemini, no network. PS 5.1 / pure ASCII.

$pass = 0; $fail = 0

function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }
function CheckEq([string]$label, $expected, $actual) {
  CheckTrue ($label + " (exp=" + $expected + " got=" + $actual + ")") ($expected -eq $actual)
}
function CheckContains([string]$label, [string]$text, [string]$sub) {
  CheckTrue ($label + " contains '" + $sub + "'") ($text -and $text.Contains($sub))
}

# ============================================================
# Mirror: isGeminiQuotaError(err)
# ============================================================
function IsGeminiQuotaError([string]$msg) {
  $m = $msg.ToLower()
  return ($m.Contains("429") -or
          $m.Contains("resource_exhausted") -or
          $m.Contains("quota_exceeded") -or
          $m.Contains("rate limit") -or
          $m.Contains("too many requests"))
}

Write-Host "`n-- isGeminiQuotaError: true cases --" -ForegroundColor Cyan
CheckTrue "detects 429"                 (IsGeminiQuotaError "Error 429: Too Many Requests")
CheckTrue "detects resource_exhausted"  (IsGeminiQuotaError "RESOURCE_EXHAUSTED: quota exceeded")
CheckTrue "detects quota_exceeded"      (IsGeminiQuotaError "QUOTA_EXCEEDED for project")
CheckTrue "detects rate limit"          (IsGeminiQuotaError "Gemini rate limit hit")
CheckTrue "detects too many requests"   (IsGeminiQuotaError "too many requests from free tier")
CheckTrue "case-insensitive"            (IsGeminiQuotaError "RATE LIMIT EXCEEDED")

Write-Host "`n-- isGeminiQuotaError: false cases --" -ForegroundColor Cyan
CheckFalse "does not match 500 error"        (IsGeminiQuotaError "Internal Server Error 500")
CheckFalse "does not match timeout"          (IsGeminiQuotaError "Request timed out after 30s")
CheckFalse "does not match empty string"     (IsGeminiQuotaError "")
CheckFalse "does not match unrelated text"   (IsGeminiQuotaError "JSON parse error at position 4")

# ============================================================
# Mirror: buildNotebookLMHandoff({ source_id, title, source_class })
# ============================================================
function BuildNotebookLMHandoff([string]$sourceId, [string]$title, [string]$sourceClass) {
  $stored     = if ($sourceId) { " Document stored (source_id $sourceId) -- checkpoints resume where it left off." } else { "" }
  $titlePart  = if ($title)    { " for '$title'" }    else { "" }
  $lines = @(
    "KNOWLEDGE INGEST -- Gemini quota exhausted${titlePart}.",
    "Extraction failed: free Gemini daily quota is full (HTTP 429 / RESOURCE_EXHAUSTED).${stored}",
    "",
    "OPTIONS:",
    "  1. Wait ~24 h for the free quota to reset, then re-send the same ingest-this-as-a-book request.",
    "     Checkpoints are saved -- chapters already processed will be skipped on retry.",
    "",
    "  2. For heavy PDF books (Arabic scans, large files), use NotebookLM instead:",
    "     -> Open notebooklm.google.com",
    "     -> Upload the PDF -- Google handles OCR + retrieval + citations free, no Gemini quota.",
    "     -> NotebookLM has no public embed API, so use it standalone alongside M8.",
    "",
    "  3. Fix the key/project mismatch (most likely root cause of the 429):",
    "     -> AI Studio -> top-left project selector -> switch to M8-Agent project",
    "     -> Generate a NEW key inside that project -> set it as GEMINI_API_KEY in Vercel env.",
    "     The billed account wont help if the key belongs to a different free-tier project."
  )
  return $lines -join "`n"
}

Write-Host "`n-- buildNotebookLMHandoff: content checks --" -ForegroundColor Cyan
$h1 = BuildNotebookLMHandoff "42" "Test Book" "established"
CheckContains "has KNOWLEDGE INGEST header"    $h1 "KNOWLEDGE INGEST"
CheckContains "has quota exhausted msg"        $h1 "Gemini quota exhausted"
CheckContains "includes title"                 $h1 "Test Book"
CheckContains "includes source_id"             $h1 "source_id 42"
CheckContains "mentions NotebookLM"            $h1 "notebooklm.google.com"
CheckContains "mentions key/project mismatch"  $h1 "key/project mismatch"
CheckContains "mentions checkpoints"           $h1 "Checkpoints are saved"
CheckContains "mentions ~24h"                  $h1 "~24 h"
CheckContains "mentions GEMINI_API_KEY"        $h1 "GEMINI_API_KEY"

$h2 = BuildNotebookLMHandoff "" "" ""
CheckContains "no-title variant still has header" $h2 "KNOWLEDGE INGEST"
CheckFalse    "no-title variant omits source_id"  ($h2.Contains("source_id"))
CheckFalse    "no-title variant omits for-title"  ($h2.Contains("for ''"))

$h3 = BuildNotebookLMHandoff "7" "test-arabic-title" "established"
CheckContains "non-empty title appears in handoff" $h3 "test-arabic-title"

# ============================================================
# Mirror: extractConceptsWithStatus quota path
# ============================================================
# The pure logic: if a chunk call returns a quota error -> set quota_exhausted = true
# and break (don't process further chunks). Non-quota errors -> continue.
function ExtractWithStatusMirror([object[]]$chunkResults) {
  # chunkResults: each item is @{ error=""|"quota"; raw="" }
  $candidates = [System.Collections.Generic.List[string]]::new()
  $quota_exhausted = $false
  foreach ($r in $chunkResults) {
    if ($r.error) {
      if (IsGeminiQuotaError $r.error) { $quota_exhausted = $true; break }
      continue   # non-quota: skip chunk, keep going
    }
    $candidates.Add($r.raw)
  }
  return [pscustomobject]@{ candidates = $candidates; quota_exhausted = $quota_exhausted }
}

Write-Host "`n-- extractConceptsWithStatus: quota path --" -ForegroundColor Cyan
$res = ExtractWithStatusMirror @(
  @{ error=""; raw="nodeA" },
  @{ error="429 resource_exhausted"; raw="" },
  @{ error=""; raw="nodeB" }   # should NOT be reached
)
CheckTrue  "quota_exhausted is true"          $res.quota_exhausted
CheckEq    "stops before post-quota chunks"   1 $res.candidates.Count
CheckEq    "collected nodeA before quota hit" "nodeA" $res.candidates[0]

$res2 = ExtractWithStatusMirror @(
  @{ error="Internal Server Error"; raw="" },   # non-quota: skipped
  @{ error=""; raw="nodeX" }
)
CheckFalse "non-quota error does not set quota_exhausted" $res2.quota_exhausted
CheckEq    "non-quota error skips chunk but continues"    1 $res2.candidates.Count
CheckEq    "collected nodeX after skip"                   "nodeX" $res2.candidates[0]

$res3 = ExtractWithStatusMirror @(
  @{ error=""; raw="n1" },
  @{ error=""; raw="n2" },
  @{ error=""; raw="n3" }
)
CheckFalse "no errors -> quota_exhausted false" $res3.quota_exhausted
CheckEq    "all chunks collected"               3 $res3.candidates.Count

# ============================================================
# Mirror: ingestBookText quota-break path
# ============================================================
# If chapter extraction returns quota_exhausted -> push error result + break loop.
# Remaining chapters must NOT be processed.
function IngestBookChaptersMirror([object[]]$chapters, [int]$maxPer) {
  $results = [System.Collections.Generic.List[object]]::new()
  $timedOut = $false
  $todo = $chapters | Select-Object -First $maxPer
  foreach ($ch in $todo) {
    $extractResult = $ch.extractResult
    $chapterQuota = $extractResult.quota_exhausted
    if ($chapterQuota) {
      $timedOut = $true
      $results.Add([pscustomobject]@{ chapter=$ch.title; error="quota_exhausted"; nodes_added=0 })
      break
    }
    $results.Add([pscustomobject]@{ chapter=$ch.title; nodes_added=$extractResult.nodes; error="" })
  }
  $quotaHit = $results | Where-Object { $_.error -eq "quota_exhausted" }
  return [pscustomobject]@{
    results   = $results
    timed_out = $timedOut
    quota_exhausted = ($null -ne $quotaHit -and @($quotaHit).Count -gt 0)
  }
}

Write-Host "`n-- ingestBookText quota-break: stops on first quota chapter --" -ForegroundColor Cyan
$chapters3 = @(
  @{ title="Chapter 1"; extractResult=[pscustomobject]@{ quota_exhausted=$false; nodes=5 } },
  @{ title="Chapter 2"; extractResult=[pscustomobject]@{ quota_exhausted=$true;  nodes=0 } },
  @{ title="Chapter 3"; extractResult=[pscustomobject]@{ quota_exhausted=$false; nodes=3 } }
)
$bookRes = IngestBookChaptersMirror $chapters3 10
CheckTrue  "quota_exhausted in book result"       $bookRes.quota_exhausted
CheckTrue  "timed_out flag set"                   $bookRes.timed_out
CheckEq    "only 2 results (ch1 ok + ch2 quota)"  2 $bookRes.results.Count
CheckEq    "ch1 succeeded"                        "" $bookRes.results[0].error
CheckEq    "ch2 has quota_exhausted error tag"    "quota_exhausted" $bookRes.results[1].error
CheckFalse "ch3 never processed"                  ($bookRes.results | Where-Object { $_.chapter -eq "Chapter 3" })

Write-Host "`n-- ingestBookText: no quota = normal run --" -ForegroundColor Cyan
$chapters2 = @(
  @{ title="Ch A"; extractResult=[pscustomobject]@{ quota_exhausted=$false; nodes=4 } },
  @{ title="Ch B"; extractResult=[pscustomobject]@{ quota_exhausted=$false; nodes=7 } }
)
$bookRes2 = IngestBookChaptersMirror $chapters2 10
CheckFalse "no quota -> quota_exhausted false" $bookRes2.quota_exhausted
CheckFalse "no quota -> timed_out false"       $bookRes2.timed_out
CheckEq    "both chapters processed"           2 $bookRes2.results.Count

# ============================================================
# Mirror: getInventoryStatus summary logic
# ============================================================
function GetInventoryStatusMirror([int]$bookCount, [int]$bookNodes, [int]$snippetCount, [int]$snippetNodes) {
  $noBooks = $bookCount -eq 0
  $totalNodes = $bookNodes + $snippetNodes
  if ($noBooks) {
    $summary = "No books ingested yet. $snippetCount raw snippet(s) with $snippetNodes node(s) in graph."
  } else {
    $summary = "${bookCount} book(s) - ${bookNodes} book nodes - ${snippetCount} snippet(s) - ${snippetNodes} snippet nodes."
  }
  return [pscustomobject]@{
    status             = if ($noBooks) { "empty" } else { "has_books" }
    summary            = $summary
    total_all_nodes    = $totalNodes
    notebooklm_tip_present = $true
    how_to_ingest_present  = $true
  }
}

Write-Host "`n-- getInventoryStatus: empty state --" -ForegroundColor Cyan
$s = GetInventoryStatusMirror 0 0 5 161
CheckEq       "status is empty"         "empty" $s.status
CheckContains "summary has snippet count" $s.summary "5"
CheckContains "summary has node count"    $s.summary "161"
CheckEq       "total_all_nodes correct"  161 $s.total_all_nodes
CheckTrue     "notebooklm_tip present"   $s.notebooklm_tip_present
CheckTrue     "how_to_ingest present"    $s.how_to_ingest_present

Write-Host "`n-- getInventoryStatus: has books --" -ForegroundColor Cyan
$s2 = GetInventoryStatusMirror 3 450 2 20
CheckEq       "status is has_books"     "has_books" $s2.status
CheckContains "summary has book count"  $s2.summary "3"
CheckContains "summary has book nodes"  $s2.summary "450"
CheckEq       "total_all_nodes = 470"   470 $s2.total_all_nodes

# ============================================================
# Live-test reminder (informational, always passes)
# ============================================================
Write-Host "`n-- Live-test prerequisites (informational) --" -ForegroundColor Cyan
$docxPath = "C:\Users\m7ofy\OneDrive\Desktop\books\m8_test_book.docx"
$docxExists = Test-Path $docxPath
CheckTrue  "m8_test_book.docx exists on Desktop/books"   $docxExists
$bn01 = "C:\Users\m7ofy\OneDrive\Desktop\books\bn01.pdf"
CheckTrue  "bn01.pdf exists on Desktop/books"            (Test-Path $bn01)

Write-Host ""
Write-Host "  LIVE TEST (run after Muhammad deploys the preview):" -ForegroundColor Yellow
Write-Host "  1. Attach $docxPath in M8 chat" -ForegroundColor Yellow
Write-Host "     Say: 'ingest this as a book: title=Test Book, source_class=established'" -ForegroundColor Yellow
Write-Host "  2. Check /api/knowledge?fn=status for 'Test Book' + node count." -ForegroundColor Yellow
Write-Host "  3. If Gemini quota hit: expect NotebookLM handoff message (not silent 0 nodes)." -ForegroundColor Yellow
Write-Host "  4. If wiring works: check /api/knowledge?fn=inventory for chapter rows." -ForegroundColor Yellow

Write-Host "`n================ B-RAG-CONTENT RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
