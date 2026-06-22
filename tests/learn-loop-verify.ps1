# tests/learn-loop-verify.ps1
# Build-112 -- Close the learn->generate loop (Track-B keystone) -- offline, PS 5.1 ASCII.
#
# Node is NOT installed on this host, so per the repo convention the behavioral checks
# are PS-5.1 ports of the pure gate logic, each BOUND to the JS source by a pattern
# assertion so a port can't silently drift from the implementation.
#
# WHAT THIS BUILD CLOSES: the nightly observe phase used to call PLAIN runConjectureGen,
# which IGNORED m8_conjecture_outcomes -- it recorded outcomes but never LEARNED from
# them. Now runObservePhase routes through runConjectureGenWithFeedback, which READS the
# recorded outcomes and steers the PREFER block through Grok's N-verifs gate (a structural
# technique earns learning weight only after >= M8_LEARN_MIN_VERIFS distinct verified
# outcomes -- absorbs Lean flip-flop). gen_version is stamped into the existing
# m8_loop_runs.metadata JSONB (NO schema change).
#
# The five spec checks (the X/5 headline):
#   1. countTagVerifications -> distinct-row counts per tag (case-folded, intra-row dedup)
#   2. earnedTags(min=3) -> only tags with >= 3 verified rows
#   3. gateByVerifCount(min=3) -> keeps rows with an earned tag, drops the rest
#   4. flip-flop absorption: the live 2-row shape (all counts=1) -> gate returns [] (PREFER silent)
#   5. learnMinVerifs -> env M8_LEARN_MIN_VERIFS (>=1) else default 3
# Plus source/wiring checks for conjecture-memory.js, conjecture-gen.js, loop.js.

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

$cm = [IO.File]::ReadAllText($cmPath, [Text.Encoding]::UTF8)
$cg = [IO.File]::ReadAllText($cgPath, [Text.Encoding]::UTF8)
$lp = [IO.File]::ReadAllText($lpPath, [Text.Encoding]::UTF8)

Write-Host "Build-112 learn->generate loop verify`n"

# ============================================================================
# PS PORTS (faithful mirrors of the JS pure gate logic in conjecture-memory.js)
# ============================================================================

# countTagVerifications: Map tag(lowercased) -> # distinct rows carrying it; a row
# contributes at most 1 to each of its own tags (intra-row duplicates collapse).
function CountTags($patterns) {
  $counts = @{}
  foreach ($p in @($patterns)) {
    $seen = @{}
    foreach ($raw in @($p.structural_tags)) {
      $tag = ([string]$raw).Trim().ToLower()
      if ($tag -eq "" -or $seen.ContainsKey($tag)) { continue }
      $seen[$tag] = $true
      if ($counts.ContainsKey($tag)) { $counts[$tag] = $counts[$tag] + 1 } else { $counts[$tag] = 1 }
    }
  }
  return $counts
}

# earnedTags: the set of tags with count >= minVerifs (clamped to >= 1).
function EarnedTags($patterns, [int]$minVerifs) {
  $min = $minVerifs; if ($min -lt 1) { $min = 1 }
  $counts = CountTags $patterns
  $out = @{}
  foreach ($k in $counts.Keys) { if ($counts[$k] -ge $min) { $out[$k] = $true } }
  return $out
}

# gateByVerifCount: keep only rows carrying >= 1 earned tag; [] when nothing earned.
function GateByVerif($patterns, [int]$minVerifs) {
  $earned = EarnedTags $patterns $minVerifs
  if ($earned.Count -eq 0) { return @() }
  $kept = New-Object System.Collections.Generic.List[object]
  foreach ($p in @($patterns)) {
    $hit = $false
    foreach ($raw in @($p.structural_tags)) {
      if ($earned.ContainsKey(([string]$raw).Trim().ToLower())) { $hit = $true; break }
    }
    if ($hit) { [void]$kept.Add($p) }
  }
  return $kept.ToArray()   # NOTE: no leading comma -- @() at the call site collects; a
}                          # comma here would jag the array into a single element (PS gotcha)

# learnMinVerifs: env M8_LEARN_MIN_VERIFS (>=1) else default 3.
function LearnMin($envVal) {
  $n = 0
  $ok = [int]::TryParse([string]$envVal, [ref]$n)
  if ($ok -and $n -ge 1) { return $n }
  return 3
}

function Row($tags) { return [pscustomobject]@{ structural_tags = $tags; conjecture_text = "c"; lean_proof_sketch = "proof"; verified_at = "2026-06-22" } }

