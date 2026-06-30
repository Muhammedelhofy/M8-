# tests/build166b_kg_retrieval_rank.test.ps1
# PS-5.1 MIRROR of Build-166b — the RELEVANCE-RANKED keyword fallback in
# lib/knowledge-intake.js searchKnowledgeGraph(). Node is absent on the host, so this:
#   (1) re-implements the IDF relevance ranking in PowerShell and drives it on a fixture
#       FAITHFUL to the live kafala miss (his real graph: 3 specific kafala-operation
#       nodes vs. high-confidence "operation"-only career nodes);
#   (2) proves the FIX: a rare query word ("kafala", df=3) outweighs a common one
#       ("operation", df=5) so the on-topic nodes rank ABOVE higher-confidence off-topic
#       ones, and ALL THREE kafala nodes land in the top-`limit` (the old confidence
#       ordering + limit*2 cap truncated them out -> the generic prod answer);
#   (3) proves graceful single-word behaviour (equal IDF -> confidence tie-break);
#   (4) STATICALLY proves the JS wire: KG_KW_CANDIDATES constant, the candidate fetch is
#       NOT confidence-ordered, selects confidence, and ranks by an IDF (Math.log/df) score.
#
# "PASS" = every check passes (exit 0). Any FAIL -> exit 1.

$ErrorActionPreference = 'Stop'
$script:fail = 0
function Check([string]$name, [bool]$cond) {
  if ($cond) { Write-Host ("  PASS  " + $name) }
  else { Write-Host ("  FAIL  " + $name); $script:fail = $script:fail + 1 }
}

$root  = Split-Path $PSScriptRoot -Parent
$kiFile = Join-Path $root 'lib\knowledge-intake.js'
if (-not (Test-Path $kiFile)) { Write-Host ("  FAIL  missing file: " + $kiFile); exit 1 }
$ki = [IO.File]::ReadAllText($kiFile, [Text.Encoding]::UTF8)

# ---------------------------------------------------------------------------------------
Write-Host "[1] IDF relevance ranking (PS mirror of the keyword fallback)"

# Query-word extraction mirror: lowercase, strip punct, len>=4, drop stopwords, cap 6.
$STOP = @('this','that','what','when','where','which','about','with','from','have','does','will','tell','give','show','want','know')
function Words([string]$q) {
  $clean = ($q.ToLower() -replace '[^\p{L}\p{N}\s]', ' ')
  $ws = $clean -split '\s+' | Where-Object { $_.Length -ge 4 -and ($STOP -notcontains $_) }
  return @($ws | Select-Object -First 6)
}
# IDF relevance mirror: weight(w) = log(1 + N/df(w)); score = sum over matched words.
function HayOf($n) { return (($n.label + ' ' + $n.content).ToLower()) }
function DocFreq($cands, $words) {
  $df = @{}
  foreach ($w in $words) {
    $c = 0
    foreach ($n in $cands) { if ((HayOf $n).Contains($w)) { $c++ } }
    $df[$w] = $c
  }
  return $df
}
function Relevance($node, $words, $df, [int]$total) {
  $hay = HayOf $node
  $s = 0.0
  foreach ($w in $words) {
    if ($hay.Contains($w)) { $s += [Math]::Log(1.0 + $total / [Math]::Max(1, [int]$df[$w])) }
  }
  return [double]$s
}
# Rank candidates: relevance desc, then confidence desc; return labels in order.
function RankLabels($cands, $words, [int]$limit) {
  $total = $cands.Count
  $df = DocFreq $cands $words
  $scored = foreach ($node in $cands) {
    [pscustomobject]@{ label = $node.label; rel = (Relevance $node $words $df $total); conf = [double]$node.confidence }
  }
  $ordered = $scored | Sort-Object -Property @{Expression='rel';Descending=$true}, @{Expression='conf';Descending=$true}
  return @($ordered | Select-Object -First $limit | ForEach-Object { $_.label })
}

# Fixture faithful to his real graph (the live kafala miss): three specific kafala nodes
# (one also mentions "operations") vs. higher-confidence "operation(s)"-only career nodes.
$cands = @(
  [pscustomobject]@{ label='full-career-timeline-2012-present';        content='career timeline across operations and supply'; confidence=0.9 }
  [pscustomobject]@{ label='nine-core-competencies-ops-supply';        content='nine core competencies in operations';         confidence=0.9 }
  [pscustomobject]@{ label='alkhair-alwafeer-current-role-oct2025';    content='current role leading operations';               confidence=0.9 }
  [pscustomobject]@{ label='settlement-dashboard-saas-business-idea';  content='dashboard for daily operation work';           confidence=0.8 }
  [pscustomobject]@{ label='current-role-alkhair-alwaffer-riyadh';     content='senior ops manager managing ride-hailing fleets plus kafala/delivery operations'; confidence=0.8 }  # node 249: kafala + operation
  [pscustomobject]@{ label='kafala-delivery-model-iqama-bikes-platform-profit'; content='company sponsors foreign workers iqama company-owned motorcycles couriers work delivery platforms'; confidence=0.8 } # node 285: kafala only
  [pscustomobject]@{ label='saudi-kafala-compliance-muqeem-tafweed-tamm'; content='deep expertise in saudi kafala compliance muqeem tafweed tamm'; confidence=0.8 } # node 287: kafala only
)
$words = @(Words 'tell me about my kafala operation')   # @() : a 1-elem PS return unwraps to scalar
Check "query words = {kafala, operation} (stopwords/short dropped)" (($words.Count -eq 2) -and ($words -contains 'kafala') -and ($words -contains 'operation'))

