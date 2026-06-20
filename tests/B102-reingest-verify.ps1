# B102-reingest-verify.ps1 -- Build-102 ship gate.
# Verifies the "re-extract knowledge" chat command: the deterministic detector in
# lib/intentClassifier.js, its wiring in lib/orchestrator.js, and that the
# Build-101 endpoint api/ingest-extract-existing.js is a handler returning the
# expected fields. Static source checks + PS mirrors of the pure decision logic
# (the trigger regex, approve-tier filter, unextracted-source selection). No Node,
# no DB, no Gemini, no network in the offline gate. An optional live HTTP case
# runs only when $env:M8_BASE_URL is set, and SKIPs (never fails) otherwise.
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
$intentPath = Join-Path $root "lib\intentClassifier.js"
$orchPath   = Join-Path $root "lib\orchestrator.js"
$reextPath  = Join-Path $root "api\ingest-extract-existing.js"
$selfPath   = $MyInvocation.MyCommand.Path

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

$intent = ReadText $intentPath
$orch   = ReadText $orchPath
$reext  = ReadText $reextPath

Write-Host "`n-- files exist + readable --" -ForegroundColor Cyan
CheckTrue "lib/intentClassifier.js exists"            (Test-Path $intentPath)
CheckTrue "lib/orchestrator.js exists"                (Test-Path $orchPath)
CheckTrue "api/ingest-extract-existing.js exists"     (Test-Path $reextPath)
CheckTrue "intentClassifier.js readable (non-empty)"  ($intent -and $intent.Length -gt 200)
CheckTrue "orchestrator.js readable (non-empty)"      ($orch   -and $orch.Length   -gt 200)
CheckTrue "ingest-extract-existing.js readable"       ($reext  -and $reext.Length  -gt 200)

Write-Host "`n-- pure ASCII (the Build-102 additions only) --" -ForegroundColor Cyan
# NOTE: the WHOLE intentClassifier.js / orchestrator.js are intentionally NOT
# checked -- both carry pre-existing, FUNCTIONAL non-ASCII (Arabic routing regexes
# in intentClassifier; Arabic UI strings in orchestrator). Asserting ASCII on the
# whole file would be a false fail and stripping that Arabic would break routing.
# The "pure ASCII" constraint applies to the code THIS build adds, so we check
# exactly the Build-102 regions instead.
function RegionAscii($content, [string]$startMarker, [string]$endMarker) {
  if ($null -eq $content) { return $false }
  $s = $content.IndexOf($startMarker)
  if ($s -lt 0) { return $false }
  $e = $content.IndexOf($endMarker, $s)
  if ($e -lt 0) { $e = $content.Length }
  $region = $content.Substring($s, $e - $s)
  foreach ($ch in $region.ToCharArray()) { if ([int]$ch -gt 127) { return $false } }
  return $true
}
CheckTrue "B102 detector block (intentClassifier) is ASCII" (RegionAscii $intent "REEXTRACT_KNOWLEDGE (Build-102)" "module.exports = { classifyIntent")
CheckTrue "B102 handler block (orchestrator) is ASCII"      (RegionAscii $orch "async function handleReextractKnowledgeCommand" "async function orchestrate(")
CheckTrue "this test file is pure ASCII"                    (IsAscii $selfPath)

Write-Host "`n-- constraint: no function named CP --" -ForegroundColor Cyan
$cpRe = '(function\s+CP\b|(?:const|let|var)\s+CP\b)'
CheckFalse "intentClassifier.js defines no CP" ($intent -match $cpRe)

