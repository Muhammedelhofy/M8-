# tests/B116-survivor-steer-verify.ps1
# Build-116 -- Wire the FREE survivor signal into GENERATION steering -- offline, PS 5.1 ASCII.
#
# Node is NOT installed on this host, so per repo convention the behavioral checks are PS-5.1
# ports of the pure JS logic in lib/conjecture-gen.js, each BOUND to the JS source by a pattern
# assertion so a port can never silently drift from the implementation.
#
# WHAT THIS BUILD CLOSES: Build-114 READ the free survivor signal (getSurvivorTemplateStats:
# templates whose machine-generated conjectures SURVIVED falsification to high bounds) but only
# NARRATED it -- it changed NOTHING about what got generated. B116 wires it into GENERATION:
# the survivor leaderboard is already productivity-GATED (count >= M8_SURVIVOR_MIN_COUNT) and
# capped, so every template it returns is comparatively OVER-mined. We DOWN-WEIGHT those over-mined
# templates (GENTLE DIVERSIFY -- the SAME soft schedule mechanism B113 uses, occ>=1 never excluded)
# so the cohort favors UNDER-explored regions, UNIONED with B113's Lean down-weights and kept
# DISTINGUISHABLE in telemetry (profile.fromSurvivor). EMPTY survivor data => byte-identical cohort.
#
# HONESTY (preserved, asserted): a survivor is EMPIRICAL evidence "tested to N", NEVER proven.
# This STEERS generation only -- it never touches survival, the micro-prover, the vacuity floor,
# the Wilson/Newcombe GATE, baseline-matching, or truth. The matched baseline is rebuilt FROM the
# (now also survivor-biased) mined composition, so the gate still compares like-with-like.
#
# The 14 core checks (the X/14 headline):
#   1-3.  survivorOverMinedTemplates  -> leaderboard -> template keys (filters non-TEMPLATES; empty->[])
#   4-6.  mergeSurvivorDownWeight     -> union w/ Lean base, distinguishable fromSurvivor; empty fail-safe
#   7.    buildTemplateSchedule       -> empty == TEMPLATES (byte-identical v2)
#   8-11. ACCEPTANCE: empty vs MOCK over-mined leaderboard -> cohort composition DIFFERS (the
#         over-mined template draws FEWER); empty == balanced round-robin; union under-represents both.
#         (A no-op wire would make empty == mock -> IDENTICAL compositions -> these checks FAIL it.)
#   12-13 kill switches: M8_SURVIVOR_STEER_DISABLED (survivor only) / M8_GEN_STEER_DISABLED (master)
#   14.   fail-safe: empty survivor + unclassified -> empty down-weight -> v2-identical
# Plus source/wiring bindings for conjecture-gen.js + loop.js, and B113/B114/B112 invariants preserved.

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

$cgPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\conjecture-gen.js"))
$lpPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\loop.js"))
$cg = [IO.File]::ReadAllText($cgPath, [Text.Encoding]::UTF8)
$lp = [IO.File]::ReadAllText($lpPath, [Text.Encoding]::UTF8)

Write-Host "Build-116 survivor-signal generation steering (survivor->Generate wire) verify`n"

# ============================================================================
# PS PORTS (faithful mirrors of the pure JS in conjecture-gen.js)
# ============================================================================

# TEMPLATES order (ported verbatim) + the schedule base constant.
$TEMPLATES = @(
  "A_res_sigma_max","A_res_total_max","A_nu_total_max","A_total_log","A_peak_power",
  "A_cond_nu_peak","B_sigma_freq","B_res_total_gap","B_nu_geo","B_cond_peak_nu"
)
$GEN_SCHEDULE_BASE = 4

