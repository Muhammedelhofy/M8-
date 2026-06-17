# Build-57 -- AUTO-FEEDBACK Verify
# PS mirror of suggestExpand flag (dischargeLeaf) + stuck-leaves rendering
# (renderScaffoldPacket). Pure ASCII. Run from anywhere; no Node, no network.
# Usage: powershell -ExecutionPolicy Bypass -File build57-autofeedback-verify.ps1

$pass = 0; $fail = 0
function Check($label, $got, $want) {
  if ($got -eq $want) { $script:pass++; Write-Host "  PASS $label" }
  else { $script:fail++; Write-Host "  FAIL $label  got='$got'  want='$want'" }
}
function CheckTrue($label, $got)  { Check $label $got $true }
function CheckFalse($label, $got) { Check $label $got $false }

# ---- mirror of suggestExpand logic in dischargeLeaf -------------------------
function SuggestExpand($leanStatus) { return $leanStatus -eq "lean_rejected" }

Write-Host "`n=== suggestExpand flag ==="
CheckTrue  "lean_rejected -> suggest expand"      (SuggestExpand "lean_rejected")
CheckFalse "lean_verified -> no suggest"          (SuggestExpand "lean_verified")
CheckFalse "lean_stated   -> no suggest"          (SuggestExpand "lean_stated")
CheckFalse "lean_pending  -> no suggest"          (SuggestExpand "lean_pending")
CheckFalse "lean_error    -> no suggest"          (SuggestExpand "lean_error")
CheckFalse "lean_unformalizable -> no suggest"    (SuggestExpand "lean_unformalizable")
CheckFalse "scaffolded (parent) -> no suggest"    (SuggestExpand "scaffolded")

# ---- mirror of renderScaffoldPacket stuck-leaves block ----------------------
function RenderStuckLeaves($lemmas) {
  $stuck = $lemmas | Where-Object { $_.suggestExpand -eq $true }
  if (-not $stuck) { return "" }
  $lines = @("", "STUCK LEAVES -- rejected even after repairs. Try going deeper:")
  foreach ($sl in $stuck) {
    $prose = $sl.prose
    if ($prose.Length -gt 70) { $prose = $prose.Substring(0, 70).TrimEnd() + "..." }
    $lines += "  expand $($sl.name)  -- sub-decomposes `"$prose`" into sub-lemmas"
  }
  return $lines -join "`n"
}

Write-Host "`n=== stuck-leaves render ==="
# no stuck leaves -> empty
$allGood = @(
  @{ name = "L1"; lean_status = "lean_verified"; suggestExpand = $false; prose = "base case" },
  @{ name = "L2"; lean_status = "lean_verified"; suggestExpand = $false; prose = "inductive step" }
)
Check "no stuck leaves -> empty" (RenderStuckLeaves $allGood) ""

# one stuck leaf renders the block
$oneStuck = @(
  @{ name = "L1"; lean_status = "lean_verified"; suggestExpand = $false; prose = "base case" },
  @{ name = "L2"; lean_status = "lean_rejected"; suggestExpand = $true;  prose = "the product of two odd integers is odd" }
)
$r1 = RenderStuckLeaves $oneStuck
CheckTrue  "one stuck leaf: block present"        ($r1.Contains("STUCK LEAVES"))
CheckTrue  "one stuck leaf: L2 named"             ($r1.Contains("expand L2"))
CheckFalse "verified leaf NOT in block"           ($r1.Contains("expand L1"))

# long prose truncated at 70 chars
$longProse = "A" * 80
$longStuck = @( @{ name = "L3"; lean_status = "lean_rejected"; suggestExpand = $true; prose = $longProse } )
$r2 = RenderStuckLeaves $longStuck
CheckTrue  "long prose truncated with ellipsis"   ($r2.Contains("..."))
CheckFalse "long prose not over-long"             ($r2.Contains("A" * 71))

# two stuck leaves both appear
$twoStuck = @(
  @{ name = "L1"; lean_status = "lean_rejected"; suggestExpand = $true; prose = "lemma alpha" },
  @{ name = "L2"; lean_status = "lean_rejected"; suggestExpand = $true; prose = "lemma beta" }
)
$r3 = RenderStuckLeaves $twoStuck
CheckTrue  "two stuck: L1 listed"                 ($r3.Contains("expand L1"))
CheckTrue  "two stuck: L2 listed"                 ($r3.Contains("expand L2"))

# ---- source sanity (lib/lemma-dag.js) ---------------------------------------
Write-Host "`n=== source sanity (lib/lemma-dag.js) ==="
$src = Get-Content "$PSScriptRoot\..\lib\lemma-dag.js" -Raw
Check "suggestExpand in dischargeLeaf return"     ($src.Contains("suggestExpand: result.kind")) $true
Check "suggestExpand propagated in scaffoldProof" ($src.Contains("lemma.suggestExpand"))        $true
Check "STUCK LEAVES block in renderScaffoldPacket"($src.Contains("STUCK LEAVES"))               $true
Check "stuckLeaves filter in render"              ($src.Contains("stuckLeaves"))                $true
Check "MAX_LEAF_REPAIRS still present"            ($src.Contains("MAX_LEAF_REPAIRS"))           $true
Check "shouldRetryLeaf still present"             ($src.Contains("shouldRetryLeaf"))            $true

# ---- summary ----------------------------------------------------------------
Write-Host "`n=== SUMMARY: $pass passed, $fail failed ==="
if ($fail -gt 0) { exit 1 } else { exit 0 }
