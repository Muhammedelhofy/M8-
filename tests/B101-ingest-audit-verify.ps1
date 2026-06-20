# B101-ingest-audit-verify.ps1 -- Build-101 ship gate.
# Verifies the atomic ingest pipeline (api/ingest-full.js) + the re-extract path
# (api/ingest-extract-existing.js). Static source checks + PS mirrors of the pure
# decision logic (approve-tier filter, unextracted-source selection). No Node,
# no DB, no Gemini, no network in the offline gate. Optional live HTTP cases run
# only when $env:M8_BASE_URL is set, and SKIP (never fail) otherwise.
# Pure ASCII (no-BOM .ps1 -> PS 5.1). No ternary. Keep ALL comments ASCII.

$pass = 0; $fail = 0; $skip = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }
function CheckEq([string]$label, $expected, $actual) {
  CheckTrue ($label + " (exp=" + $expected + " got=" + $actual + ")") ($expected -eq $actual)
}
function MarkSkip([string]$label) { $script:skip++; Write-Host "  SKIP  $label" -ForegroundColor Yellow }

# ---- locate repo files (tests/ -> repo root) --------------------------------
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = Split-Path -Parent $here
$fullPath   = Join-Path $root "api\ingest-full.js"
$reextPath  = Join-Path $root "api\ingest-extract-existing.js"
$vercelPath = Join-Path $root "vercel.json"

# OneDrive can flake on a read; retry a couple of times before giving up.
function ReadText([string]$path) {
  for ($i = 0; $i -lt 3; $i++) {
    try { return [System.IO.File]::ReadAllText($path) } catch { Start-Sleep -Milliseconds 150 }
  }
  return $null
}
function IsAscii([string]$path) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    foreach ($b in $bytes) { if ($b -gt 127) { return $false } }
    return $true
  } catch { return $false }
}
function Has($content, [string]$needle) {
  if ($null -eq $content) { return $false }
  return $content.Contains($needle)
}

$full   = ReadText $fullPath
$reext  = ReadText $reextPath
$vercel = ReadText $vercelPath

Write-Host "`n-- files exist + readable --" -ForegroundColor Cyan
CheckTrue "api/ingest-full.js exists"            (Test-Path $fullPath)
CheckTrue "api/ingest-extract-existing.js exists" (Test-Path $reextPath)
CheckTrue "ingest-full.js readable (non-empty)"  ($full   -and $full.Length  -gt 200)
CheckTrue "ingest-extract-existing.js readable"  ($reext  -and $reext.Length -gt 200)

Write-Host "`n-- pure ASCII (PS 5.1 / no-BOM constraint) --" -ForegroundColor Cyan
CheckTrue "ingest-full.js is pure ASCII"             (IsAscii $fullPath)
CheckTrue "ingest-extract-existing.js is pure ASCII" (IsAscii $reextPath)

Write-Host "`n-- constraint: no function named CP --" -ForegroundColor Cyan
$cpRe = '(function\s+CP\b|(?:const|let|var)\s+CP\b)'
CheckFalse "ingest-full.js defines no CP"             ($full  -match $cpRe)
CheckFalse "ingest-extract-existing.js defines no CP" ($reext -match $cpRe)

Write-Host "`n-- maxDuration 180 (inline config + vercel.json) --" -ForegroundColor Cyan
CheckTrue "ingest-full inline config maxDuration 180"  (Has $full  "module.exports.config = { maxDuration: 180 }")
CheckTrue "ingest-extract inline config maxDuration 180" (Has $reext "module.exports.config = { maxDuration: 180 }")
CheckTrue "vercel.json has ingest-full 180"   (Has $vercel '"api/ingest-full.js": { "maxDuration": 180 }')
CheckTrue "vercel.json has ingest-extract 180" (Has $vercel '"api/ingest-extract-existing.js": { "maxDuration": 180 }')

# The config must be set AFTER the handler assignment, else the reassignment of
# module.exports wipes it (the latent bug in api/upload-file.js).
function ConfigAfterHandler($content) {
  if ($null -eq $content) { return $false }
  $h = $content.IndexOf('module.exports = async')
  $c = $content.IndexOf('module.exports.config')
  return ($h -ge 0 -and $c -gt $h)
}
CheckTrue "ingest-full sets config AFTER handler (not wiped)"  (ConfigAfterHandler $full)
CheckTrue "ingest-extract sets config AFTER handler (not wiped)" (ConfigAfterHandler $reext)

Write-Host "`n-- ingest-full: 3-step pipeline wired --" -ForegroundColor Cyan
CheckTrue "requires ../lib/knowledge-intake" (Has $full 'require("../lib/knowledge-intake")')
CheckTrue "calls ingestDocument (step 1)"    (Has $full "ingestDocument(")
CheckTrue "calls extractConcepts (step 2)"   (Has $full "extractConcepts(")
CheckTrue "calls populateGraph (step 3)"     (Has $full "populateGraph(")
CheckTrue "filters high tier caller-side"    (Has $full 'c.extraction_confidence === "high"')
CheckTrue "returns source_id"     (Has $full "source_id")
CheckTrue "returns added"         (Has $full "added")
CheckTrue "returns pending_count" (Has $full "pending_count")
CheckTrue "returns word_count"    (Has $full "word_count")
CheckTrue "returns preview"       (Has $full "preview")
CheckTrue "default approve is high" (Has $full 'body.approve || "high"')

