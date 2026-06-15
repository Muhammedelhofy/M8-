# ============================================================================
# M8 Build-38 -- Universal node provenance: PS mirror of lib/memory-graph.js
# ----------------------------------------------------------------------------
# No local Node, so the three derivations (deriveEvidenceKind / deriveConfidence /
# deriveVerificationState) + confidenceFromExtraction are mirrored here and asserted
# against the SAME maps used in lib/memory-graph.js AND
# migrations/m8_graph_nodes_provenance.sql (keep all three in lockstep). Pure ASCII.
#   powershell -File tests/provenance-graph-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- mirror of lib/memory-graph.js deriveEvidenceKind(kind) ----------------
function EvidenceKind([string]$kind) {
  switch ($kind) {
    'conjecture'     { return 'hypothesis' }
    'theorem'        { return 'result' }
    'evidence'       { return 'result' }
    'counterexample' { return 'result' }
    'failed_attempt' { return 'failed_path' }
    'sequence'       { return 'experiment' }
    'document'       { return 'reference' }
    'entity'         { return 'reference' }
    'technique'      { return 'reference' }
    'claim'          { return 'hypothesis' }
    default          { return $null }   # research_thread / anchors: NULL (no epistemic role)
  }
}
# ---- mirror of deriveConfidence(source, status) ----------------------------
function Confidence([string]$source, [string]$status) {
  if ($status -eq 'lean_verified') { return 1.0 }
  if ($source -eq 'code')          { return 1.0 }
  if ($source -eq 'external')      { return 0.9 }
  return 0.6
}
# ---- mirror of confidenceFromExtraction(extraction_confidence) -------------
function ConfFromExtraction([string]$ec) {
  switch ($ec) { 'high' { return 0.8 } 'medium' { return 0.6 } 'low' { return 0.4 } default { return $null } }
}
# ---- mirror of deriveVerificationState(kind, source, status) ---------------
function VerState([string]$kind, [string]$source, [string]$status) {
  if ($status -eq 'lean_verified') { return 'proven' }
  if ($kind   -eq 'counterexample'){ return 'refuted' }
  if ($kind   -eq 'evidence')      { return 'empirical' }
  if ($source -eq 'external')      { return 'empirical' }
  return 'unverified'
}

Write-Host "`nM8 Build-38 -- universal node provenance (memory-graph mirror)`n"

# ---- 1. evidence_kind: structural kind -> epistemic role -------------------
Ok ((EvidenceKind 'conjecture')     -eq 'hypothesis')  "evidence_kind: conjecture -> hypothesis"
Ok ((EvidenceKind 'theorem')        -eq 'result')      "evidence_kind: theorem -> result"
Ok ((EvidenceKind 'evidence')       -eq 'result')      "evidence_kind: evidence -> result"
Ok ((EvidenceKind 'counterexample') -eq 'result')      "evidence_kind: counterexample -> result"
Ok ((EvidenceKind 'failed_attempt') -eq 'failed_path') "evidence_kind: failed_attempt -> failed_path"
Ok ((EvidenceKind 'sequence')       -eq 'experiment')  "evidence_kind: sequence -> experiment"
Ok ((EvidenceKind 'document')       -eq 'reference')   "evidence_kind: document -> reference"
Ok ((EvidenceKind 'entity')         -eq 'reference')   "evidence_kind: entity -> reference"
Ok ((EvidenceKind 'technique')      -eq 'reference')   "evidence_kind: technique -> reference"
Ok ((EvidenceKind 'claim')          -eq 'hypothesis')  "evidence_kind: claim -> hypothesis"
Ok ($null -eq (EvidenceKind 'research_thread'))        "evidence_kind: research_thread -> NULL (anchor, no role)"

