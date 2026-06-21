# tests/B99-proposer-feedback-verify.ps1
# Build-99 -- M4 Outcome-Biased Conjecture Proposer (avoid failed approaches, prefer
# verified patterns) -- offline, PS 5.1, pure ASCII.
#
# Node is NOT installed on this host, so per repo convention the behavioral checks are
# PS-5.1 ports of the pure/contract logic, each BOUND to the JS source by a pattern
# assertion so a port can't silently drift from the implementation.
#
# Core spec checks (the X/N headline):
#   1. buildAvoidBlock([]) -> ""
#   2. buildAvoidBlock([{structural_tags:[algebraic,direct-construction]}]) ->
#        contains AVOID header, [algebraic], [direct-construction],
#        STRUCTURALLY DIFFERENT, and VERIFIED APPROACHES
#   3. buildAvoidBlock dedupes a tag shared across two failed rows (appears once)
#   4. isFailedOutcome: null sketch -> true; sketch with 'sorry' -> true;
#        a real verified sketch -> false
#   5. buildFeedbackBlock([]) -> "" AND buildFeedbackBlock([one]) -> has tag + DIFFERENT
#   6. success/failed SPLIT: a mixed row set partitions correctly by isFailedOutcome
# Plus source/wiring checks for conjecture-memory.js, conjecture-gen.js, loop.js,
# and lemma-dag.js.

$ErrorActionPreference = 'Stop'
$script:core = 0
$script:pass = 0
$script:fail = 0

function Assert-Core {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  [core] " + $label) -ForegroundColor Green; $script:core++; $script:pass++ }
  else        { Write-Host ("  FAIL  [core] " + $label) -ForegroundColor Red;   $script:fail++ }
}
function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$cmPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\conjecture-memory.js"))
$cgPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\conjecture-gen.js"))
$lpPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\loop.js"))
$ldPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\lemma-dag.js"))

$cm = [IO.File]::ReadAllText($cmPath, [Text.Encoding]::UTF8)
$cg = [IO.File]::ReadAllText($cgPath, [Text.Encoding]::UTF8)
$lp = [IO.File]::ReadAllText($lpPath, [Text.Encoding]::UTF8)
$ld = [IO.File]::ReadAllText($ldPath, [Text.Encoding]::UTF8)

Write-Host "Build-99 outcome-biased proposer verify`n"

# ============================================================================
# PS PORTS (faithful mirrors of the JS contract logic)
# ============================================================================

# Mirror of buildAvoidBlock (lib/conjecture-memory.js). Unions structural_tags across
# failed rows (deduped case-insensitively, first-seen order); empty / tagless -> "".
function AvoidBlock($failed) {
  if ($null -eq $failed -or @($failed).Count -eq 0) { return "" }
  $tags = New-Object System.Collections.Generic.List[string]
  $seen = New-Object System.Collections.Generic.HashSet[string]
  foreach ($p in @($failed)) {
    $st = $p.structural_tags
    if ($st) {
      foreach ($raw in @($st)) {
        $tag = ([string]$raw).Trim()
        $key = $tag.ToLower()
        if ($tag -ne "" -and (-not $seen.Contains($key))) {
          [void]$seen.Add($key)
          [void]$tags.Add($tag)
        }
      }
    }
  }
  if ($tags.Count -eq 0) { return "" }
  $bracketed = (@($tags | ForEach-Object { "[$_]" }) -join ", ")
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add("AVOID THESE STRUCTURAL APPROACHES (already tried, Lean returned sorry):")
  [void]$lines.Add($bracketed)
  [void]$lines.Add("Generate a conjecture that is STRUCTURALLY DIFFERENT from the AVOID list above. Prefer approaches similar to VERIFIED APPROACHES if any exist.")
  return ($lines -join "`n")
}

# Mirror of isFailedOutcome (lib/conjecture-memory.js): null/blank sketch OR a sketch
# that still carries 'sorry' counts as a failed approach.
function IsFailed($row) {
  $s = $row.lean_proof_sketch
  if ($null -eq $s) { return $true }
  $str = ([string]$s).Trim()
  if ($str -eq "") { return $true }
  return ($str -imatch '\bsorry\b')
}

