# tests/B83d-proposer-feedback-verify.ps1
# Build-83d -- M4 Proposer Feedback Loop -- offline, pure PS 5.1 ASCII.
#
# Verifies:
#   1. proposer-feedback.js exists with correct exports
#   2. feedbackTokens + feedbackJaccard pure logic
#   3. matchesVerified: correct threshold + best-match logic
#   4. buildFeedbackContext: correct V/D label formatting
#   5. getVerifiedLeaves + getDeadEndLeaves exported (async stubs not called)
#   6. VERIFIED_MATCH_MIN and STALE_DAYS constants present
#   7. conjecture-gen.js exports runConjectureGenWithFeedback
#   8. runConjectureGenWithFeedback wires proposer-feedback correctly
#   9. decomp-proposer.js has verified-leaf fetch block in proposeDecompositionPlan
#  10. decomp-proposer.js injects feedbackBlock into generate user message
#  11. decomp-proposer.js annotates matching leaves (alreadyVerified)
#  12. renderProposalPacket renders ALREADY VERIFIED note
#
# No Node, no network, no Supabase -- all checks are source-file pattern matches
# and a PS-port of the pure core logic.

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$pfPath   = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\proposer-feedback.js"))
$cgPath   = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\conjecture-gen.js"))
$dpPath   = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\decomp-proposer.js"))

$pf = [IO.File]::ReadAllText($pfPath, [Text.Encoding]::UTF8)
$cg = [IO.File]::ReadAllText($cgPath, [Text.Encoding]::UTF8)
$dp = [IO.File]::ReadAllText($dpPath, [Text.Encoding]::UTF8)

Write-Host "Build-83d proposer feedback loop verify`n"

# ---- 1. proposer-feedback.js exports -----------------------------------------
Write-Host "-- 1. proposer-feedback.js exports --"
Assert-True "exports feedbackTokens"        ($pf -match "feedbackTokens")
Assert-True "exports feedbackJaccard"       ($pf -match "feedbackJaccard")
Assert-True "exports matchesVerified"       ($pf -match "matchesVerified")
Assert-True "exports buildFeedbackContext"  ($pf -match "buildFeedbackContext")
Assert-True "exports getVerifiedLeaves"     ($pf -match "getVerifiedLeaves")
Assert-True "exports getDeadEndLeaves"      ($pf -match "getDeadEndLeaves")
Assert-True "exports VERIFIED_MATCH_MIN"    ($pf -match "VERIFIED_MATCH_MIN")
Assert-True "exports STALE_DAYS"            ($pf -match "STALE_DAYS")

# ---- 2. feedbackTokens pure logic (PS port) ----------------------------------
Write-Host "`n-- 2. feedbackTokens (PS port) --"
$FB_STOP = @('the','a','an','of','for','to','is','are','be','every','each','all','and','or',
             'that','this','with','by','in','on','its','it','as','at','if','then','so','we',
             'i','you','n','x','k','m','have','has','had','let','be','does','do')

function FbTokens($s) {
  $toks = New-Object System.Collections.Generic.List[string]
  foreach ($t in (([string]$s).ToLower() -replace '[^a-z0-9\s]', ' ') -split '\s+') {
    if ($t.Length -gt 0 -and ($FB_STOP -notcontains $t)) { [void]$toks.Add($t) }
  }
  return $toks
}
function FbJaccard($toksA, $toksB) {
  $A = @{}; foreach ($t in $toksA) { $A[$t] = 1 }
  $B = @{}; foreach ($t in $toksB) { $B[$t] = 1 }
  if ($A.Count -eq 0 -or $B.Count -eq 0) { return 0.0 }
  $inter = 0; foreach ($t in $A.Keys) { if ($B.ContainsKey($t)) { $inter++ } }
  $union = $A.Count + $B.Count - $inter
  if ($union -eq 0) { return 0.0 }
  return [double]$inter / [double]$union
}

$tA = FbTokens "sigma(n) stopping time is bounded"
$tB = FbTokens "stopping time sigma bounded above"
$tC = FbTokens "totally unrelated topic about cats"
Assert-True "shared tokens non-empty"   ($tA.Count -gt 0)
Assert-True "jaccard(A,B) > 0"          ((FbJaccard $tA $tB) -gt 0.0)
Assert-True "jaccard(A,B) < 1"          ((FbJaccard $tA $tB) -lt 1.0)
Assert-True "jaccard(A,C) < jaccard(A,B)" ((FbJaccard $tA $tC) -lt (FbJaccard $tA $tB))
Assert-True "jaccard(empty,B) = 0"      ((FbJaccard @() $tB) -eq 0.0)
Assert-True "stopwords removed"         ($tA -notcontains 'is')
Assert-True "stopwords removed 'the'"   ($tA -notcontains 'the')

# ---- 3. matchesVerified pure logic (PS port) ----------------------------------
Write-Host "`n-- 3. matchesVerified (PS port) --"
$MATCH_MIN = 0.70