Write-Host "`n-- ingest-extract-existing: re-extract on the correct column --" -ForegroundColor Cyan
CheckTrue "requires ../lib/knowledge-intake" (Has $reext 'require("../lib/knowledge-intake")')
CheckTrue "uses source_doc_id (graph node column)" (Has $reext "source_doc_id")
# Guard against the wrong column name on the nodes table.
CheckFalse "does NOT join graph nodes on .eq(source_id)" (Has $reext '.eq("source_id"')
CheckTrue "calls extractConcepts" (Has $reext "extractConcepts(")
CheckTrue "calls populateGraph"   (Has $reext "populateGraph(")
CheckTrue "returns processed"     (Has $reext "processed")
CheckTrue "returns total_added"   (Has $reext "total_added")
CheckTrue "returns per_source"    (Has $reext "per_source")
CheckTrue "default approve is all" (Has $reext 'body.approve || "all"')

# ==== mirror: approve-tier filter (populateGraph has no approve param, so the
#      endpoint filters candidates itself -- this mirrors that decision). =======
function CountWritten([string]$approveMode, $confs) {
  if ($approveMode -eq "none") { return 0 }
  $written = 0
  foreach ($conf in @($confs)) {
    if ($approveMode -eq "all") { $written++ }
    elseif ($conf -eq "high")   { $written++ }
  }
  return $written
}
Write-Host "`n-- mirror: approve-tier filter --" -ForegroundColor Cyan
$confs = @("high", "high", "medium", "low", "high")   # 3 high, 2 non-high
CheckEq "approve=high writes only high"  3 (CountWritten "high" $confs)
CheckEq "approve=all writes everything"  5 (CountWritten "all"  $confs)
CheckEq "approve=none writes nothing"    0 (CountWritten "none" $confs)
# pending = non-high candidates when approve=high
$pending = 0
foreach ($conf in $confs) { if ($conf -ne "high") { $pending++ } }
CheckEq "pending_count on approve=high"  2 $pending

# ==== mirror: unextracted-source selection (a source with >=1 graph node is
#      'extracted'; one with none is a re-extract target). Built from the REAL
#      live audit data: sources 1,2,3,4 have nodes; source 6 has 0. ============
function UnextractedIds($sourceIds, $nodeSourceDocIds) {
  $present = @{}
  foreach ($d in @($nodeSourceDocIds)) {
    if ($null -ne $d) { $present[[int]$d] = $true }
  }
  $out = [System.Collections.Generic.List[int]]::new()
  foreach ($id in @($sourceIds)) {
    if (-not $present.ContainsKey([int]$id)) { $out.Add([int]$id) }
  }
  return ,$out
}
Write-Host "`n-- mirror: unextracted-source selection (live audit data) --" -ForegroundColor Cyan
$sourceIds = @(1, 2, 3, 4, 6)
# nodes exist for 1,2,3,4 (repeats are fine); none for 6
$nodeDocIds = @(1, 1, 1, 2, 2, 3, 3, 4, 1, 2)
$un = UnextractedIds $sourceIds $nodeDocIds
CheckEq "exactly one unextracted source" 1 $un.Count
CheckTrue "source 6 is the unextracted target" ($un -contains 6)
CheckTrue "extracted sources 1-4 are skipped" (($un -notcontains 1) -and ($un -notcontains 2) -and ($un -notcontains 3) -and ($un -notcontains 4))

$unAll = UnextractedIds $sourceIds @()
CheckEq "empty graph -> all sources unextracted" 5 $unAll.Count

$unNone = UnextractedIds $sourceIds @(1, 2, 3, 4, 6)
CheckEq "fully extracted -> processed 0 (no targets)" 0 $unNone.Count

# explicit source_id path targets exactly that one id regardless of node count
function ExplicitTarget($sourceId) { return ,@([int]$sourceId) }
$ex = ExplicitTarget 2
CheckEq "explicit source_id targets exactly one" 1 $ex.Count
CheckTrue "explicit source_id targets the given id" ($ex -contains 2)

# ==== optional live HTTP cases (only when M8_BASE_URL is set) =================
Write-Host "`n-- live HTTP (optional: set M8_BASE_URL to run) --" -ForegroundColor Cyan
$base = $env:M8_BASE_URL
if (-not $base) {
  MarkSkip "POST /api/ingest-full (no M8_BASE_URL)"
  MarkSkip "POST /api/ingest-extract-existing (no M8_BASE_URL)"
} else {
  $base = $base.TrimEnd("/")
  try {
    $mathText = "The sum of the first n positive integers equals n times n plus one divided by two. This identity is provable by induction. The base case n equals one holds. The inductive step adds n plus one to both sides and simplifies. Therefore the closed form is correct for all positive integers n."
    $b1 = @{ title = "B101 live math test"; text = $mathText; source_class = "established"; approve = "all" } | ConvertTo-Json
    $r1 = Invoke-RestMethod -Method Post -Uri "$base/api/ingest-full" -ContentType "application/json" -Body $b1 -TimeoutSec 180
    CheckTrue "live ingest-full returned a source_id" ($null -ne $r1.source_id)
    CheckTrue "live ingest-full added > 0 nodes" ([int]$r1.added -gt 0)
  } catch {
    CheckTrue ("live ingest-full POST failed: " + $_.Exception.Message) $false
  }
  try {
    $r2 = Invoke-RestMethod -Method Post -Uri "$base/api/ingest-extract-existing" -ContentType "application/json" -Body "{}" -TimeoutSec 180
    CheckTrue "live ingest-extract-existing returned processed count" ($null -ne $r2.processed)
  } catch {
    CheckTrue ("live ingest-extract-existing POST failed: " + $_.Exception.Message) $false
  }
}

Write-Host "`n================ B101 RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
Write-Host ("  SKIP: " + $skip) -ForegroundColor Yellow
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
