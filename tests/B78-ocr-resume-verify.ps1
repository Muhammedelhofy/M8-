# B78-ocr-resume-verify.ps1 -- Build-78a ship gate.
# PS mirror of the pure resumable-OCR logic in lib/converter.js
# (batchesToProcess, ocrProgress, assembleOcrText) + the resume/next_batch and
# completeness invariants in api/pdf-to-text.js. No DB, no Gemini, no network.
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

# ==== mirror: batchesToProcess(totalPages, batchSize, doneStarts, maxPer) =======
function BatchesToProcess([int]$totalPages, [int]$batchSize, $doneStarts, [int]$maxPer) {
  $step = $batchSize
  if ($step -lt 1) { $step = 1 }
  $cap = $maxPer
  if ($cap -lt 1) { $cap = 1 }
  $done = @{}
  foreach ($d in @($doneStarts)) { $done[[int]$d] = $true }
  $todo = [System.Collections.Generic.List[int]]::new()
  $s = 1
  while ($s -le $totalPages -and $todo.Count -lt $cap) {
    if (-not $done.ContainsKey($s)) { $todo.Add($s) }
    $s += $step
  }
  return ,$todo
}

# ==== mirror: ocrProgress(totalPages, batchSize, doneCount) =====================
function OcrProgress([int]$totalPages, [int]$batchSize, [int]$doneCount) {
  $step = $batchSize
  if ($step -lt 1) { $step = 1 }
  $tp = $totalPages
  if ($tp -lt 0) { $tp = 0 }
  $total = [Math]::Ceiling($tp / [double]$step)
  $total = [int]$total
  $d = $doneCount
  if ($d -lt 0) { $d = 0 }
  if ($d -gt $total) { $d = $total }
  $complete = $false
  if ($total -gt 0 -and $d -ge $total) { $complete = $true }
  return [pscustomobject]@{
    batches_total     = $total
    batches_done      = $d
    batches_remaining = [Math]::Max(0, $total - $d)
    complete          = $complete
  }
}

# ==== mirror: assembleOcrText(rows) ============================================
function AssembleOcrText($rows) {
  $sorted = @($rows) | Sort-Object { [int]$_.batch_start }
  $parts = @()
  foreach ($r in $sorted) {
    $t = [string]$r.page_text
    if ($t -and $t.Trim().Length -gt 0) { $parts += $t }
  }
  return ($parts -join "`n`n")
}

# ==== mirror: api/pdf-to-text.js next_batch ====================================
function NextBatch([int]$totalPages, [int]$batchSize, $doneStarts) {
  $r = BatchesToProcess $totalPages $batchSize $doneStarts 1
  if ($r.Count -gt 0) { return [int]$r[0] }
  return $null
}

Write-Host "`n-- batchesToProcess: 82-page book, 12/batch --" -ForegroundColor Cyan
$r = BatchesToProcess 82 12 @() 10
CheckEq "7 batches for 82 pages (count)" 7 $r.Count
CheckEq "  first start page" 1 $r[0]
CheckEq "  second start page" 13 $r[1]
CheckEq "  last start page" 73 $r[6]

Write-Host "`n-- batchesToProcess: bound per invocation --" -ForegroundColor Cyan
$r = BatchesToProcess 82 12 @() 3
CheckEq "cap=3 bounds the batch (count)" 3 $r.Count
CheckEq "  capped last start" 25 $r[2]

$r = BatchesToProcess 300 12 @() 10
CheckEq "large book bounded to cap" 10 $r.Count

Write-Host "`n-- batchesToProcess: skip already-OCR'd --" -ForegroundColor Cyan
$r = BatchesToProcess 82 12 @(1,13) 10
CheckEq "skips done starts (count)" 5 $r.Count
CheckEq "  resumes at 25" 25 $r[0]
CheckTrue "  never re-lists a done batch" (($r -notcontains 1) -and ($r -notcontains 13))

$r = BatchesToProcess 82 12 @(1,13,25,37,49,61,73) 10
CheckEq "fully-OCR'd book yields no work" 0 $r.Count

Write-Host "`n-- ocrProgress --" -ForegroundColor Cyan
$p = OcrProgress 82 12 7
CheckEq "all 7 done -> total 7" 7 $p.batches_total
CheckTrue "  complete when all batches done" $p.complete
$p = OcrProgress 82 12 3
CheckEq "  partial remaining" 4 $p.batches_remaining
CheckFalse "  not complete on partial" $p.complete
$p = OcrProgress 82 12 99
CheckEq "  done clamped to total" 7 $p.batches_done
CheckTrue "  clamped -> complete" $p.complete
$p = OcrProgress 0 12 0
CheckFalse "  empty doc never complete" $p.complete

Write-Host "`n-- assembleOcrText: page order + skip blanks --" -ForegroundColor Cyan
$rows = @(
  [pscustomobject]@{ batch_start = 25; page_text = "third" },
  [pscustomobject]@{ batch_start = 1;  page_text = "first" },
  [pscustomobject]@{ batch_start = 13; page_text = "  " },
  [pscustomobject]@{ batch_start = 37; page_text = "fourth" }
)
$txt = AssembleOcrText $rows
CheckTrue "stitches in page order" ($txt -eq "first`n`nthird`n`nfourth")
CheckFalse "  blank batch dropped" ($txt.Contains("  third"))

Write-Host "`n-- resume across invocations: a timeout is resumed, not restarted --" -ForegroundColor Cyan
# Run 1 (cap 3) over the 82-page book: OCRs starts 1,13,25 then returns continue.
$run1 = BatchesToProcess 82 12 @() 3
$done = [System.Collections.Generic.List[int]]::new()
foreach ($s in $run1) { $done.Add([int]$s) }
$prog1 = OcrProgress 82 12 $done.Count
CheckFalse "run1 not complete" $prog1.complete
$next1 = NextBatch 82 12 $done
CheckEq "run1 next_batch points past the done set" 37 $next1

# Run 2 (cap 3) resumes at 37: OCRs 37,49,61.
$run2 = BatchesToProcess 82 12 $done 3
CheckEq "run2 resumes at 37" 37 $run2[0]
foreach ($s in $run2) { $done.Add([int]$s) }
$prog2 = OcrProgress 82 12 $done.Count
CheckFalse "run2 still not complete (1 batch left)" $prog2.complete
$next2 = NextBatch 82 12 $done
CheckEq "run2 next_batch is the last batch" 73 $next2

# Run 3 finishes the final batch -> complete, no next_batch.
$run3 = BatchesToProcess 82 12 $done 3
CheckEq "run3 has the final batch" 73 $run3[0]
foreach ($s in $run3) { $done.Add([int]$s) }
$prog3 = OcrProgress 82 12 $done.Count
CheckTrue "run3 complete" $prog3.complete
$next3 = NextBatch 82 12 $done
CheckTrue "no next_batch when finished" ($null -eq $next3)

Write-Host "`n-- idempotency: re-running a finished OCR re-OCRs nothing --" -ForegroundColor Cyan
$again = BatchesToProcess 82 12 @(1,13,25,37,49,61,73) 10
CheckEq "complete doc reprocesses no pages" 0 $again.Count

Write-Host "`n================ B78 RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