# Mirror of buildFeedbackBlock (lib/conjecture-memory.js, ASCII approximation).
function FbBlock($patterns) {
  if ($null -eq $patterns -or @($patterns).Count -eq 0) { return "" }
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add("VERIFIED CONJECTURE PATTERNS -- what has worked before for this problem:")
  foreach ($p in @($patterns)) {
    $tags = ""
    $st = $p.structural_tags
    if ($st -and @($st).Count -gt 0) { $tags = "[" + (@($st) -join ", ") + "] " }
    $text = (([string]$p.conjecture_text) -replace '\s+', ' ').Trim()
    [void]$lines.Add("* $tags`"$text`"")
  }
  [void]$lines.Add("Propose structurally DIFFERENT conjectures. Do NOT re-propose variations of these.")
  return ($lines -join "`n")
}

# ============================================================================
# 1-3. buildAvoidBlock behavior
# ============================================================================
Write-Host "-- 1-3. buildAvoidBlock --"
$emptyAvoid = AvoidBlock @()
Assert-Core 'buildAvoidBlock([]) returns ""' ($emptyAvoid -eq "")

$failedOne = @([pscustomobject]@{
  conjecture_text   = "every odd n has nu2(3n+1) >= 1"
  structural_tags   = @("algebraic", "direct-construction")
  lean_proof_sketch = "theorem t : True := by sorry"
})
$avoid = AvoidBlock $failedOne
Assert-Core 'buildAvoidBlock([one]) has AVOID header + both tags + DIFFERENT + VERIFIED APPROACHES' (
  ($avoid -match "AVOID THESE STRUCTURAL APPROACHES") -and
  ($avoid -match "\[algebraic\]") -and
  ($avoid -match "\[direct-construction\]") -and
  ($avoid -cmatch "STRUCTURALLY DIFFERENT") -and
  ($avoid -match "VERIFIED APPROACHES")
)

$failedTwo = @(
  [pscustomobject]@{ structural_tags = @("algebraic", "induction") },
  [pscustomobject]@{ structural_tags = @("algebraic", "casework") }
)
$avoid2 = AvoidBlock $failedTwo
$algCount = ([regex]::Matches($avoid2, '\[algebraic\]')).Count
Assert-Core 'buildAvoidBlock dedupes a shared tag (algebraic appears once across two rows)' (
  ($algCount -eq 1) -and ($avoid2 -match "\[induction\]") -and ($avoid2 -match "\[casework\]")
)

# tagless failures -> "" (nothing concrete to avoid)
$avoidTagless = AvoidBlock @([pscustomobject]@{ structural_tags = $null })
Assert-True 'buildAvoidBlock(failures with no tags) -> ""' ($avoidTagless -eq "")

# ============================================================================
# 4. isFailedOutcome classification
# ============================================================================
Write-Host "`n-- 4. isFailedOutcome --"
$nullSketch  = [pscustomobject]@{ lean_proof_sketch = $null }
$sorrySketch = [pscustomobject]@{ lean_proof_sketch = "theorem foo : 1 = 1 := by sorry" }
$goodSketch  = [pscustomobject]@{ lean_proof_sketch = "theorem foo : 1 = 1 := by rfl" }
Assert-Core 'isFailedOutcome: null=true, sorry=true, verified=false' (
  (IsFailed $nullSketch) -and (IsFailed $sorrySketch) -and (-not (IsFailed $goodSketch))
)

# ============================================================================
# 5. buildFeedbackBlock behavior (mirror)
# ============================================================================
Write-Host "`n-- 5. buildFeedbackBlock --"
$fbEmpty = FbBlock @()
$fbOne = FbBlock @([pscustomobject]@{
  conjecture_text = "sigma(n) <= 100 for all n <= 100000"
  structural_tags = @("induction")
})
Assert-Core 'buildFeedbackBlock([]) -> "" AND ([one]) has "induction" + "DIFFERENT"' (
  ($fbEmpty -eq "") -and ($fbOne -match "induction") -and ($fbOne -cmatch "DIFFERENT")
)

# ============================================================================
# 6. success / failed SPLIT over one mixed table (isFailedOutcome partition)
# ============================================================================
Write-Host "`n-- 6. success/failed split --"
$rows = @(
  [pscustomobject]@{ lean_proof_sketch = "by rfl";         structural_tags = @("parity") },     # success
  [pscustomobject]@{ lean_proof_sketch = "by sorry";       structural_tags = @("algebraic") },  # failed
  [pscustomobject]@{ lean_proof_sketch = $null;            structural_tags = @("blind") },      # failed
  [pscustomobject]@{ lean_proof_sketch = "by simp";        structural_tags = @("casework") }    # success
)
$successRows = @($rows | Where-Object { -not (IsFailed $_) })
$failedRows  = @($rows | Where-Object {       IsFailed $_  })
Assert-Core 'split: 2 success (no sorry) + 2 failed (sorry/null) from a mixed set' (
  ($successRows.Count -eq 2) -and ($failedRows.Count -eq 2)
)
# and the avoid block built from the failed half names their techniques, not the others
$avoidSplit = AvoidBlock $failedRows
Assert-True 'avoid block from failed half names failed techniques only' (
  ($avoidSplit -match "\[algebraic\]") -and ($avoidSplit -match "\[blind\]") -and
  ($avoidSplit -notmatch "\[parity\]") -and ($avoidSplit -notmatch "\[casework\]")
)

# ============================================================================
# SOURCE BINDING -- conjecture-memory.js (new exports + prompt text)
# ============================================================================
Write-Host "`n-- conjecture-memory.js source --"
Assert-True 'exports buildAvoidBlock'              ($cm -match "buildAvoidBlock")
Assert-True 'exports getFailedApproaches'          ($cm -match "getFailedApproaches")
Assert-True 'exports isFailedOutcome'              ($cm -match "isFailedOutcome")
Assert-True 'AVOID header text present'            ($cm -match "AVOID THESE STRUCTURAL APPROACHES")
Assert-True 'prompt references VERIFIED APPROACHES' ($cm -match "VERIFIED APPROACHES")
Assert-True 'prompt says STRUCTURALLY DIFFERENT'   ($cm -cmatch "STRUCTURALLY DIFFERENT")
Assert-True 'buildAvoidBlock empty -> return ""'   ($cm -match 'if \(!failedPatterns \|\| !failedPatterns\.length\) return "";')

$isfSeg = ($cm -split "function isFailedOutcome")[1]
Assert-True 'isFailedOutcome keys on sorry'        ($isfSeg -match "sorry")
Assert-True 'isFailedOutcome treats null as failed' ($isfSeg -match "return true")

$gfaSeg = ($cm -split "async function getFailedApproaches")[1]
Assert-True 'getFailedApproaches filters problem_id' ($gfaSeg -match 'eq\("problem_id"')
Assert-True 'getFailedApproaches uses isFailedOutcome' ($gfaSeg -match "isFailedOutcome")
Assert-True 'getFailedApproaches has catch'        ($gfaSeg -match "catch")
Assert-True 'getFailedApproaches returns [] on error' ($gfaSeg -match "return \[\]")

$gspSeg = ($cm -split "async function getSuccessPatterns")[1]
Assert-True 'getSuccessPatterns now excludes failed rows' ($gspSeg -match "isFailedOutcome")

# ============================================================================
# SOURCE BINDING -- conjecture-gen.js wires the AVOID block into the packet
# ============================================================================
Write-Host "`n-- conjecture-gen.js wiring --"
$cgWrap = ($cg -split "async function runConjectureGenWithFeedback")[1]
Assert-True 'wrapper calls getFailedApproaches'    ($cgWrap -match "getFailedApproaches")
Assert-True 'wrapper calls buildAvoidBlock'        ($cgWrap -match "buildAvoidBlock")
Assert-True 'wrapper guards on failedPatterns.length' ($cgWrap -match "failedPatterns\.length")
Assert-True 'wrapper injects avoidBlock into packet' ($cgWrap -match "avoidBlock")
Assert-True 'wrapper STILL prepends verified block (B92 preserved)' ($cgWrap -match "result\.packet = block")
Assert-True 'wrapper returns failedPatterns'       ($cgWrap -match "failedPatterns")

# ============================================================================
# SOURCE BINDING -- loop.js records the 'sorry' (failed) outcomes
# ============================================================================
Write-Host "`n-- loop.js wiring (record on sorry) --"
Assert-True 'loop reads m4.sorryLeaves'            ($lp -match "m4\.sorryLeaves")
$lpB99 = ($lp -split "Build-99")[1]
Assert-True 'sorry block calls recordOutcome'      ($lpB99 -match "recordOutcome\(")
Assert-True 'sorry block passes a sorry sketch'    ($lpB99 -match "leanProofSketch: sketch")
Assert-True 'sorry block uses COLLATZ_PROBLEM_ID'  ($lpB99 -match "COLLATZ_PROBLEM_ID")
Assert-True 'sorry block guards on /sorry/ token'  ($lpB99 -match "sorry")
Assert-True 'recordOutcome on sorry IS awaited (Build-110 durability)' ($lpB99 -match "await[^\r\n]*recordOutcome")

# ============================================================================
# SOURCE BINDING -- lemma-dag.js surfaces the sorry leaves to the loop
# ============================================================================
Write-Host "`n-- lemma-dag.js recheck (collect sorry leaves) --"
$rsSeg = ($ld -split "async function recheckScaffold")[1]
Assert-True 'recheck collects sorryLeaves'         ($rsSeg -match "sorryLeaves")
Assert-True 'recheck keys sorry on lean_stated'    ($rsSeg -match "lean_stated")
Assert-True 'recheck returns base.sorryLeaves'     ($rsSeg -match "base\.sorryLeaves")

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host ""
$coreColor = 'Red'; if ($script:core -eq 6) { $coreColor = 'Green' }
Write-Host ("{0}/6 core passed" -f $script:core) -ForegroundColor $coreColor
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "ALL $total checks PASS -- Build-99 verified (6/6 core + $($total - 6) wiring)." -ForegroundColor Green
} else {
  Write-Host "$($script:pass)/$total checks passed, $($script:fail) FAILED." -ForegroundColor Red
  exit 1
}
