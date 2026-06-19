# B77-ingest-resume-verify.ps1 -- Build-77 ship gate.
# PS mirror of the pure resumable-ingestion logic in lib/knowledge-intake.js
# (chaptersToProcess, ingestProgress) + the checkpoint/skip/resume/idempotency
# invariants enforced by api/ingest-book.js. No DB, no Gemini, no network.
# Pure ASCII (no-BOM .ps1 -> PS 5.1 ANSI). No ternary. Keep ALL comments ASCII.

$pass = 0; $fail = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }
function CheckEq([string]$label, $expected, $actual) {
  CheckTrue ($label + " (exp=" + $expected + " got=" + $actual + ")") ($expected -eq $actual)
}

# ==== mirror: chaptersToProcess(totalChapters, doneIndices, maxPerInvocation) ===
function ChaptersToProcess([int]$total, $doneIndices, [int]$maxPer) {
  $done = @{}
  foreach ($d in @($doneIndices)) { $done[[int]$d] = $true }
  $cap = $maxPer
  if ($cap -lt 1) { $cap = 1 }
  $todo = [System.Collections.Generic.List[int]]::new()
  $i = 0
  while ($i -lt $total -and $todo.Count -lt $cap) {
    if (-not $done.ContainsKey($i)) { $todo.Add($i) }
    $i++
  }
  return ,$todo
}

# ==== mirror: ingestProgress(totalChapters, doneCount) =========================
function IngestProgress([int]$total, [int]$doneCount) {
  $t = $total
  if ($t -lt 0) { $t = 0 }
  $d = $doneCount
  if ($d -lt 0) { $d = 0 }
  if ($d -gt $t) { $d = $t }
  $complete = $false
  if ($t -gt 0 -and $d -ge $t) { $complete = $true }
  return [pscustomobject]@{
    chapters_total     = $t
    chapters_done      = $d
    chapters_remaining = [Math]::Max(0, $t - $d)
    complete           = $complete
  }
}

# ==== mirror: api/ingest-book.js next_chapter resume signal ====================
# nextChapter = first todo index not yet done; else first global index not done.
function NextChapter([int]$total, $todo, $newlyDone) {
  $doneSet = @{}
  foreach ($d in @($newlyDone)) { $doneSet[[int]$d] = $true }
  foreach ($i in @($todo)) {
    if (-not $doneSet.ContainsKey([int]$i)) { return [int]$i }
  }
  $j = 0
  while ($j -lt $total) {
    if (-not $doneSet.ContainsKey($j)) { return $j }
    $j++
  }
  return $null
}

Write-Host "`n-- chaptersToProcess: basic + bound --" -ForegroundColor Cyan
$r = ChaptersToProcess 5 @() 6
CheckEq "small book all chapters (count)" 5 $r.Count
CheckEq "  first index" 0 $r[0]
CheckEq "  last index"  4 $r[4]

$r = ChaptersToProcess 10 @() 6
CheckEq "large book bounded to cap (count)" 6 $r.Count
CheckEq "  bounded last index" 5 $r[5]

Write-Host "`n-- chaptersToProcess: skip already-done --" -ForegroundColor Cyan
$r = ChaptersToProcess 5 @(0,1) 6
CheckEq "skips done 0,1 (count)" 3 $r.Count
CheckEq "  resumes at 2" 2 $r[0]
CheckTrue "  never re-lists a done chapter" (($r -notcontains 0) -and ($r -notcontains 1))

$r = ChaptersToProcess 5 @(0,1,2,3,4) 6
CheckEq "fully-done book yields no work" 0 $r.Count

Write-Host "`n-- chaptersToProcess: resume across invocations --" -ForegroundColor Cyan
# Run 1 of a 10-chapter book finished 0..5; run 2 must pick up 6..9.
$run2 = ChaptersToProcess 10 @(0,1,2,3,4,5) 6
CheckEq "run2 resumes remaining (count)" 4 $run2.Count
CheckEq "  run2 starts at 6" 6 $run2[0]
CheckEq "  run2 ends at 9"  9 $run2[3]

$r = ChaptersToProcess 5 @() 1
CheckEq "cap=1 processes one chapter" 1 $r.Count