# ============================================================================
# 1. countTagVerifications -- distinct-row counts, case-fold, intra-row dedup
# ============================================================================
Write-Host "-- 1. countTagVerifications --"
$rows = @(
  (Row @("induction","sum")),
  (Row @("induction","parity")),
  (Row @("induction")),
  (Row @("Induction")),        # capital -> folds to induction
  (Row @("sum","sum"))         # intra-row dup -> counts once
)
$c = CountTags $rows
Assert-Core 'counts: induction=4, sum=2, parity=1 (distinct rows, case-folded, deduped)' `
  (($c["induction"] -eq 4) -and ($c["sum"] -eq 2) -and ($c["parity"] -eq 1))

# ============================================================================
# 2. earnedTags(min=3) -- only induction crosses the gate
# ============================================================================
Write-Host "`n-- 2. earnedTags --"
$e = EarnedTags $rows 3
Assert-Core 'earned(min=3) = {induction} only' `
  (($e.ContainsKey("induction")) -and (-not $e.ContainsKey("sum")) -and (-not $e.ContainsKey("parity")))

# ============================================================================
# 3. gateByVerifCount(min=3) -- keeps the 4 induction rows, drops the sum-only row
# ============================================================================
Write-Host "`n-- 3. gateByVerifCount --"
$g = @(GateByVerif $rows 3)
$sumOnlyKept = $false
foreach ($p in $g) { if ((@($p.structural_tags) -join ",") -eq "sum,sum") { $sumOnlyKept = $true } }
Assert-Core 'gate(min=3) keeps 4 rows (induction), drops sum-only row' `
  (($g.Count -eq 4) -and (-not $sumOnlyKept))

# ============================================================================
# 4. flip-flop absorption -- the LIVE 2-row shape (all tag counts = 1) -> []
#    (matches Build-111's live rows: [induction,sum] + [definition,...]; nothing has
#     verified 3x yet, so the PREFER block must stay SILENT)
# ============================================================================
Write-Host "`n-- 4. flip-flop absorption (live 2-row shape) --"
$live = @( (Row @("induction","sum")), (Row @("definition","parity")) )
$gLive = @(GateByVerif $live 3)
Assert-Core 'live 2-row shape -> gate returns [] (single flaky verify cannot steer)' ($gLive.Count -eq 0)

# ============================================================================
# 5. learnMinVerifs -- env override (>=1) else default 3
# ============================================================================
Write-Host "`n-- 5. learnMinVerifs --"
Assert-Core 'learnMinVerifs: unset/invalid/<1 -> 3 ; valid -> env' `
  ((LearnMin $null) -eq 3 -and (LearnMin "") -eq 3 -and (LearnMin "0") -eq 3 -and (LearnMin "abc") -eq 3 -and (LearnMin "5") -eq 5 -and (LearnMin "1") -eq 1)

# ============================================================================
# SOURCE BINDING -- conjecture-memory.js (the gate lives here)
# ============================================================================
Write-Host "`n-- conjecture-memory.js source --"
Assert-True 'exports learnMinVerifs'               ($cm -match "learnMinVerifs")
Assert-True 'exports countTagVerifications'        ($cm -match "countTagVerifications")
Assert-True 'exports earnedTags'                   ($cm -match "earnedTags")
Assert-True 'exports gateByVerifCount'             ($cm -match "gateByVerifCount")
Assert-True 'exports getEarnedSuccessPatterns'     ($cm -match "getEarnedSuccessPatterns")
Assert-True 'LEARN_MIN_VERIFS_DEFAULT = 3'         ($cm -match "LEARN_MIN_VERIFS_DEFAULT = 3")
Assert-True 'reads env M8_LEARN_MIN_VERIFS'        ($cm -match "M8_LEARN_MIN_VERIFS")
Assert-True 'EARN_WINDOW constant present'         ($cm -match "EARN_WINDOW")
Assert-True 'learnMinVerifs clamps >= 1'           ($cm -match "n >= 1 \? n : LEARN_MIN_VERIFS_DEFAULT")
$ctvSeg = ($cm -split "function countTagVerifications")[1]
Assert-True 'countTagVerifications lowercases tags' ($ctvSeg -match "toLowerCase\(\)")
Assert-True 'countTagVerifications dedups per row (seen Set)' ($ctvSeg -match "seen")
$etSeg = ($cm -split "function earnedTags")[1]
Assert-True 'earnedTags compares count >= min'     ($etSeg -match "c >= min")
$gbvSeg = ($cm -split "function gateByVerifCount")[1]
Assert-True 'gateByVerifCount returns [] when nothing earned' ($gbvSeg -match "if \(!earned\.size\) return \[\]")
$geSeg = ($cm -split "async function getEarnedSuccessPatterns")[1]
Assert-True 'getEarnedSuccessPatterns has catch'   ($geSeg -match "catch")
Assert-True 'getEarnedSuccessPatterns returns [] on error' ($geSeg -match "return \[\]")
Assert-True 'getEarnedSuccessPatterns filters problem_id' ($geSeg -match 'eq\("problem_id"')
Assert-True 'getEarnedSuccessPatterns orders verified_at desc' ($geSeg -match 'order\("verified_at", \{ ascending: false \}\)')
Assert-True 'getEarnedSuccessPatterns uses wide EARN_WINDOW' ($geSeg -match "limit\(EARN_WINDOW\)")
Assert-True 'getEarnedSuccessPatterns drops failed rows' ($geSeg -match "isFailedOutcome")
Assert-True 'getEarnedSuccessPatterns applies the gate'  ($geSeg -match "gateByVerifCount")
Assert-True 'getEarnedSuccessPatterns caps at PATTERN_LIMIT' ($geSeg -match "slice\(0, PATTERN_LIMIT\)")
Assert-True 'HONESTY: gate STEERS only, mints no theorem' ($cm -match "mints no theorem")

