# Build-56 -- Multi-Level DAG Verify
# PS mirror of dagDepth / subDagRoots / mergeSubDAG index logic + EXPAND detection.
# Pure ASCII. Run from anywhere; no Node, no network.
# Usage: powershell -ExecutionPolicy Bypass -File multilevel-dag-verify.ps1

$pass = 0; $fail = 0
function Check($label, $got, $want) {
  if ($got -eq $want) { $script:pass++; Write-Host "  PASS $label" }
  else { $script:fail++; Write-Host "  FAIL $label  got='$got'  want='$want'" }
}
function CheckTrue($label, $got) { Check $label $got $true }
function CheckFalse($label, $got) { Check $label $got $false }

# helper to build a lemma record
function L($idx, $deps) { return @{ idx = $idx; deps = @($deps); is_leaf = (@($deps).Count -eq 0) } }

# ---- mirror of dagDepth (longest dependency chain, node count) -------------
$script:ByIdx = @{}
function DepthOf($idx, $seen) {
  $l = $script:ByIdx[$idx]
  if (-not $l) { return 1 }
  if (@($l.deps).Count -eq 0) { return 1 }
  $best = 1
  foreach ($d in $l.deps) {
    if ($seen -contains $d) { continue }
    $cand = 1 + (DepthOf $d ($seen + @($d)))
    if ($cand -gt $best) { $best = $cand }
  }
  return $best
}
function DagDepth($lemmas) {
  $script:ByIdx = @{}
  foreach ($l in $lemmas) { $script:ByIdx[$l.idx] = $l }
  $max = 0; if (@($lemmas).Count -gt 0) { $max = 1 }
  foreach ($l in $lemmas) {
    $d = DepthOf $l.idx @($l.idx)
    if ($d -gt $max) { $max = $d }
  }
  return $max
}

Write-Host "`n=== dagDepth ==="
# flat plan: L1,L2 leaves + L3 parent[deps L1,L2] -> longest chain L3->L1 = 2
$flat = @( (L 1 @()), (L 2 @()), (L 3 @(1,2)) )
Check "flat plan depth = 2" (DagDepth $flat) 2
# two-level: + L4,L5 sub-leaves, L6 sub-root[deps L4,L5], L1 now deps L6
$two = @( (L 1 @(6)), (L 2 @()), (L 3 @(1,2)), (L 4 @()), (L 5 @()), (L 6 @(4,5)) )
Check "expanded plan depth = 4 (L3->L1->L6->L4)" (DagDepth $two) 4
Check "single leaf depth = 1" (DagDepth @((L 1 @()))) 1
Check "empty depth = 0" (DagDepth @()) 0

# ---- mirror of subDagRoots --------------------------------------------------
function SubDagRoots($subLemmas) {
  $depended = @{}
  foreach ($l in $subLemmas) { foreach ($d in $l.deps) { $depended[$d] = $true } }
  $roots = @()
  foreach ($l in $subLemmas) { if (-not $depended.ContainsKey($l.idx)) { $roots += $l.idx } }
  return $roots
}

Write-Host "`n=== subDagRoots (sub-DAG conclusions) ==="
# sub: S1,S2 leaves + S3[deps S1,S2] -> root is S3
$sub = @( (L 1 @()), (L 2 @()), (L 3 @(1,2)) )
$roots = SubDagRoots $sub
Check "single root = L3" ($roots -join ",") "3"
# two independent conclusions S2,S3 both roots
$sub2 = @( (L 1 @()), (L 2 @(1)), (L 3 @(1)) )
$roots2 = SubDagRoots $sub2
Check "two roots = L2,L3" ($roots2 -join ",") "2,3"

# ---- mirror of mergeSubDAG index logic -------------------------------------
# parentDag lemmas + targetIdx + subDag lemmas -> merged lemma set.
# Returns @{ lemmas=...; offset=...; expandedDeps=...; expandedIsLeaf=... }
function MergeSubDAG($parent, $targetIdx, $sub) {
  $offset = ($parent | ForEach-Object { $_.idx } | Measure-Object -Maximum).Maximum
  $rootsRemap = @()
  foreach ($r in (SubDagRoots $sub)) { $rootsRemap += ($r + $offset) }
  $remapped = @()
  foreach ($l in $sub) {
    $remapped += @{ idx = ($l.idx + $offset); deps = @($l.deps | ForEach-Object { $_ + $offset }); is_leaf = (@($l.deps).Count -eq 0) }
  }
  $mergedParent = @()
  $expandedDeps = $null; $expandedIsLeaf = $null
  foreach ($l in $parent) {
    if ($l.idx -eq $targetIdx) {
      $union = @($l.deps) + $rootsRemap | Select-Object -Unique
      $expandedDeps = @($union)
      $expandedIsLeaf = $false
      $mergedParent += @{ idx = $l.idx; deps = $expandedDeps; is_leaf = $false }
    } else {
      $mergedParent += $l
    }
  }
  $all = $mergedParent + $remapped
  return @{ lemmas = $all; offset = $offset; expandedDeps = $expandedDeps; expandedIsLeaf = $expandedIsLeaf }
}

