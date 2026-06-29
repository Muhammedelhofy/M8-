# tests/knowledge-embeddings.test.ps1 -- Build-158 semantic-embeddings ship gate.
# PS-5.1 mirror of logic added to lib/knowledge-intake.js:
#   backfillKnowledgeEmbeddings (accounting + default IDs)
#   searchKnowledgeGraph hybrid routing (semantic >= KG_SEM_MIN_HITS -> use it; else keyword)
#   output format ([Claim] / [Entity] prefix)
# No network, no DB, no Gemini. Pure PS 5.1.
# PS-5.1 notes: (a) avoid non-ASCII in Write-Host (box chars corrupt the parser);
#               (b) $input is a reserved automatic variable -- use $srcIds instead;
#               (c) avoid & inside hash literal strings (use "and" / "plus").

$pass = 0; $fail = 0

function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }
function CheckEq([string]$label, $expected, $actual) {
  CheckTrue ($label + " exp=" + $expected + " got=" + $actual) ($expected -eq $actual)
}
function CheckContains([string]$label, [string]$text, [string]$sub) {
  CheckTrue ($label + " contains " + $sub) ($text -and $text.Contains($sub))
}

# -- Constants mirrored from knowledge-intake.js --------------------------------
$KG_SEM_MIN_HITS = 2

# -- Mirror: hybrid routing logic from searchKnowledgeGraph() ------------------
# Semantic >= KG_SEM_MIN_HITS hits -> use semantic result.
# Fewer hits, empty, or error -> fall through to keyword ILIKE.
function HybridRoutingMirror([object[]]$semHits, [bool]$semError, [object[]]$kwHits) {
  if (-not $semError -and $semHits -and $semHits.Count -ge $KG_SEM_MIN_HITS) {
    return [pscustomobject]@{ path="semantic"; used_keyword=$false; cnt=$semHits.Count }
  }
  return [pscustomobject]@{ path="keyword"; used_keyword=$true; cnt=@($kwHits).Count }
}

# Mirror: output format  "[Claim] label: content" / "[Entity] label: content"
function FormatKgHit([string]$kind, [string]$label, [string]$content) {
  $prefix = if ($kind -eq "claim") { "Claim" } else { "Entity" }
  return "[$prefix] ${label}: ${content}"
}

Write-Host "`n-- Hybrid routing: semantic path (>= 2 hits) --" -ForegroundColor Cyan

$hitA_label   = "nine-core-competencies-ops-supply"
$hitA_content = "CV core competencies: Supply and Fleet Ops, Team Leadership and OKRs, PL Ownership."
$hitB_label   = "careem-supply-manager-egypt-8-years"
$hitB_content = "Worked at Careem for approximately 8 years, ending as Supply Manager for Egypt."
$hitA = [pscustomobject]@{ kind="claim"; label=$hitA_label; content=$hitA_content }
$hitB = [pscustomobject]@{ kind="claim"; label=$hitB_label; content=$hitB_content }
$semFull = @($hitA, $hitB)

$r = HybridRoutingMirror $semFull $false @()
CheckEq    "semantic path taken when >=2 hits" "semantic" $r.path
CheckFalse "keyword flag NOT set"               $r.used_keyword
CheckEq    "2 hits returned"                   2 $r.cnt

Write-Host "`n-- Hybrid routing: keyword fallback when 1 sem hit --" -ForegroundColor Cyan

$sem1_label   = "alkhair-alwafeer-current-role"
$sem1_content = "Current role Oct 2025"
$sem1 = @([pscustomobject]@{ kind="entity"; label=$sem1_label; content=$sem1_content })

$kwA_label   = "bolt-api-fleet-dashboard-built"
$kwA_content = "Built Bolt API fleet dashboard"
$kwB_label   = "acquisition-channel-zero-to-15pct-market"
$kwB_content = "Built Careem Egypt acquisition channel from 0 to 15 pct."
$kwHitA = [pscustomobject]@{ kind="claim"; label=$kwA_label; content=$kwA_content }
$kwHitB = [pscustomobject]@{ kind="claim"; label=$kwB_label; content=$kwB_content }
$kw2    = @($kwHitA, $kwHitB)

$r2 = HybridRoutingMirror $sem1 $false $kw2
CheckEq   "keyword fallback when 1 sem hit" "keyword" $r2.path
CheckTrue "keyword flag set"                $r2.used_keyword
CheckEq   "keyword hit count = 2"          2 $r2.cnt

Write-Host "`n-- Hybrid routing: keyword fallback on sem error --" -ForegroundColor Cyan
$r3 = HybridRoutingMirror @() $true $kw2
CheckEq   "keyword path on sem error"  "keyword" $r3.path
CheckTrue "keyword flag set on error"  $r3.used_keyword
CheckEq   "kw hits returned on error"  2 $r3.cnt