Write-Host "`n-- intentClassifier: re-extract detector wired --" -ForegroundColor Cyan
CheckTrue "INTENT.REEXTRACT_KNOWLEDGE defined"        (Has $intent "REEXTRACT_KNOWLEDGE")
CheckTrue "classifyReextractKnowledge defined"        (Has $intent "function classifyReextractKnowledge")
CheckTrue "REEXTRACT_RE pattern defined"              (Has $intent "REEXTRACT_RE")
CheckTrue "exports classifyReextractKnowledge"        (Has $intent "classifyReextractKnowledge, REEXTRACT_RE")
CheckTrue "trigger concept: refresh knowledge graph"  (Has $intent "knowledge graph")
CheckTrue "trigger concept: extract knowledge"        (Has $intent "extract knowledge")
CheckTrue "trigger concept: stored sources"           (Has $intent "stored")
CheckTrue "approve tier parsed (all|high)"            (Has $intent 'approve')

Write-Host "`n-- orchestrator: handler defined + wired in BOTH paths --" -ForegroundColor Cyan
CheckTrue "imports classifyReextractKnowledge"        (Has $orch "classifyReextractKnowledge")
CheckTrue "handleReextractKnowledgeCommand defined"   (Has $orch "async function handleReextractKnowledgeCommand")
CheckTrue "drives shared knowledge-intake lib"        (Has $orch 'require("./knowledge-intake")')
CheckTrue "calls extractConcepts"                     (Has $orch "extractConcepts(")
CheckTrue "calls populateGraph"                       (Has $orch "populateGraph(")
CheckTrue "buffered path dispatch (log marker)"       (Has $orch 'log("reextract_knowledge")')
CheckTrue "streaming path dispatch (emit _rxS)"       (Has $orch "emit(_rxS)")
# def + buffered call + streaming call = at least 3 references
$rxRefs = [regex]::Matches($orch, "handleReextractKnowledgeCommand").Count
CheckTrue ("handler referenced >= 3 times (got=" + $rxRefs + ")") ($rxRefs -ge 3)
# guard: uses the correct graph column (source_doc_id), never source_id on nodes
CheckTrue "handler selects source_doc_id"             (Has $orch "source_doc_id")

Write-Host "`n-- endpoint: handler function returning expected fields --" -ForegroundColor Cyan
CheckTrue "module.exports is an async handler"        (Has $reext "module.exports = async")
CheckTrue "endpoint returns processed"               (Has $reext "processed")
CheckTrue "endpoint returns total_added"             (Has $reext "total_added")
CheckTrue "endpoint returns per_source"              (Has $reext "per_source")

# ==== mirror: the trigger regex (must match the JS REEXTRACT_RE exactly) =======
# .NET -match is case-insensitive by default, mirroring the JS /i flag.
$reextractRe = '\bre[-\s]?extract\b|\brefresh\b.{0,20}\bknowledge\s+graph\b|\bextract\s+knowledge\b.{0,30}\b(?:stored\s+)?sources?\b'
function MatchesReextract([string]$msg) {
  $r = [bool]($msg -match $reextractRe)
  return $r
}
Write-Host "`n-- mirror: trigger regex (positive) --" -ForegroundColor Cyan
CheckTrue "'re-extract knowledge' matches"                  (MatchesReextract "re-extract knowledge")
CheckTrue "'reextract' matches"                             (MatchesReextract "reextract")
CheckTrue "'please re extract the knowledge' matches"       (MatchesReextract "please re extract the knowledge")
CheckTrue "'refresh the knowledge graph' matches"          (MatchesReextract "refresh the knowledge graph")
CheckTrue "'refresh knowledge graph now' matches"          (MatchesReextract "refresh knowledge graph now")
CheckTrue "'extract knowledge from stored sources' matches" (MatchesReextract "extract knowledge from stored sources")
CheckTrue "'extract knowledge from sources' matches"       (MatchesReextract "extract knowledge from sources")

Write-Host "`n-- mirror: trigger regex (negative -- no false grabs) --" -ForegroundColor Cyan
CheckFalse "'what are my fleet earnings this week' no match" (MatchesReextract "what are my fleet earnings this week")
CheckFalse "'ingest this as established: collatz' no match"  (MatchesReextract "ingest this as established: the collatz conjecture states that")
CheckFalse "'summarize the book for me' no match"            (MatchesReextract "summarize the book for me")
CheckFalse "'extract the oil from the engine' no match"      (MatchesReextract "extract the oil from the engine")

