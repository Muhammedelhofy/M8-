# ============================================================================
# M8 Build-39 -- Read-path trust tiers: PS mirror of renderGraphPacket's
# tier-grouping + low-confidence-flag logic in lib/memory-graph.js
# ----------------------------------------------------------------------------
# No local Node, so the grouping/ordering/flag rules are mirrored here against
# the SAME TRUST_TIERS shape exported from lib/memory-graph.js. Pure ASCII.
#   powershell -File tests/trust-tier-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- mirror of TRUST_TIERS (lib/memory-graph.js) ----------------------------
$TRUST_TIERS = @('proven', 'empirical', 'heuristic', 'unverified', 'refuted')

# ---- mirror of the bucketing loop in renderGraphPacket ----------------------
function GroupByTier($nodes) {
  $buckets = @{}
  foreach ($t in $TRUST_TIERS) { $buckets[$t] = New-Object System.Collections.ArrayList }
  foreach ($n in $nodes) {
    $vs = $n.verification_state
    if (-not ($TRUST_TIERS -contains $vs)) { $vs = 'unverified' }
    [void]$buckets[$vs].Add($n)
  }
  return $buckets
}

# ---- mirror of the low-confidence flag rule ----------------------------------
function LowConfidence($n) {
  return ($null -ne $n.confidence) -and ($n.confidence -lt 0.5) -and ($n.verification_state -ne 'proven')
}

Write-Host "`nM8 Build-39 -- read-path trust tiers (memory-graph mirror)`n"

# ---- 1. tier order is fixed regardless of input order -----------------------
$nodes = @(
  @{ id='a'; verification_state='unverified'; confidence=0.6 },
  @{ id='b'; verification_state='proven';     confidence=1.0 },
  @{ id='c'; verification_state='refuted';    confidence=1.0 },
  @{ id='d'; verification_state='empirical';  confidence=0.9 },
  @{ id='e'; verification_state='heuristic';  confidence=0.6 }
)
$buckets = GroupByTier $nodes
$renderOrder = @()
foreach ($t in $TRUST_TIERS) { if ($buckets[$t].Count -gt 0) { $renderOrder += $t } }
Ok (($renderOrder -join ',') -eq 'proven,empirical,heuristic,unverified,refuted') "tier render order is fixed: proven,empirical,heuristic,unverified,refuted"

# ---- 2. cosine order preserved within a tier ---------------------------------
$nodes2 = @(
  @{ id='x1'; verification_state='unverified'; similarity=0.91 },
  @{ id='x2'; verification_state='proven';     similarity=0.88 },
  @{ id='x3'; verification_state='unverified'; similarity=0.85 },
  @{ id='x4'; verification_state='proven';     similarity=0.80 }
)
$buckets2 = GroupByTier $nodes2
$unverifiedIds = $buckets2['unverified'] | ForEach-Object { $_.id }
$provenIds     = $buckets2['proven']     | ForEach-Object { $_.id }
Ok (($unverifiedIds -join ',') -eq 'x1,x3') "cosine order preserved within 'unverified' bucket (x1 before x3)"
Ok (($provenIds -join ',') -eq 'x2,x4')     "cosine order preserved within 'proven' bucket (x2 before x4)"

# ---- 3. missing/unrecognized verification_state defaults to UNVERIFIED ------
$nodes3 = @(
  @{ id='y1'; verification_state=$null },
  @{ id='y2'; verification_state='' },
  @{ id='y3'; verification_state='some_future_state' }
)
$buckets3 = GroupByTier $nodes3
Ok ($buckets3['unverified'].Count -eq 3) "missing/null/unrecognized verification_state all bucket under UNVERIFIED"

# ---- 4. low-confidence flag rules --------------------------------------------
Ok (LowConfidence @{ confidence=0.4; verification_state='unverified' })   "low confidence: unverified @ 0.4 -> flagged"
Ok (-not (LowConfidence @{ confidence=0.9; verification_state='unverified' })) "low confidence: unverified @ 0.9 -> NOT flagged"
Ok (-not (LowConfidence @{ confidence=0.4; verification_state='proven' }))    "low confidence: proven @ 0.4 -> NEVER flagged (proven exempt)"
Ok (-not (LowConfidence @{ confidence=$null; verification_state='unverified' })) "low confidence: missing confidence -> NOT flagged (no claim made)"
Ok (LowConfidence @{ confidence=0.49; verification_state='heuristic' })   "low confidence: boundary 0.49 -> flagged"
Ok (-not (LowConfidence @{ confidence=0.5; verification_state='heuristic' })) "low confidence: boundary 0.5 -> NOT flagged (strict <)"

# ---- 5. empty tiers produce no header (no zero-row sections) ----------------
$nodesOnlyProven = @( @{ id='z1'; verification_state='proven'; confidence=1.0 } )
$bucketsP = GroupByTier $nodesOnlyProven
$renderedHeaders = @()
foreach ($t in $TRUST_TIERS) { if ($bucketsP[$t].Count -gt 0) { $renderedHeaders += $t } }
Ok (($renderedHeaders -join ',') -eq 'proven') "only non-empty tiers render a header (single-tier set -> just 'proven')"

# ---- 6. all five tiers covered, sum invariant --------------------------------
$total = 0
foreach ($t in $TRUST_TIERS) { $total += $buckets[$t].Count }
Ok ($total -eq $nodes.Count) "INVARIANT: every node lands in exactly one tier bucket (no drops, no duplicates)"

Write-Host ("`n==== trust-tier-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