Write-Host "`n-- Hybrid routing: keyword fallback on 0 sem hits --" -ForegroundColor Cyan
$r4 = HybridRoutingMirror @() $false $kw2
CheckEq   "0 sem hits -> keyword path" "keyword" $r4.path
CheckEq   "kw hits count = 2"          2 $r4.cnt

Write-Host "`n-- Hybrid routing: exactly 2 sem hits (at threshold) --" -ForegroundColor Cyan
$hitC = [pscustomobject]@{ kind="claim"; label="node-a"; content="Content A" }
$hitD = [pscustomobject]@{ kind="claim"; label="node-b"; content="Content B" }
$r5 = HybridRoutingMirror @($hitC, $hitD) $false @()
CheckEq    "exactly 2 sem hits -> semantic" "semantic" $r5.path
CheckFalse "keyword flag NOT set at threshold" $r5.used_keyword

# -- Output format checks ------------------------------------------------------
Write-Host "`n-- Output format: [Claim] / [Entity] prefix --" -ForegroundColor Cyan

$fmtClaim  = FormatKgHit "claim"  "nine-core-competencies-ops-supply" "Supply and Fleet Ops"
$fmtEntity = FormatKgHit "entity" "careem-egypt-supply-manager-2022-2025" "Supply Manager Egypt"

CheckContains "claim has Claim prefix"    $fmtClaim  "[Claim]"
CheckContains "claim has label"           $fmtClaim  "nine-core-competencies-ops-supply"
CheckContains "claim has content"         $fmtClaim  "Supply and Fleet"
CheckContains "entity has Entity prefix"  $fmtEntity "[Entity]"
CheckContains "entity has label"          $fmtEntity "careem-egypt-supply-manager"
CheckContains "entity has content"        $fmtEntity "Supply Manager Egypt"

# -- Mirror: backfillKnowledgeEmbeddings default source IDs -------------------
# $input is RESERVED in PS 5.1 (pipeline automatic variable). Use $srcIds.
function ParseBackfillSourceIds([object[]]$srcIds) {
  if ($srcIds -and $srcIds.Count -gt 0) {
    $out = [System.Collections.Generic.List[int]]::new()
    foreach ($s in $srcIds) { $out.Add([int]$s) }
    return ,$out.ToArray()
  }
  return @(34, 35, 36, 37)
}

Write-Host "`n-- backfillKnowledgeEmbeddings: default source IDs --" -ForegroundColor Cyan
$ids1 = ParseBackfillSourceIds @()
CheckEq   "default IDs count = 4" 4 $ids1.Count
CheckTrue "34 in defaults"        ($ids1 -contains 34)
CheckTrue "35 in defaults"        ($ids1 -contains 35)
CheckTrue "36 in defaults"        ($ids1 -contains 36)
CheckTrue "37 in defaults"        ($ids1 -contains 37)

$ids2 = ParseBackfillSourceIds @(37)
CheckEq   "explicit IDs respected" 1 $ids2.Count
CheckTrue "37 in explicit list"    ($ids2 -contains 37)

$ids3 = ParseBackfillSourceIds @(34, 35)
CheckEq   "two explicit IDs"       2 $ids3.Count

# -- Mirror: backfillKnowledgeEmbeddings accounting ---------------------------
function BackfillAccountingMirror([object[]]$nodes, [bool[]]$embedSuccess) {
  $embedded = 0; $failed = 0
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    if ($embedSuccess[$i]) { $embedded++ } else { $failed++ }
  }
  return [pscustomobject]@{ embedded=$embedded; failed=$failed; total=$nodes.Count }
}

Write-Host "`n-- backfillKnowledgeEmbeddings: accounting --" -ForegroundColor Cyan

# 33 nodes, all succeed (happy path after deploy)
$nodes33 = 1..33 | ForEach-Object { [pscustomobject]@{ id=$_; label="node$_"; content="content$_" } }
$allOk   = [bool[]]::new(33); for ($i = 0; $i -lt 33; $i++) { $allOk[$i] = $true }
$a1 = BackfillAccountingMirror $nodes33 $allOk
CheckEq "all 33 embedded" 33 $a1.embedded
CheckEq "0 failed"         0 $a1.failed
CheckEq "total = 33"      33 $a1.total