# ---- 2. confidence: code/lean = 1.0, external = 0.9, extraction = 0.6 ------
Ok ((Confidence 'code' $null)          -eq 1.0) "confidence: code -> 1.0"
Ok ((Confidence 'code' 'lean_verified')-eq 1.0) "confidence: lean_verified -> 1.0"
Ok ((Confidence 'external' $null)      -eq 0.9) "confidence: external -> 0.9"
Ok ((Confidence 'extraction' $null)    -eq 0.6) "confidence: extraction -> 0.6"
# intake claims map from extraction_confidence (truer than the external blanket)
Ok ((ConfFromExtraction 'high')   -eq 0.8) "confidence(intake): high -> 0.8"
Ok ((ConfFromExtraction 'medium') -eq 0.6) "confidence(intake): medium -> 0.6"
Ok ((ConfFromExtraction 'low')    -eq 0.4) "confidence(intake): low -> 0.4"
Ok ($null -eq (ConfFromExtraction 'x'))    "confidence(intake): unknown -> NULL (falls back to 0.6)"

# ---- 3. verification_state derivation --------------------------------------
Ok ((VerState 'conjecture' 'code' 'lean_verified') -eq 'proven')     "verification: lean_verified -> proven"
Ok ((VerState 'counterexample' 'code' $null)       -eq 'refuted')    "verification: counterexample -> refuted"
Ok ((VerState 'evidence' 'code' $null)             -eq 'empirical')  "verification: evidence -> empirical"
Ok ((VerState 'claim' 'external' $null)            -eq 'empirical')  "verification: external -> empirical"
Ok ((VerState 'conjecture' 'code' $null)           -eq 'unverified') "verification: conjecture -> unverified"
Ok ((VerState 'failed_attempt' 'code' $null)       -eq 'unverified') "verification: failed_attempt -> unverified"

# ---- 4. HONESTY INVARIANTS (the load-bearing ones) -------------------------
# Only Lean reaches 'proven': no source/kind combination without lean_verified status
# may yield 'proven'.
$everProvenWithoutLean = $false
foreach ($k in @('conjecture','theorem','evidence','counterexample','claim','document','entity','technique','sequence','failed_attempt')) {
  foreach ($s in @('code','external','extraction')) {
    if ((VerState $k $s $null) -eq 'proven') { $everProvenWithoutLean = $true }
    if ((VerState $k $s 'stated') -eq 'proven') { $everProvenWithoutLean = $true }
  }
}
Ok (-not $everProvenWithoutLean) "INVARIANT: nothing reaches 'proven' without lean_verified status"

# Ingestion/extraction can never set 'proven' OR 'refuted' on a non-counterexample:
# an ingested claim (source external/extraction, kind claim) is always 'empirical' or weaker.
Ok ((VerState 'claim' 'extraction' $null) -ne 'proven')  "INVARIANT: extraction claim is not 'proven'"
Ok ((VerState 'claim' 'extraction' $null) -ne 'refuted') "INVARIANT: extraction claim is not 'refuted'"
Ok ((VerState 'claim' 'external' $null)   -ne 'proven')  "INVARIANT: ingested external claim is not 'proven'"
# Only a counterexample reaches 'refuted'.
$everRefutedNonCx = $false
foreach ($k in @('conjecture','theorem','evidence','claim','document','entity','technique','sequence','failed_attempt')) {
  if ((VerState $k 'code' $null) -eq 'refuted') { $everRefutedNonCx = $true }
}
Ok (-not $everRefutedNonCx) "INVARIANT: only a counterexample reaches 'refuted'"

# ---- 5. enum membership (matches the SQL CHECK constraints) ----------------
$EVIDENCE = @('hypothesis','experiment','result','failed_path','reference')
$VERIF    = @('unverified','heuristic','empirical','proven','refuted')
$allEK = @('conjecture','theorem','evidence','counterexample','failed_attempt','sequence','document','entity','technique','claim') | ForEach-Object { EvidenceKind $_ }
Ok (($allEK | Where-Object { $_ -and ($EVIDENCE -notcontains $_) }).Count -eq 0) "all derived evidence_kind values are in the SQL CHECK set"
$allVS = foreach ($k in @('conjecture','theorem','evidence','counterexample','claim')) { foreach ($s in @('code','external','extraction')) { VerState $k $s 'lean_verified'; VerState $k $s $null } }
Ok (($allVS | Where-Object { $VERIF -notcontains $_ }).Count -eq 0) "all derived verification_state values are in the SQL CHECK set"

Write-Host ("`n==== provenance-graph-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