# survivorOverMinedTemplates: leaderboard rows {template,count,maxBound} -> the OVER-mined template
# keys, keeping ONLY real TEMPLATES ids (a legacy/unknown id cannot steer the schedule, so it is
# excluded -> telemetry == what ACTUALLY steered). Stable TEMPLATES order. -ccontains mirrors the
# JS exact-case FEATURES[tpl] membership (PS -contains is case-insensitive; this could otherwise drift).
function Survivor-OverMined($survivorTemplates) {
  $set = @{}
  foreach ($t in @($survivorTemplates)) {
    $tpl = ''
    if ($t -ne $null -and $t.template -ne $null) { $tpl = ([string]$t.template).Trim() }
    if ($tpl -and ($TEMPLATES -ccontains $tpl)) { $set[$tpl] = $true }
  }
  return @($TEMPLATES | Where-Object { $set.ContainsKey($_) })
}

# mergeSurvivorDownWeight: union a survivor-derived down-weight set INTO a base Lean profile,
# keeping the two provenances distinguishable. downWeight = UNION in TEMPLATES order; fromSurvivor
# = survivor-only contribution. Empty survivor -> downWeight == base.downWeight (cohort unchanged).
function Merge-SurvivorDownWeight($baseProfile, $survivorTemplates) {
  $baseDown = @(); if ($baseProfile -and $baseProfile.downWeight)   { $baseDown     = @($baseProfile.downWeight) }
  $fromVer  = @(); if ($baseProfile -and $baseProfile.fromVerified) { $fromVer      = @($baseProfile.fromVerified) }
  $fromFail = @(); if ($baseProfile -and $baseProfile.fromFailed)   { $fromFail     = @($baseProfile.fromFailed) }
  $fromSurvivor = @(Survivor-OverMined $survivorTemplates)
  $union = @{}
  foreach ($t in $baseDown)     { if ($t) { $union[[string]$t] = $true } }
  foreach ($t in $fromSurvivor) { if ($t) { $union[[string]$t] = $true } }
  return [pscustomobject]@{
    downWeight   = @($TEMPLATES | Where-Object { $union.ContainsKey($_) })
    fromVerified = $fromVer
    fromFailed   = $fromFail
    fromSurvivor = $fromSurvivor
  }
}

# Resolve-Profile: faithful mirror of the wrapper's kill-switch layering. Master M8_GEN_STEER_DISABLED
# empties BOTH the Lean profile AND the survivor steer; the granular M8_SURVIVOR_STEER_DISABLED empties
# ONLY the survivor steer. Then the survivor down-weights union INTO the (possibly emptied) Lean base.
function Resolve-Profile($leanBase, $survivorTemplates, [bool]$genSteerOff, [bool]$survSteerOff) {
  $emptyProfile = [pscustomobject]@{ downWeight = @(); fromVerified = @(); fromFailed = @() }
  $lean = $leanBase; if ($genSteerOff) { $lean = $emptyProfile }
  $survForSteer = $survivorTemplates; if ($genSteerOff -or $survSteerOff) { $survForSteer = @() }
  return (Merge-SurvivorDownWeight $lean $survForSteer)
}

# buildTemplateSchedule: empty down-weight -> TEMPLATES itself (byte-identical v2 round-robin);
# else round-interleaved (explored occ=1, unexplored occ=BASE), preserving TEMPLATES order.
function Build-Schedule($downWeight) {
  $dw = @{}; foreach ($t in @($downWeight)) { if ($t) { $dw[[string]$t] = $true } }
  if ($dw.Count -eq 0) { return $TEMPLATES }
  $sched = New-Object System.Collections.Generic.List[string]
  for ($round = 0; $round -lt $GEN_SCHEDULE_BASE; $round++) {
    foreach ($t in $TEMPLATES) {
      $occ = $GEN_SCHEDULE_BASE; if ($dw.ContainsKey($t)) { $occ = 1 }
      if ($round -lt $occ) { [void]$sched.Add($t) }
    }
  }
  return $sched.ToArray()
}