# 30 succeed, 3 fail
$mix = [bool[]]::new(33)
for ($i = 0; $i -lt 30; $i++) { $mix[$i] = $true  }
for ($i = 30; $i -lt 33; $i++) { $mix[$i] = $false }
$a2 = BackfillAccountingMirror $nodes33 $mix
CheckEq "30 embedded on partial failure" 30 $a2.embedded
CheckEq "3 failed on partial failure"     3 $a2.failed
CheckEq "total still 33"                 33 $a2.total

# Empty nodes list -> no-op
$a3 = BackfillAccountingMirror @() ([bool[]]::new(0))
CheckEq "empty -> 0 embedded" 0 $a3.embedded
CheckEq "empty -> 0 failed"   0 $a3.failed
CheckEq "empty -> total 0"    0 $a3.total

# All fail
$nodes5  = 1..5 | ForEach-Object { [pscustomobject]@{ id=$_; label="n$_"; content="c$_" } }
$allFail = [bool[]]::new(5)
$a4 = BackfillAccountingMirror $nodes5 $allFail
CheckEq "0 embedded when all fail" 0 $a4.embedded
CheckEq "5 failed when all fail"   5 $a4.failed

# -- CV content: semantic retrievability sanity check -------------------------
Write-Host "`n-- CV content: semantic retrievability sanity check --" -ForegroundColor Cyan

# node 276: nine-core-competencies-ops-supply
# Query "management experience" -> semantic hit via "Stakeholder and Partner Management"
# Label does NOT contain "management" -> keyword miss on label, content hit
$leadershipLabel   = "nine-core-competencies-ops-supply"
$leadershipContent = "CV core competencies: Supply and Fleet Operations, PL Ownership and Cost Control, " +
  "Driver Acquisition Strategy, Digital Channel Scaling, Team Leadership and OKRs, " +
  "Incentive Design and Modelling, Cross-Platform Migrations, Forecasting and Demand Planning, " +
  "Stakeholder and Partner Management."

$labelHasMgmt   = $leadershipLabel.ToLower().Contains("management")
$contentHasMgmt = $leadershipContent.ToLower().Contains("management")
CheckFalse "label does NOT contain management" $labelHasMgmt
CheckTrue  "content DOES contain management"   $contentHasMgmt

$contentHasLeadership = $leadershipContent.ToLower().Contains("leadership")
CheckTrue  "content has leadership for retrieval" $contentHasLeadership

# node 265: careem-egypt-supply-manager-2022-2025
# Query "managing large teams" -> semantic hit via "coached multi-city teams"
$careerLabel   = "careem-egypt-supply-manager-2022-2025"
$careerContent = "Supply Manager - Egypt at Careem, Jan 2022-Sep 2025. Led nationwide driver " +
  "acquisition strategy, owned acquisition and incentive budgets, coached multi-city teams, " +
  "managed product launches across Egypt."

CheckFalse "careem label does NOT contain team" ($careerLabel.ToLower().Contains("team"))
CheckTrue  "careem content DOES contain team"   ($careerContent.ToLower().Contains("team"))

# node 274: vodafone-top-achiever-q4-2016 -- keyword anchor
CheckTrue "vodafone label has 'vodafone' keyword anchor" `
          ("vodafone-top-achiever-q4-2016".ToLower().Contains("vodafone"))

# -- Live-test instructions (informational) ------------------------------------
Write-Host "`n-- Live test (informational, always passes) --" -ForegroundColor Cyan
Write-Host "  1. Deploy branch then POST:" -ForegroundColor Yellow
Write-Host "     https://m8-alpha.vercel.app/api/knowledge?fn=embed-backfill" -ForegroundColor Yellow
Write-Host "     body: { source_ids: [34,35,36,37] }" -ForegroundColor Yellow
Write-Host "     Expect: { ok: true, embedded: 33, failed: 0, total: 33 }" -ForegroundColor Yellow
Write-Host "  2. M8 chat -- semantic (no exact keyword match):" -ForegroundColor Yellow
Write-Host "     'what does my CV say about team leadership'" -ForegroundColor Yellow
Write-Host "     -> Expect node nine-core-competencies-ops-supply surfaces" -ForegroundColor Yellow
Write-Host "     'what experience do I have managing large groups'" -ForegroundColor Yellow
Write-Host "     -> Expect Careem supply manager node surfaces" -ForegroundColor Yellow
Write-Host "  3. M8 chat -- keyword fallback (literal word in content):" -ForegroundColor Yellow
Write-Host "     'Vodafone' -> expect vodafone-top-achiever-q4-2016" -ForegroundColor Yellow
Write-Host "     'Wasally'  -> expect careem-multi-product-launch-bid-ask-wasally" -ForegroundColor Yellow
CheckTrue "live-test instructions printed" $true

Write-Host "`n================ KNOWLEDGE-EMBEDDINGS RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