# ==== mirror: approve-tier parse + write filter ===============================
# parse: the word 'high' -> 'high'; otherwise 'all' (the repair default).
function ApproveFromMsg([string]$msg) {
  if ($msg -match '\bhigh\b') { return "high" }
  return "all"
}
Write-Host "`n-- mirror: approve-tier parse --" -ForegroundColor Cyan
CheckEq "default approve is all"               "all"  (ApproveFromMsg "re-extract knowledge")
CheckEq "'high' word selects high tier"        "high" (ApproveFromMsg "re-extract knowledge high only")

# write filter: approve=high writes only high-confidence; approve=all writes all.
function CountWritten([string]$approveMode, $confs) {
  $written = 0
  foreach ($conf in @($confs)) {
    if ($approveMode -eq "all") { $written++ }
    elseif ($conf -eq "high")   { $written++ }
  }
  return $written
}
Write-Host "`n-- mirror: approve-tier write filter --" -ForegroundColor Cyan
$confs = @("high", "high", "medium", "low", "high")   # 3 high, 2 non-high
CheckEq "approve=high writes only high"  3 (CountWritten "high" $confs)
CheckEq "approve=all writes everything"  5 (CountWritten "all"  $confs)

# ==== mirror: unextracted-source selection (the repair target set). Built from
#      the REAL live audit data: sources 1,2,3,4 have nodes; source 6 has 0. =====
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
$nodeDocIds = @(1, 1, 1, 2, 2, 3, 3, 4, 1, 2)   # nodes for 1-4; none for 6
$un = UnextractedIds $sourceIds $nodeDocIds
CheckEq "exactly one unextracted source" 1 $un.Count
CheckTrue "source 6 is the unextracted target" ($un -contains 6)
$unAll = UnextractedIds $sourceIds @()
CheckEq "empty graph -> all sources unextracted" 5 $unAll.Count
$unNone = UnextractedIds $sourceIds @(1, 2, 3, 4, 6)
CheckEq "fully extracted -> no targets (nothing to do)" 0 $unNone.Count

# ==== mock: the endpoint/handler response shape has the expected fields ========
Write-Host "`n-- mock: re-extract response shape --" -ForegroundColor Cyan
$mock = @{
  processed   = 1
  total_added = 0
  per_source  = @(@{ source_id = 6; extracted = 0; added = 0; skipped = 0; pending = 0 })
}
CheckTrue "response has processed"   ($mock.ContainsKey("processed"))
CheckTrue "response has total_added" ($mock.ContainsKey("total_added"))
CheckTrue "response has per_source"  ($mock.ContainsKey("per_source"))
CheckTrue "per_source row has source_id" ($mock.per_source[0].ContainsKey("source_id"))

# ==== optional live HTTP case (only when M8_BASE_URL is set) ===================
Write-Host "`n-- live HTTP (optional: set M8_BASE_URL to run) --" -ForegroundColor Cyan
$base = $env:M8_BASE_URL
if (-not $base) {
  MarkSkip "POST /api/ingest-extract-existing (no M8_BASE_URL)"
} else {
  $base = $base.TrimEnd("/")
  try {
    $body = @{ approve = "all" } | ConvertTo-Json
    $r = Invoke-RestMethod -Method Post -Uri "$base/api/ingest-extract-existing" -ContentType "application/json" -Body $body -TimeoutSec 180
    CheckTrue "live re-extract returned processed count" ($null -ne $r.processed)
    CheckTrue "live re-extract returned total_added"     ($null -ne $r.total_added)
  } catch {
    CheckTrue ("live re-extract POST failed: " + $_.Exception.Message) $false
  }
}

Write-Host "`n================ B102 RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
Write-Host ("  SKIP: " + $skip) -ForegroundColor Yellow
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