# Simulate-Cohort: faithful port of generateMinedCohort's CONTROL FLOW with a STUB makeCandidate
# that always yields a unique success (so active/fails/seen never trip). Isolates the ONLY steering
# lever -- which template each step draws from -- so the per-template composition is exactly what the
# real cohort's composition tracks. Returns template->count.
function Simulate-Cohort($schedule, [int]$count) {
  $sched = @($schedule); $len = $sched.Count
  $comp = @{}; foreach ($t in $TEMPLATES) { $comp[$t] = 0 }
  $ti = 0
  while ($ti -lt $count) {
    $t = $sched[$ti % $len]
    $comp[$t] = $comp[$t] + 1
    $ti++
  }
  return $comp
}
function Comp-Equal($a, $b) {
  foreach ($t in $TEMPLATES) { if ($a[$t] -ne $b[$t]) { return $false } }
  return $true
}

# ============================================================================
# 1-3. survivorOverMinedTemplates
# ============================================================================
Write-Host "-- 1-3. survivorOverMinedTemplates --"
$lb1 = @( [pscustomobject]@{ template = "A_res_sigma_max"; count = 7; maxBound = 200000 } )
$s1 = @(Survivor-OverMined $lb1)
Assert-Core 'one over-mined template -> [A_res_sigma_max]' `
  (($s1.Count -eq 1) -and ($s1 -contains "A_res_sigma_max"))
$lb2 = @( [pscustomobject]@{ template = "Z_legacy_unknown"; count = 9 } )
$s2 = @(Survivor-OverMined $lb2)
Assert-Core 'non-TEMPLATES id is IGNORED (cannot steer; honest telemetry)' ($s2.Count -eq 0)
$s3 = @(Survivor-OverMined @())
Assert-Core 'empty leaderboard -> [] (no survivor contribution / v2-identical)' ($s3.Count -eq 0)

# ============================================================================
# 4-6. mergeSurvivorDownWeight -- union with Lean base, distinguishable provenance
# ============================================================================
Write-Host "`n-- 4-6. mergeSurvivorDownWeight --"
$emptyBase = [pscustomobject]@{ downWeight = @(); fromVerified = @(); fromFailed = @() }
$m4 = Merge-SurvivorDownWeight $emptyBase @()
Assert-Core 'empty base + empty survivor -> empty downWeight (fail-safe / v2-identical)' `
  ((@($m4.downWeight).Count -eq 0) -and (@($m4.fromSurvivor).Count -eq 0))
$m5 = Merge-SurvivorDownWeight $emptyBase $lb1
Assert-Core 'empty base + survivor[A_res_sigma_max] -> downWeight=[A_res_sigma_max], fromSurvivor=[A_res_sigma_max]' `
  ((@($m5.downWeight).Count -eq 1) -and ($m5.downWeight -contains "A_res_sigma_max") -and `
   (@($m5.fromSurvivor).Count -eq 1) -and ($m5.fromSurvivor -contains "A_res_sigma_max"))
# UNION: a Lean-down-weighted region (B113) + a DIFFERENT survivor region -> downWeight has BOTH,
# and the provenance stays split (fromSurvivor only the survivor one, fromVerified only the Lean one).
$leanBase = [pscustomobject]@{ downWeight = @("A_nu_total_max"); fromVerified = @("A_nu_total_max"); fromFailed = @() }
$survDiff = @( [pscustomobject]@{ template = "B_sigma_freq"; count = 5 } )
$m6 = Merge-SurvivorDownWeight $leanBase $survDiff
Assert-Core 'UNION: Lean{A_nu_total_max} + survivor{B_sigma_freq} -> downWeight has BOTH; provenance split' `
  ((@($m6.downWeight).Count -eq 2) -and ($m6.downWeight -contains "A_nu_total_max") -and ($m6.downWeight -contains "B_sigma_freq") -and `
   (@($m6.fromSurvivor) -contains "B_sigma_freq") -and (-not (@($m6.fromSurvivor) -contains "A_nu_total_max")) -and `
   (@($m6.fromVerified) -contains "A_nu_total_max"))

# ============================================================================
# 7. buildTemplateSchedule -- empty == TEMPLATES (byte-identical v2)
# ============================================================================
Write-Host "`n-- 7. buildTemplateSchedule (reused B113 soft down-weight) --"
$schedEmpty = @(Build-Schedule @())
Assert-Core 'empty down-weight -> schedule is TEMPLATES itself (byte-identical v2 round-robin)' `
  (($schedEmpty.Count -eq $TEMPLATES.Count) -and ((($schedEmpty -join ",")) -eq (($TEMPLATES -join ","))))

# ============================================================================
# 8-11. ACCEPTANCE -- the survivor->Generate WIRE DETECTOR
#   EMPTY survivor leaderboard vs a MOCK leaderboard with one over-mined template -> the cohort
#   composition MUST DIFFER (over-mined template draws fewer). EMPTY must be byte-identical (balanced).
#   A no-op wire (survivor signal ignored) would make the two compositions IDENTICAL -> these FAIL it.
# ============================================================================
Write-Host "`n-- 8-11. ACCEPTANCE: cohort diverges from the survivor signal --"
# EMPTY survivor (and empty Lean base) -> empty down-weight -> balanced round-robin.
$profEmpty = Merge-SurvivorDownWeight $emptyBase @()
$schedEmptySurv = @(Build-Schedule @($profEmpty.downWeight))
$compEmpty = Simulate-Cohort $schedEmptySurv 120
# MOCK over-mined survivor -> that template down-weighted -> draws fewer.
$profMock = Merge-SurvivorDownWeight $emptyBase $lb1
$schedMock = @(Build-Schedule @($profMock.downWeight))
$compMock = Simulate-Cohort $schedMock 120
Assert-Core 'EMPTY survivor cohort = balanced round-robin (12 per template)' `
  (($compEmpty["A_res_sigma_max"] -eq 12) -and ($compEmpty["B_cond_peak_nu"] -eq 12))
Assert-Core 'WIRE CLOSED: MOCK over-mined survivor shifts cohort composition (DIFFERS from empty)' `
  (-not (Comp-Equal $compEmpty $compMock))
Assert-Core 'over-mined survivor template is UNDER-represented (A_res_sigma_max draws fewer than 12)' `
  ($compMock["A_res_sigma_max"] -lt $compEmpty["A_res_sigma_max"])
# UNION drives BOTH the Lean region and the survivor region under-represented.
$schedUnion = @(Build-Schedule @($m6.downWeight))
$compUnion = Simulate-Cohort $schedUnion 120
Assert-Core 'UNION cohort under-represents BOTH the Lean and the survivor template' `
  (($compUnion["A_nu_total_max"] -lt $compEmpty["A_nu_total_max"]) -and ($compUnion["B_sigma_freq"] -lt $compEmpty["B_sigma_freq"]))
Assert-True ("   (A_res_sigma_max: empty={0} vs survivor-steered={1})" -f $compEmpty["A_res_sigma_max"], $compMock["A_res_sigma_max"]) $true

# ============================================================================
# 12-13. KILL SWITCHES -- granular (survivor only) + master (all steering)
# ============================================================================
Write-Host "`n-- 12-13. kill switches --"
# Granular: M8_SURVIVOR_STEER_DISABLED -> survivor steer dropped; Lean base (here empty) untouched.
$rSurvOff = Resolve-Profile $emptyBase $lb1 $false $true
Assert-Core 'M8_SURVIVOR_STEER_DISABLED -> survivor steering OFF (downWeight empty when only survivor present)' `
  ((@($rSurvOff.downWeight).Count -eq 0) -and (@($rSurvOff.fromSurvivor).Count -eq 0))
# Master: M8_GEN_STEER_DISABLED -> BOTH Lean and survivor dropped -> v2 cohort even with both present.
$rGenOff = Resolve-Profile $leanBase $lb1 $true $false
Assert-Core 'M8_GEN_STEER_DISABLED (master) -> ALL steering OFF (downWeight empty w/ Lean+survivor present)' `
  (@($rGenOff.downWeight).Count -eq 0)
# Sanity: BOTH switches off -> survivor DOES steer (the live default).
$rOn = Resolve-Profile $emptyBase $lb1 $false $false
Assert-True 'both switches off -> survivor steers (downWeight=[A_res_sigma_max])' `
  ((@($rOn.downWeight).Count -eq 1) -and ($rOn.downWeight -contains "A_res_sigma_max"))

# ============================================================================
# 14. fail-safe -- empty survivor + unclassified base -> empty profile -> v2-identical
# ============================================================================
Write-Host "`n-- 14. fail-safe / v2-identical on empty survivor signal --"
$schedFs = @(Build-Schedule @((Merge-SurvivorDownWeight $emptyBase @()).downWeight))
Assert-Core 'empty survivor + empty base -> schedule == TEMPLATES (v2-identical)' `
  (($schedFs -join ",") -eq ($TEMPLATES -join ","))

# ============================================================================
# SOURCE BINDING -- conjecture-gen.js (the survivor->Generate wire lives here)
# ============================================================================
Write-Host "`n-- conjecture-gen.js source --"
Assert-True 'GEN_VERSION bumped to 4 (survivor-steered, was 3 at B113)' ($cg -match 'GEN_VERSION\s*=\s*4;')
Assert-True 'defines survivorOverMinedTemplates'      ($cg -match 'function survivorOverMinedTemplates\(survivorTemplates\)')
Assert-True 'defines mergeSurvivorDownWeight'         ($cg -match 'function mergeSurvivorDownWeight\(baseProfile, survivorTemplates\)')
Assert-True 'survivorOverMinedTemplates filters to real TEMPLATES (FEATURES[tpl])' ($cg -match 'if \(tpl && FEATURES\[tpl\]\) set\.add\(tpl\)')
Assert-True 'mergeSurvivorDownWeight unions base + survivor'  ($cg -match 'new Set\(\[\.\.\.baseDown, \.\.\.fromSurvivor\]\)')
Assert-True 'mergeSurvivorDownWeight emits TEMPLATES-ordered downWeight' ($cg -match 'downWeight:\s*TEMPLATES\.filter\(\(t\) => union\.has\(t\)\)')
Assert-True 'mergeSurvivorDownWeight carries fromSurvivor'    ($cg -match 'fromSurvivor,')
Assert-True 'exports survivorOverMinedTemplates + mergeSurvivorDownWeight' ($cg -match 'survivorOverMinedTemplates, mergeSurvivorDownWeight')
# feedback object surfaces the survivor contribution for telemetry + the packet.
Assert-True 'feedback object carries fromSurvivor'           ($cg -match 'fromSurvivor: \(feedbackProfile && Array\.isArray\(feedbackProfile\.fromSurvivor\)\)')
# generation still consumes the (now also survivor-biased) profile, and the gate stays unbiased.
$rcgSeg = ($cg -split 'function runConjectureGen\(')[1]
Assert-True 'runConjectureGen still passes fbDownWeight into the cohort (B113 path)' ($rcgSeg -match 'COHORT_SIZE, fbDownWeight')
Assert-True 'baseline STILL matched to mined composition (gate stays unbiased)'      ($rcgSeg -match 'mined\.map\(\(c\) => c\.template\)')
# packet honesty: survivor framed as evidence tested-to-N, never proven.
Assert-True 'packet FEEDBACK STEERING line names B116'       ($cg -match 'FEEDBACK STEERING \(Build-113/116')
Assert-True 'packet attributes the FREE survivor signal'     ($cg -match 'came from the FREE survivor signal')
Assert-True 'HONESTY: survivor evidence NEVER proven'        ($cg -match 'EMPIRICAL evidence "tested to N", NEVER proven')
Assert-True 'HONESTY: down-weighted region NEVER solved/proven/true' ($cg -match 'NEVER solved/proven/true')

# wrapper wiring -- the merge happens here, B113/B114/B112 preserved.
$wrapSeg = ($cg -split 'async function runConjectureGenWithFeedback')[1]
Assert-True 'wrapper builds Lean profile via buildGenFeedbackProfile (B113 preserved, 2-arg)' `
  ($wrapSeg -match 'buildGenFeedbackProfile\(earnedPatterns, failedPatterns\)')
Assert-True 'wrapper resolves master kill via steerOff (M8_GEN_STEER_DISABLED)' `
  ($wrapSeg -match 'const steerOff = process\.env\.M8_GEN_STEER_DISABLED === "1";')
Assert-True 'wrapper has granular survivor kill M8_SURVIVOR_STEER_DISABLED' `
  ($wrapSeg -match 'M8_SURVIVOR_STEER_DISABLED === "1"')
Assert-True 'wrapper survForSteer derives from survivorTemplates' ($wrapSeg -match 'survForSteer = .* survivorTemplates;')
Assert-True 'wrapper unions survivor INTO the profile (mergeSurvivorDownWeight)' `
  ($wrapSeg -match 'feedbackProfile = mergeSurvivorDownWeight\(leanProfile, survForSteer\)')

# ---- B114 (FREE survivor EVIDENCE narration) + B112 (N-verifs PREFER) invariants preserved ----
Write-Host "`n-- B114 / B112 invariants preserved --"
Assert-True 'wrapper still fetches getSurvivorTemplateStats (B114)' ($wrapSeg -match 'getSurvivorTemplateStats')
Assert-True 'wrapper still builds the survivor EVIDENCE block (B114 narration)' ($wrapSeg -match 'buildSurvivorBlock\(survivorTemplates\)')
Assert-True 'wrapper still calls getEarnedSuccessPatterns (B112 PREFER gate)' ($wrapSeg -match 'getEarnedSuccessPatterns')

# ============================================================================
# SOURCE BINDING -- loop.js observe phase (telemetry; routing preserved)
# ============================================================================
Write-Host "`n-- loop.js observe-phase wiring --"
$obsSeg = ($lp -split 'async function runObservePhase')[1]
$obsSeg = ($obsSeg -split 'async function runVerifyPhase')[0]
Assert-True 'observe still routes through runConjectureGenWithFeedback' ($obsSeg -match 'await runConjectureGenWithFeedback')
Assert-True 'learn telemetry stamps survivor_steered'        ($obsSeg -match 'survivor_steered:')
Assert-True 'learn telemetry stamps survivor_down_weighted'  ($obsSeg -match 'survivor_down_weighted:')
Assert-True 'survivor telemetry sources from m3.feedback.fromSurvivor (real steering, not narration)' `
  ($obsSeg -match 'm3\.feedback\.fromSurvivor')
Assert-True 'still stamps gen_version (now 4 via GEN_VERSION)' ($obsSeg -match 'row\.metadata\.gen_version = m3\.genVersion')
Assert-True 'B113 down_weighted telemetry preserved'         ($obsSeg -match 'down_weighted:')

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host ""
$coreColor = 'Red'; if ($script:core -eq 14) { $coreColor = 'Green' }
Write-Host ("{0}/14 core checks passed" -f $script:core) -ForegroundColor $coreColor
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "ALL $total checks PASS -- Build-116 verified ($($script:core)/14 core + $($total - $script:core) wiring)." -ForegroundColor Green
} else {
  Write-Host "$($script:pass)/$total checks passed, $($script:fail) FAILED." -ForegroundColor Red
  exit 1
}