# ============================================================================
# SOURCE BINDING -- conjecture-gen.js (PREFER now steers on the GATED set)
# ============================================================================
Write-Host "`n-- conjecture-gen.js wiring --"
$cgWrap = ($cg -split "async function runConjectureGenWithFeedback")[1]
Assert-True 'wrapper calls getEarnedSuccessPatterns' ($cgWrap -match "getEarnedSuccessPatterns")
Assert-True 'PREFER block built from earnedPatterns'  ($cgWrap -match "buildFeedbackBlock\(earnedPatterns\)")
Assert-True 'wrapper returns earnedPatterns'          ($cgWrap -match "earnedPatterns")
Assert-True 'B92 preserved: still calls getSuccessPatterns' ($cgWrap -match "getSuccessPatterns")
Assert-True 'B99 preserved: still calls getFailedApproaches' ($cgWrap -match "getFailedApproaches")
Assert-True 'B92 preserved: result.packet = block prepend' ($cgWrap -match "result\.packet = block")
Assert-True 'early-return path carries earnedPatterns' ($cg -match "successPatterns: \[\], failedPatterns: \[\], earnedPatterns: \[\]")

# ============================================================================
# SOURCE BINDING -- loop.js observe phase (routed + stamped; verify phase UNTOUCHED)
# ============================================================================
Write-Host "`n-- loop.js observe-phase wiring --"
Assert-True 'imports runConjectureGenWithFeedback'  ($lp -match "runConjectureGenWithFeedback")
$obsSeg = ($lp -split "async function runObservePhase")[1]
$obsSeg = ($obsSeg -split "async function runVerifyPhase")[0]   # observe phase ONLY
Assert-True 'observe awaits runConjectureGenWithFeedback' ($obsSeg -match "await runConjectureGenWithFeedback")
Assert-True 'observe no longer calls plain runConjectureGen' (-not ($obsSeg -match "= runConjectureGen\("))
Assert-True 'stamps gen_version into metadata JSONB (NO schema change)' ($obsSeg -match "row\.metadata\.gen_version = m3\.genVersion")
Assert-True 'stamps learn telemetry (earned_patterns)' ($obsSeg -match "earned_patterns:")
Assert-True 'learn min_verifs uses learnMinVerifs'  ($obsSeg -match "learnMinVerifs\(\)")
Assert-True 'observe still NO LLM (comment intact)'  ($obsSeg -match "NO LLM")

# guard: the verify phase (Build-B / 110 / 111) is UNTOUCHED by this build
Write-Host "`n-- loop.js verify-phase guard (must stay intact) --"
Assert-True 'Build-111 reconcileOutcomes still wired' ($lp -match "reconcileOutcomes\(")
Assert-True 'Build-110 verify-phase recordOutcome still awaited' ($lp -match "await[^\r\n]*recordOutcome")
Assert-True 'Build-B repair lane still present'      ($lp -match "fetchRepairableScaffold")

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host ""
$coreColor = 'Red'; if ($script:core -eq 5) { $coreColor = 'Green' }
Write-Host ("{0}/5 core passed" -f $script:core) -ForegroundColor $coreColor
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "ALL $total checks PASS -- Build-112 verified (5/5 core + $($total - 5) wiring)." -ForegroundColor Green
} else {
  Write-Host "$($script:pass)/$total checks passed, $($script:fail) FAILED." -ForegroundColor Red
  exit 1
}
