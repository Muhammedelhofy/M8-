# ============================================================================
# M8 Build-41 -- Full epistemic axis (D1+D2+D4): PS mirror + static checks
# ----------------------------------------------------------------------------
# No local Node, so the pure predicates are MIRRORED here against the same logic
# exported from lib/knowledge-intake.js (normalizeSourceClass) and
# lib/memory-graph.js (edgeAllowed). Keep these in lockstep with the JS. Plus a
# static generator-purity grep (D4-3b) that freezes rule (3): the conjecture
# generator can never emit a speculative source_class. Pure ASCII.
#   powershell -File tests/epistemic-axis-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}
$repo = Split-Path -Parent $PSScriptRoot   # ...\M8

Write-Host "`nM8 Build-41 -- epistemic axis (D1 bucket collapse / D2 edge-ban / D4 generator purity)`n"

# ============================================================================
# D1 -- normalizeSourceClass (mirror of lib/knowledge-intake.js)
#   fringe -> speculative ; established/speculative pass ; unknown -> null
# ============================================================================
$VALID_CLASS = @('established','speculative')
function Normalize-SourceClass($c) {
  $v = ([string]$c).Trim().ToLower()
  if ($v -eq 'fringe') { return 'speculative' }
  if ($VALID_CLASS -contains $v) { return $v }
  return $null
}
Write-Host "-- D1: bucket normalization --"
Ok ((Normalize-SourceClass 'fringe')      -eq 'speculative') "fringe -> speculative (deprecated alias folded)"
Ok ((Normalize-SourceClass 'FRINGE')      -eq 'speculative') "FRINGE (case-insensitive) -> speculative"
Ok ((Normalize-SourceClass ' speculative')-eq 'speculative') "speculative (trimmed) -> speculative"
Ok ((Normalize-SourceClass 'established') -eq 'established')  "established -> established (unchanged)"
Ok ($null -eq (Normalize-SourceClass 'made-up')) "unrecognized class -> null (caller prompts)"
Ok ($null -eq (Normalize-SourceClass ''))        "empty -> null"
Ok (-not ($VALID_CLASS -contains 'fringe')) "INVARIANT: 'fringe' is no longer a canonical bucket"

# ============================================================================
# D2 -- edgeAllowed (mirror of lib/memory-graph.js)
#   evidence/proof-bearing rels {supports, formalizes} are BANNED when either
#   endpoint is speculative (fringe treated as speculative). All else allowed.
# ============================================================================
$EVIDENCE_BEARING_RELS = @('supports','formalizes')
function Is-SpeculativeClass($c) { return ($c -eq 'speculative' -or $c -eq 'fringe') }
function Edge-Allowed($rel, $srcClass, $dstClass) {
  if (-not ($EVIDENCE_BEARING_RELS -contains $rel)) { return $true }
  return (-not ((Is-SpeculativeClass $srcClass) -or (Is-SpeculativeClass $dstClass)))
}
Write-Host "`n-- D2: schema edge-ban --"
# banned cases
Ok (-not (Edge-Allowed 'supports'   'speculative' 'established')) "supports with speculative SRC -> BANNED"
Ok (-not (Edge-Allowed 'supports'   'established' 'speculative')) "supports with speculative DST -> BANNED"
Ok (-not (Edge-Allowed 'formalizes' 'speculative' 'established')) "formalizes touching speculative -> BANNED"
Ok (-not (Edge-Allowed 'supports'   'fringe'      'established')) "supports with legacy 'fringe' endpoint -> BANNED (treated as speculative)"
# allowed: non-evidence rels touching speculative
Ok (Edge-Allowed 'contradicts'  'speculative' 'established') "contradicts touching speculative -> ALLOWED (honest refutation)"
Ok (Edge-Allowed 'generalizes'  'speculative' 'established') "generalizes touching speculative -> ALLOWED (structure)"
Ok (Edge-Allowed 'depends_on'   'speculative' 'established') "depends_on touching speculative -> ALLOWED"
Ok (Edge-Allowed 'derived_from' 'speculative' 'established') "derived_from touching speculative -> ALLOWED (Build-42 kernel/leap relation)"
# allowed: evidence rels between non-speculative nodes
Ok (Edge-Allowed 'supports'   'established' 'established') "supports between established nodes -> ALLOWED"
Ok (Edge-Allowed 'formalizes' 'established' $null)         "formalizes with a null-class (code/research) endpoint -> ALLOWED"
Ok (Edge-Allowed 'supports'   $null         $null)         "supports between two null-class (research) nodes -> ALLOWED"

# ============================================================================
# D4-3b -- generator-purity static check (freezes team rule 3)
#   The conjecture generator / seed pack must NEVER hand a speculative
#   source_class (or source:'external') into the graph. source_class is written
#   ONLY by the ingest path (populateGraph). conjecture-gen.js must mention no
#   source_class at all; upsertNode's srcVal clamp must still force unknown
#   sources to 'code'.
# ============================================================================
Write-Host "`n-- D4: generator purity (static) --"
$genTxt   = Get-Content (Join-Path $repo 'lib\conjecture-gen.js') -Raw
$mgTxt    = Get-Content (Join-Path $repo 'lib\memory-graph.js')   -Raw
$intakeTxt= Get-Content (Join-Path $repo 'lib\knowledge-intake.js') -Raw

Ok (-not ($genTxt -match 'source_class')) "conjecture-gen.js never references source_class"
Ok (-not ($genTxt -match "source\s*:\s*['""]external['""]")) "conjecture-gen.js never sets source:'external'"
# upsertNode srcVal clamp still present (forces non extraction/external -> 'code')
Ok ($mgTxt -match "srcVal\s*=\s*\(fields\.source\s*===\s*[""']extraction[""']\s*\|\|\s*fields\.source\s*===\s*[""']external[""']\)\s*\?\s*fields\.source\s*:\s*[""']code[""']") "upsertNode srcVal clamp intact (unknown source -> 'code')"
# source_class is written only in the ingest path
Ok ($intakeTxt -match 'source_class:\s*c\.source_class') "populateGraph (intake) is the writer of source_class"
Ok (-not ($mgTxt -match 'source_class:')) "memory-graph.js upsertNode does NOT write source_class (read-only on that axis)"

Write-Host ("`n==== epistemic-axis-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