$df = DocFreq $cands $words
$total = $cands.Count
Check "df(kafala)=3, df(operation)=5 (kafala is the RARE/distinctive word)" (($df['kafala'] -eq 3) -and ($df['operation'] -eq 5))

$relKafalaOnly = Relevance ($cands[5]) $words $df $total    # kafala-delivery-model (conf 0.8)
$relOpHiConf   = Relevance ($cands[0]) $words $df $total    # full-career-timeline (operation, conf 0.9)
$relBoth       = Relevance ($cands[4]) $words $df $total    # node 249 (kafala + operation)
Check "rare-word node (kafala-only, conf 0.8) outranks common-word node (operation, conf 0.9)" ($relKafalaOnly -gt $relOpHiConf)
Check "node matching BOTH words ranks highest of all" (($relBoth -gt $relKafalaOnly) -and ($relBoth -gt $relOpHiConf))

$top6 = RankLabels $cands $words 6
Check "FIX: all 3 kafala nodes are in the top-6 result" (($top6 -contains 'current-role-alkhair-alwaffer-riyadh') -and ($top6 -contains 'kafala-delivery-model-iqama-bikes-platform-profit') -and ($top6 -contains 'saudi-kafala-compliance-muqeem-tafweed-tamm'))
Check "FIX: the both-words node is ranked #1" ($top6[0] -eq 'current-role-alkhair-alwaffer-riyadh')

# Contrast: the OLD behaviour (order by confidence, then cap) buries a kafala node.
$oldTop3 = @($cands | Sort-Object -Property @{Expression='confidence';Descending=$true} | Select-Object -First 3 | ForEach-Object { $_.label })
Check "OLD confidence-order top-3 were all the non-kafala 0.9 career nodes (the bug)" (($oldTop3 -notcontains 'kafala-delivery-model-iqama-bikes-platform-profit') -and ($oldTop3 -notcontains 'saudi-kafala-compliance-muqeem-tafweed-tamm'))

# ---------------------------------------------------------------------------------------
Write-Host "[2] graceful single-word query (equal IDF -> confidence tie-break)"
$wordsK = @(Words 'kafala')   # @() : force array (a 1-element PS return unwraps to a scalar string)
Check "single distinctive word extracted" (($wordsK.Count -eq 1) -and ($wordsK[0] -eq 'kafala'))
$kafalaOnlyCands = @($cands | Where-Object { (HayOf $_).Contains('kafala') })
$dfK = DocFreq $kafalaOnlyCands $wordsK
$r0 = Relevance ($kafalaOnlyCands[0]) $wordsK $dfK $kafalaOnlyCands.Count
$r1 = Relevance ($kafalaOnlyCands[1]) $wordsK $dfK $kafalaOnlyCands.Count
Check "single-word: all matches share equal relevance (-> confidence tie-break, prior behaviour)" ([Math]::Abs($r0 - $r1) -lt 1e-9)

# ---------------------------------------------------------------------------------------
Write-Host "[3] JS wire is correct (static)"
Check "KG_KW_CANDIDATES constant defined" ([regex]::IsMatch($ki, 'const\s+KG_KW_CANDIDATES\s*=\s*\d+'))
# isolate the searchKnowledgeGraph keyword-fallback region
$si = $ki.IndexOf('async function searchKnowledgeGraph')
$ei = $ki.IndexOf('async function backfillKnowledgeEmbeddings', [Math]::Max(0,$si))
Check "searchKnowledgeGraph located" (($si -ge 0) -and ($ei -gt $si))
if (($si -ge 0) -and ($ei -gt $si)) {
  $fn = $ki.Substring($si, $ei - $si)
  # the keyword-fallback fetch (the .or() block) must select confidence and NOT order by it
  $orIdx = $fn.IndexOf('.or(filters)')
  Check "keyword fetch present (.or(filters))" ($orIdx -ge 0)
  if ($orIdx -ge 0) {
    $win = $fn.Substring($orIdx, [Math]::Min(220, $fn.Length - $orIdx))
    Check "keyword fetch is NOT ordered by confidence (was the bug)" (-not $win.Contains('.order("confidence"'))
    Check "keyword fetch limited by KG_KW_CANDIDATES" ($win.Contains('.limit(KG_KW_CANDIDATES)'))
  }
  Check "select includes confidence (needed for tie-break)" ($fn.Contains('select("label, content, kind, confidence")'))
  Check "ranks by an IDF score (Math.log over doc-frequency df)" (($fn.Contains('Math.log(1 + data.length')) -and ($fn -match '\bdf\b'))
  Check "tie-break by confidence" ($fn.Contains('confidence) || 0)'))
  Check "semantic path (match_kg_nodes) left intact" ($fn.Contains('match_kg_nodes'))
}

# ---------------------------------------------------------------------------------------
Write-Host ""
if ($script:fail -gt 0) {
  Write-Host ("build166b kg-retrieval-rank mirror: FAIL ({0} check(s) failed)" -f $script:fail)
  exit 1
}
Write-Host "build166b kg-retrieval-rank mirror: OK (all checks passed)"
exit 0