function MatchesVerified($prose, $verifiedLeaves) {
  $tokA = FbTokens $prose
  $best = @{ matched = $false }
  foreach ($vl in $verifiedLeaves) {
    $tokB = FbTokens $vl.label
    $sim = FbJaccard $tokA $tokB
    if ($sim -ge $MATCH_MIN -and (-not $best.matched -or $sim -gt $best.sim)) {
      $best = @{ matched = $true; matchedLabel = $vl.label; sim = $sim }
    }
  }
  return $best
}

$verifiedSet = @(
  [pscustomobject]@{ label = "for all odd n with nu2 at least 2 total stopping time is bounded by 150" },
  [pscustomobject]@{ label = "sigma n stopping time is at most 100 for residue 3 mod 7" }
)

# identical prose -> should match
$r1 = MatchesVerified "for all odd n with nu2 at least 2 total stopping time is bounded by 150" $verifiedSet
Assert-True "identical prose matches"          $r1.matched
Assert-True "sim close to 1 for identical"     ($r1.sim -gt 0.90)

# moderately similar -> should match if >= 0.70
$r2 = MatchesVerified "for all odd n nu2 at least 2 total stopping time bounded 150" $verifiedSet
Assert-True "near-identical prose matches"     $r2.matched

# unrelated -> no match
$r3 = MatchesVerified "completely different conjecture about primes and factorials" $verifiedSet
Assert-True "unrelated prose does not match"   (-not $r3.matched)

# empty verified list -> no match
$r4 = MatchesVerified "nu2 stopping time bounded" @()
Assert-True "empty verified list -> no match"  (-not $r4.matched)

# best-match is selected (highest sim)
$r5 = MatchesVerified "sigma n stopping time at most 100 for residue 3 mod 7" $verifiedSet
Assert-True "best match picks highest sim"     ($r5.matched -and ($r5.matchedLabel -like "*sigma*"))

# ---- 4. buildFeedbackContext pure logic (PS port) ----------------------------
Write-Host "`n-- 4. buildFeedbackContext (PS port) --"
function BuildFeedbackContext($verifiedLeaves, $deadEndLeaves) {
  $lines = New-Object System.Collections.Generic.List[string]
  if ($verifiedLeaves.Count -gt 0) {
    [void]$lines.Add("VERIFIED GROUND (Lean-machine-checked -- sub-goals matching these are already proven):")
    $i = 0
    foreach ($n in $verifiedLeaves) {
      $lbl = ([string]$n.label)
      if ($lbl.Length -gt 200) { $lbl = $lbl.Substring(0, 200) }
      [void]$lines.Add("  V$($i+1). $lbl")
      $i++
    }
  }
  if ($deadEndLeaves.Count -gt 0) {
    [void]$lines.Add("DEAD-END PATTERNS (lean_rejected after repair attempts -- avoid similar sub-goal formulations):")
    $i = 0
    foreach ($n in $deadEndLeaves) {
      $txt = if ($n.content) { [string]$n.content } else { [string]$n.label }
      if ($txt.Length -gt 200) { $txt = $txt.Substring(0, 200) }
      $why = if ($n.reason) { " [Lean error: $([string]$n.reason)]" } else { "" }
      [void]$lines.Add("  D$($i+1). $txt$why")
      $i++
    }
  }
  return ($lines -join "`n")
}

$vLeaves = @(
  [pscustomobject]@{ label = "for all odd n nu2 total stopping bounded" },
  [pscustomobject]@{ label = "sigma residue 3 mod 7 at most 100" }
)
$dLeaves = @(
  [pscustomobject]@{ content = "peak excursion always below n^2 for nu2 class"; label = ""; reason = "type mismatch Nat vs Int" }
)

$ctx = BuildFeedbackContext $vLeaves $dLeaves
Assert-True "context contains VERIFIED GROUND header"  ($ctx -match "VERIFIED GROUND")
Assert-True "context contains V1 entry"                ($ctx -match "V1\.")
Assert-True "context contains V2 entry"                ($ctx -match "V2\.")
Assert-True "context contains DEAD-END PATTERNS header" ($ctx -match "DEAD-END PATTERNS")
Assert-True "context contains D1 entry"                ($ctx -match "D1\.")
Assert-True "D1 entry has Lean error note"             ($ctx -match "Lean error:")

$ctxEmpty = BuildFeedbackContext @() @()
Assert-True "empty inputs produce empty string"        ($ctxEmpty -eq "")

$ctxVerOnly = BuildFeedbackContext $vLeaves @()
Assert-True "verified-only: no dead-end header"        ($ctxVerOnly -notmatch "DEAD-END")

$ctxDeadOnly = BuildFeedbackContext @() $dLeaves
Assert-True "dead-end-only: no verified header"        ($ctxDeadOnly -notmatch "VERIFIED GROUND")

# ---- 5. proposer-feedback.js constants ---------------------------------------
Write-Host "`n-- 5. constants in proposer-feedback.js --"
Assert-True "VERIFIED_MATCH_MIN = 0.70"   ($pf -match "VERIFIED_MATCH_MIN\s*=\s*0\.70")
Assert-True "STALE_DAYS = 3"              ($pf -match "STALE_DAYS\s*=\s*3")