Write-Host "`n-- ingestProgress --" -ForegroundColor Cyan
$p = IngestProgress 10 6
CheckEq "progress remaining" 4 $p.chapters_remaining
CheckFalse "  not complete" $p.complete
$p = IngestProgress 10 10
CheckTrue "  complete when all done" $p.complete
CheckEq "  remaining 0 when complete" 0 $p.chapters_remaining
$p = IngestProgress 10 0
CheckEq "  fresh book remaining=total" 10 $p.chapters_remaining
$p = IngestProgress 5 9
CheckEq "  doneCount clamped to total" 5 $p.chapters_done
CheckTrue "  clamped -> complete" $p.complete
$p = IngestProgress 0 0
CheckFalse "  empty book never complete" $p.complete

Write-Host "`n-- checkpoint-after-commit: a mid-chapter timeout is retried, not skipped --" -ForegroundColor Cyan
# Build-77 contract: a chapter is checkpointed 'done' ONLY after its nodes commit.
# Simulate run 1 over a 4-chapter book where chapter 2 throws mid-extraction.
$total = 4
$todo1 = ChaptersToProcess $total @() 6
$newlyDone1 = [System.Collections.Generic.List[int]]::new()
foreach ($i in $todo1) {
  $extractionOk = $true
  if ($i -eq 2) { $extractionOk = $false }   # chapter 2 dies mid-extraction
  if ($extractionOk) { $newlyDone1.Add([int]$i) }
}
CheckFalse "chapter 2 NOT marked done after failure" ($newlyDone1 -contains 2)
CheckTrue  "chapters 0,1,3 marked done" (($newlyDone1 -contains 0) -and ($newlyDone1 -contains 1) -and ($newlyDone1 -contains 3))
# Run 2 must resume ONLY the failed chapter 2 (the source row exists but was
# never checkpointed done, so it is reprocessed rather than skipped).
$run2b = ChaptersToProcess $total $newlyDone1 6
CheckEq "run2 retries exactly the failed chapter (count)" 1 $run2b.Count
CheckEq "  run2 retries chapter 2" 2 $run2b[0]

Write-Host "`n-- idempotency: re-ingesting a finished book reprocesses nothing --" -ForegroundColor Cyan
$todoAgain = ChaptersToProcess 4 @(0,1,2,3) 6
CheckEq "no chapter reprocessed on a complete book" 0 $todoAgain.Count

# Node-level idempotency model: populateGraph dedups by (kind, norm_label), so
# re-running extraction on an already-populated chapter adds only NEW labels.
function PopulateGraphAdded($existingLabels, $candidateLabels) {
  $have = @{}
  foreach ($l in @($existingLabels)) { $have[[string]$l] = $true }
  $added = 0
  foreach ($l in @($candidateLabels)) {
    if (-not $have.ContainsKey([string]$l)) { $added++; $have[[string]$l] = $true }
  }
  return $added
}
$firstPass  = PopulateGraphAdded @() @('a','b','c')
CheckEq "first pass writes all 3 nodes" 3 $firstPass
$secondPass = PopulateGraphAdded @('a','b','c') @('a','b','c')
CheckEq "re-run of same chapter writes 0 duplicates" 0 $secondPass
$topUp      = PopulateGraphAdded @('a','b') @('a','b','c','d')
CheckEq "partial chapter tops up only missing nodes" 2 $topUp

Write-Host "`n-- resume signal: next_chapter + done flag --" -ForegroundColor Cyan
# 10-chapter book, cap 6, fresh start: run completes 0..5, must signal next=6.
$todoX = ChaptersToProcess 10 @() 6
$nd = [System.Collections.Generic.List[int]]::new()
foreach ($i in $todoX) { $nd.Add([int]$i) }
$next = NextChapter 10 $todoX $nd
CheckEq "next_chapter after capped run" 6 $next
$prog = IngestProgress 10 $nd.Count
CheckFalse "  not done after capped run" $prog.complete

# Final invocation: last 4 chapters processed -> done, next=null.
$todoY = ChaptersToProcess 10 @(0,1,2,3,4,5) 6
$ndY = [System.Collections.Generic.List[int]]::new()
foreach ($d in @(0,1,2,3,4,5)) { $ndY.Add([int]$d) }
foreach ($i in $todoY) { $ndY.Add([int]$i) }
$nextY = NextChapter 10 $todoY $ndY
CheckTrue "no next_chapter when finished" ($null -eq $nextY)
$progY = IngestProgress 10 $ndY.Count
CheckTrue "  done flag true when finished" $progY.complete

Write-Host "`n================ B77 RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