Write-Host "`n=== mergeSubDAG (graft sub under L1 of a flat plan) ==="
$parent = @( (L 1 @()), (L 2 @()), (L 3 @(1,2)) )   # expand L1 (a leaf)
$subPlan = @( (L 1 @()), (L 2 @()), (L 3 @(1,2)) )  # S-target proven by S1,S2 -> S3
$m = MergeSubDAG $parent 1 $subPlan
Check "offset = max parent idx (3)"     $m.offset 3
Check "merged lemma count = 3 + 3 = 6"  (@($m.lemmas).Count) 6
Check "expanded L1 no longer a leaf"    $m.expandedIsLeaf $false
Check "expanded L1 deps = sub-root (L6)" ($m.expandedDeps -join ",") "6"
# sub indices remapped to 4,5,6 and exist
$ids = @($m.lemmas | ForEach-Object { $_.idx } | Sort-Object)
Check "merged ids = 1..6" ($ids -join ",") "1,2,3,4,5,6"
# merged depth increased: L3->L1->L6->L4 = 4
Check "merged depth = 4" (DagDepth $m.lemmas) 4

Write-Host "`n=== mergeSubDAG: union never drops existing parent deps ==="
$parent2 = @( (L 1 @()), (L 2 @()), (L 3 @(1,2)) )  # expand L3 (a parent w/ deps 1,2)
$m2 = MergeSubDAG $parent2 3 $subPlan
# L3 keeps 1,2 and gains the sub-root (3+3=6)
Check "L3 deps union keeps 1,2 + adds 6" (($m2.expandedDeps | Sort-Object) -join ",") "1,2,6"

# ---- mirror of EXPAND_RE + detect ordering ---------------------------------
$APPROVE = [regex]'(?i)\bapprove\b[^?.!]{0,40}\b(?:decomposition|attack(?:\s+plan)?|plan|lemma[- ]?dag|proposal)\b[^?.!#\d]{0,12}#?\s*(\d+)'
$EXPAND  = [regex]'(?i)\b(?:expand|go\s+deeper(?:\s+on)?|further\s+decompose|sub-?decompose|decompose|break\s+(?:down|up))\b[^?.!]*?\bL(\d+)\b'
$VERIFY  = [regex]'(?i)\b(?:verify\s+(?:now|lea(?:f|ves?)|it|them)|check\s+lea(?:f|ves?)|recheck|re-?verify)\b'
$HASLINE = [regex]'(?im)^\s*L\d+\s*:'
$PROP_V  = "(?i)(?:propose|draft|suggest|sketch|outline|plan|decompose|break\s+(?:down|up))"
$PROP_O  = "(?i)(?:decomposition|attack(?:\s+plan)?|lemma[- ]?dag|sub-?lemmas|proof\s+(?:plan|sketch|strategy|outline|attack)|into\s+(?:sub-?)?lemmas)"

function DetectMode($s) {
  if ($APPROVE.IsMatch($s)) { return "approve" }
  if ($EXPAND.IsMatch($s))  { return "expand" }
  if ($VERIFY.IsMatch($s))  { return "verify_now" }
  if ($HASLINE.IsMatch($s)) { return "null" }
  if ($s -match $PROP_V -and $s -match $PROP_O) { return "propose" }
  return "null"
}
function ExpandLemma($s) { $m = $EXPAND.Match($s); if ($m.Success) { return [int]$m.Groups[1].Value } return -1 }

Write-Host "`n=== EXPAND detection ==="
Check "expand L3"                 (DetectMode "expand L3")                  "expand"
Check "expand L3 of #5"           (DetectMode "expand L3 of #5")            "expand"
Check "go deeper on L2"           (DetectMode "go deeper on L2")            "expand"
Check "decompose L4 of #2"        (DetectMode "decompose lemma L4 of #2")   "expand"
Check "further decompose L1"      (DetectMode "further decompose L1")       "expand"
Check "sub-decompose L2"          (DetectMode "sub-decompose L2")           "expand"
Check "expand lemma idx = 3"      (ExpandLemma "expand L3 of #5")           3
Check "go deeper lemma idx = 2"   (ExpandLemma "go deeper on L2")           2

Write-Host "`n=== EXPAND must NOT hijack / must yield to APPROVE ==="
Check "approve still wins"        (DetectMode "approve decomposition #3")   "approve"
# a fresh propose ask (no L<n>) is NOT an expand
Check "propose for target"        (DetectMode "propose a decomposition for: Collatz") "propose"
Check "bare break it down"        (DetectMode "break it down for me")       "null"
Check "fleet earnings"            (DetectMode "run the fleet earnings")     "null"
# a pasted L<n>: scaffold block is NOT an expand (no expand verb anyway)
Check "pasted scaffold"           (DetectMode "L1: base case`nL2: step")    "null"

# ---- source sanity (lib/decomp-proposer.js) --------------------------------
Write-Host "`n=== source sanity (lib/decomp-proposer.js) ==="
$src = Get-Content "$PSScriptRoot\..\lib\decomp-proposer.js" -Raw
Check "exports mergeSubDAG"        ($src.Contains("mergeSubDAG")) $true
Check "exports dagDepth"           ($src.Contains("dagDepth")) $true
Check "exports subDagRoots"        ($src.Contains("subDagRoots")) $true
Check "has MAX_DECOMP_DEPTH"       ($src.Contains("MAX_DECOMP_DEPTH")) $true
Check "reads depth env"            ($src.Contains("M8_MAX_DECOMP_DEPTH")) $true
Check "EXPAND_RE defined"          ($src.Contains("EXPAND_RE")) $true
Check "expand mode in detect"      ($src.Contains('mode: "expand"')) $true
Check "expandProposal handler"     ($src.Contains("async function expandProposal")) $true
Check "wired in buildDecomp ctx"   ($src.Contains('det.mode === "expand"')) $true
Check "updateProposalDag staging"  ($src.Contains("updateProposalDag")) $true

# ---- summary ---------------------------------------------------------------
Write-Host "`n=== SUMMARY: $pass passed, $fail failed ==="
if ($fail -gt 0) { exit 1 } else { exit 0 }