# ---- 6. getVerifiedLeaves queries m8_graph_nodes -----------------------------
Write-Host "`n-- 6. getVerifiedLeaves Supabase query --"
Assert-True "queries m8_graph_nodes"         ($pf -match "m8_graph_nodes")
Assert-True "filters kind = theorem"         ($pf -match "kind.*theorem")
Assert-True "filters status = lean_verified" ($pf -match "lean_verified")
Assert-True "orders by created_at desc"      ($pf -match "created_at.*ascending.*false")

# ---- 7. getDeadEndLeaves queries m8_lemma_scaffold ---------------------------
Write-Host "`n-- 7. getDeadEndLeaves Supabase query --"
Assert-True "queries m8_lemma_scaffold"        ($pf -match "m8_lemma_scaffold")
Assert-True "filters status = open"            ($pf -match "\.eq\(`"status`", `"open`"\)")
Assert-True "filters leaves_verified = 0"      ($pf -match "leaves_verified.*0")
Assert-True "filters by updated_at cutoff"     ($pf -match "lt\(`"updated_at`"")
Assert-True "checks lean_rejected in loop"     ($pf -match "lean_rejected")
Assert-True "uses STALE_DAYS in cutoff"        ($pf -match "STALE_DAYS")

# ---- 8. conjecture-gen.js exports runConjectureGenWithFeedback ---------------
Write-Host "`n-- 8. conjecture-gen.js runConjectureGenWithFeedback --"
Assert-True "function defined"                   ($cg -match "async function runConjectureGenWithFeedback")
Assert-True "exported in module.exports"         (($cg -split "module\.exports")[1] -match "runConjectureGenWithFeedback")
Assert-True "calls runConjectureGen internally"  (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "runConjectureGen\("
)
Assert-True "requires proposer-feedback"         (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "proposer-feedback"
)
Assert-True "calls getVerifiedLeaves"            (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "getVerifiedLeaves"
)
Assert-True "calls getDeadEndLeaves"             (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "getDeadEndLeaves"
)
Assert-True "calls buildFeedbackContext"         (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "buildFeedbackContext"
)
Assert-True "appends FEEDBACK CONTEXT to packet" (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "FEEDBACK CONTEXT"
)
Assert-True "returns feedbackContext field"      (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "feedbackContext"
)
Assert-True "returns verifiedLeaves field"       (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "verifiedLeaves"
)
Assert-True "returns deadEndLeaves field"        (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "deadEndLeaves"
)
Assert-True "respects GRAPH_DISABLED"            (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "GRAPH_DISABLED"
)
Assert-True "fail-safe catch block"              (
  ($cg -split "async function runConjectureGenWithFeedback")[1] -match "catch\s*\("
)

# ---- 9. decomp-proposer.js: verified leaf fetch in proposeDecompositionPlan --
Write-Host "`n-- 9. decomp-proposer.js feedback fetch --"
$dpPropFn = ($dp -split "async function proposeDecompositionPlan")[1]

Assert-True "requires proposer-feedback"       ($dpPropFn -match "proposer-feedback")
Assert-True "calls getVerifiedLeaves"          ($dpPropFn -match "getVerifiedLeaves")
Assert-True "respects GRAPH_DISABLED guard"    ($dpPropFn -match "GRAPH_DISABLED")
Assert-True "fail-safe catch block"            ($dpPropFn -match "catch\s*\(")

# ---- 10. decomp-proposer.js: feedbackBlock injected into user message ---------
Write-Host "`n-- 10. decomp-proposer.js feedbackBlock injection --"
Assert-True "feedbackBlock variable defined"         ($dpPropFn -match "feedbackBlock")
Assert-True "feedbackBlock appended to user message" ($dpPropFn -match "feedbackBlock\s*\}")
Assert-True "user message references feedbackBlock"  (
  $dpPropFn -match 'now\..*\$\{feedbackBlock\}|now\.\s*`\$\{feedbackBlock\}'
)

# ---- 11. decomp-proposer.js: alreadyVerified annotation ---------------------
Write-Host "`n-- 11. decomp-proposer.js alreadyVerified annotation --"
Assert-True "calls matchesVerified"            ($dpPropFn -match "matchesVerified")
Assert-True "sets l.alreadyVerified"           ($dpPropFn -match "alreadyVerified")
Assert-True "annotation only for is_leaf"      ($dpPropFn -match "is_leaf")

# ---- 12. renderProposalPacket renders ALREADY VERIFIED -----------------------
Write-Host "`n-- 12. renderProposalPacket ALREADY VERIFIED rendering --"
$renderFn = ($dp -split "function renderProposalPacket")[1]
Assert-True "reads alreadyVerified"          ($renderFn -match "alreadyVerified")
Assert-True "renders ALREADY VERIFIED text"  ($renderFn -match "ALREADY VERIFIED")
Assert-True "shows sim value"                ($renderFn -match "\.toFixed\(2\)")

# ---- summary -----------------------------------------------------------------
Write-Host ""
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "ALL $total PASS -- Build-83d proposer feedback loop verified." -ForegroundColor Green
} else {
  Write-Host "$($script:pass)/$total passed, $($script:fail) FAILED." -ForegroundColor Red
  exit 1
}
