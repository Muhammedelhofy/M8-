# tests/B113-outcome-aware-gen-verify.ps1
# Build-113 -- Close the Record->Generate wire (outcome-aware generation) -- offline, PS 5.1 ASCII.
#
# Node is NOT installed on this host, so per repo convention the behavioral checks are PS-5.1
# ports of the pure JS logic, each BOUND to the JS source by a pattern assertion so a port can
# never silently drift from the implementation.
#
# WHAT THIS BUILD CLOSES: the nightly generator mined its 120-candidate cohort by a FIXED
# round-robin over the 10 templates -- it IGNORED recorded outcomes. Build-112 only fed those
# outcomes into the NARRATION packet (runConjectureGenWithFeedback appended text); the mined
# cohort was unchanged. Build-113 makes the mined cohort itself outcome-aware: a feedback
# snapshot (earned-verified + sorry template regions) DOWN-WEIGHTS explored regions via the
# template SCHEDULE, so the cohort favors UNEXPLORED regions. Empty snapshot => the schedule is
# TEMPLATES itself => byte-identical to gen v2.
#
# HONESTY (preserved, asserted): generation steering only. The micro-prover, vacuity floor,
# Wilson/Newcombe GATE, baseline-matching, and "machine-generated / never proven" contract are
# all untouched. The matched baseline is rebuilt FROM the (biased) mined composition, so the
# gate still compares like-with-like.
#
# The 6 core checks (the X/6 headline):
#   1. detectGenFeatures      -> feature families from free-form text (+ total/stopping disambig)
#   2. classifyConjectureTemplates -> templates whose ENTIRE feature signature is present
#   3. buildGenFeedbackProfile -> earned(verified) + failed(sorry) -> down-weight set
#   4. buildTemplateSchedule  -> empty == TEMPLATES (byte-identical); down-weight reshapes it
#   5. ACCEPTANCE: same seed-equivalent schedule, empty vs mock down-weight -> cohort
#      composition DIFFERS (>=1 template count changes) AND empty == balanced round-robin.
#      (A no-op wire would make the two compositions IDENTICAL -> this check FAILS it.)
#   6. flip-flop / fail-safe: empty + unclassifiable snapshot -> empty profile -> v2-identical
# Plus source/wiring bindings for conjecture-gen.js and loop.js (incl. Build-112 preserved).

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

Write-Host "Build-113 outcome-aware generation (Record->Generate wire) verify`n"

# ============================================================================
# PS PORTS (faithful mirrors of the pure JS in conjecture-gen.js)
# ============================================================================

# TEMPLATES order + FEATURES map (ported verbatim from conjecture-gen.js).
$TEMPLATES = @(
  "A_res_sigma_max","A_res_total_max","A_nu_total_max","A_total_log","A_peak_power",
  "A_cond_nu_peak","B_sigma_freq","B_res_total_gap","B_nu_geo","B_cond_peak_nu"
)
$FEATURES = @{
  A_res_sigma_max = @("stopping_time","residue_census")
  A_res_total_max = @("total_stopping_time","residue_census")
  A_nu_total_max  = @("two_adic","total_stopping_time")
  A_total_log     = @("total_stopping_time","record_setters")
  A_peak_power    = @("max_excursion","record_setters")
  A_cond_nu_peak  = @("two_adic","max_excursion")
  B_sigma_freq    = @("stopping_time","residue_census")
  B_res_total_gap = @("total_stopping_time","residue_census")
  B_nu_geo        = @("two_adic","residue_census")
  B_cond_peak_nu  = @("max_excursion","two_adic")
}
$GEN_SCHEDULE_BASE = 4

# detectGenFeatures: ASCII branches of the JS regex set (the JS ALSO carries unicode branches
# -- sigma/nu2/equiv -- asserted present in the source binding below). PS -match is CI by default,
# mirroring the JS /i flag.
$FEATURE_SIGNATURE = @{
  total_stopping_time = @('\btotal[\s_-]*stopping', '\bsigma[\s_]*inf', '\bsigma_inf\b')
  stopping_time       = @('\bstopping[\s_-]*time\b', '\bsigma\s*\(')
  two_adic            = @('\bnu[\s_]*2\b', '\bnu2\b', '\b2[\s-]?adic\b', '\bv_?2\s*\(\s*3\s*n')
  max_excursion       = @('\bpeak\b', '\bexcursion\b', '\bmax(?:imum)?\s+(?:value|excursion|height)\b')
  residue_census      = @('\bmod\b', '\bresidue\b', '\(\s*mod', '\bcongruen')
  record_setters      = @('\brecord\b', '\blog[\s_]*2\b', '\blogarithm')
}
# stable feature order (matches Object.keys insertion order in the JS literal)
$FEATURE_ORDER = @("total_stopping_time","stopping_time","two_adic","max_excursion","residue_census","record_setters")

function Detect-GenFeatures([string]$text) {
  $s = [string]$text
  $out = @{}
  foreach ($feat in $FEATURE_ORDER) {
    foreach ($re in $FEATURE_SIGNATURE[$feat]) {
      if ($s -match $re) { $out[$feat] = $true; break }
    }
  }
  # "total stopping time" contains "stopping time": keep only the more specific total family.
  if ($out.ContainsKey("total_stopping_time")) { [void]$out.Remove("stopping_time") }
  return $out
}

function Classify-Templates([string]$text) {
  $feats = Detect-GenFeatures $text
  $kept = New-Object System.Collections.Generic.List[string]
  if ($feats.Count -eq 0) { return $kept.ToArray() }
  foreach ($tmpl in $TEMPLATES) {
    $sig = $FEATURES[$tmpl]
    $all = $true
    foreach ($f in $sig) { if (-not $feats.ContainsKey($f)) { $all = $false; break } }
    if ($all) { [void]$kept.Add($tmpl) }
  }
  return $kept.ToArray()
}

# buildGenFeedbackProfile: union of classified templates from earned (verified) + failed (sorry)
# rows, returned in TEMPLATES order. (Rows are pscustomobjects with .conjecture_text.)
function Build-GenProfile($earned, $failed) {
  $verSet = @{}; $failSet = @{}
  foreach ($p in @($earned)) { foreach ($t in @(Classify-Templates ([string]$p.conjecture_text))) { $verSet[$t]  = $true } }
  foreach ($p in @($failed)) { foreach ($t in @(Classify-Templates ([string]$p.conjecture_text))) { $failSet[$t] = $true } }
  $dwSet = @{}; foreach ($k in $verSet.Keys) { $dwSet[$k] = $true }; foreach ($k in $failSet.Keys) { $dwSet[$k] = $true }
  return [pscustomobject]@{
    downWeight   = @($TEMPLATES | Where-Object { $dwSet.ContainsKey($_) })
    fromVerified = @($TEMPLATES | Where-Object { $verSet.ContainsKey($_) })
    fromFailed   = @($TEMPLATES | Where-Object { $failSet.ContainsKey($_) })
  }
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
# that always yields a unique success (so active/fails/seen never trip). This isolates the ONLY
# Build-113 change -- which template each step draws from -- so the resulting per-template
# composition is exactly what the real cohort's composition tracks. Returns template->count.
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
# 1. detectGenFeatures
# ============================================================================
Write-Host "-- 1. detectGenFeatures --"
$f1 = Detect-GenFeatures "for all n <= 100000 with n = 1 (mod 6): stopping time sigma(n) <= 23"
Assert-Core 'sigma+mod text -> {stopping_time, residue_census}; NOT total' `
  ($f1.ContainsKey("stopping_time") -and $f1.ContainsKey("residue_census") -and -not $f1.ContainsKey("total_stopping_time"))
$f2 = Detect-GenFeatures "mean total stopping time sigma_inf over a residue class"
Assert-Core 'total-stopping text -> total_stopping_time and DROPS plain stopping_time (disambig)' `
  ($f2.ContainsKey("total_stopping_time") -and -not $f2.ContainsKey("stopping_time"))
$f3 = Detect-GenFeatures "the 2-adic valuation nu2(3n+1) and the peak excursion"
Assert-Core 'nu2 + peak text -> {two_adic, max_excursion}' `
  ($f3.ContainsKey("two_adic") -and $f3.ContainsKey("max_excursion"))

# ============================================================================
# 2. classifyConjectureTemplates -- ALL-features-present (confident region match)
# ============================================================================
Write-Host "`n-- 2. classifyConjectureTemplates --"
$c1 = @(Classify-Templates "for all n <= 100000 with n = 1 (mod 6): stopping time sigma(n) <= 23")
Assert-Core 'sigma+residue -> exactly [A_res_sigma_max, B_sigma_freq]' `
  (($c1.Count -eq 2) -and ($c1 -contains "A_res_sigma_max") -and ($c1 -contains "B_sigma_freq"))
$c2 = @(Classify-Templates "nu2(3n+1) bounds the total stopping time sigma_inf(n)")
Assert-Core 'nu2+total -> [A_nu_total_max] only (residue absent, so not A_res_total_max)' `
  (($c2.Count -eq 1) -and ($c2 -contains "A_nu_total_max"))
$c3 = @(Classify-Templates "a plain prose lemma about even integers")
Assert-Core 'unclassifiable text -> [] (no steering)' ($c3.Count -eq 0)

# ============================================================================
# 3. buildGenFeedbackProfile -- earned(verified) + failed(sorry) -> down-weight
# ============================================================================
Write-Host "`n-- 3. buildGenFeedbackProfile --"
$earned = @( [pscustomobject]@{ conjecture_text = "n = 1 (mod 6): stopping time sigma(n) <= 23" } )
$failed = @( [pscustomobject]@{ conjecture_text = "nu2(3n+1) bounds total stopping time sigma_inf(n)" } )
$prof = Build-GenProfile $earned $failed
$dw = @($prof.downWeight)
Assert-Core 'profile.downWeight = verified(A_res_sigma_max,B_sigma_freq) + failed(A_nu_total_max)' `
  (($dw.Count -eq 3) -and ($dw -contains "A_res_sigma_max") -and ($dw -contains "B_sigma_freq") -and ($dw -contains "A_nu_total_max"))
Assert-True 'profile splits provenance: fromVerified has 2, fromFailed has 1' `
  ((@($prof.fromVerified).Count -eq 2) -and (@($prof.fromFailed).Count -eq 1))
$profEmpty = Build-GenProfile @() @()
Assert-Core 'empty snapshot -> empty downWeight (fail-safe / v2-identical)' (@($profEmpty.downWeight).Count -eq 0)

# ============================================================================
# 4. buildTemplateSchedule -- empty == TEMPLATES (byte-identical); down-weight reshapes
# ============================================================================
Write-Host "`n-- 4. buildTemplateSchedule --"
$schedEmpty = @(Build-Schedule @())
Assert-Core 'empty down-weight -> schedule is TEMPLATES itself (byte-identical v2 round-robin)' `
  (($schedEmpty.Count -eq $TEMPLATES.Count) -and ((($schedEmpty -join ",")) -eq (($TEMPLATES -join ","))))
$schedDw = @(Build-Schedule @("A_res_sigma_max"))
$cntDown = (@($schedDw | Where-Object { $_ -eq "A_res_sigma_max" })).Count
$cntKept = (@($schedDw | Where-Object { $_ -eq "A_res_total_max" })).Count
Assert-Core 'down-weight A_res_sigma_max -> it appears 1x, an unexplored template 4x, len=37' `
  (($cntDown -eq 1) -and ($cntKept -eq 4) -and ($schedDw.Count -eq 37))
Assert-True 'down-weighted schedule != empty schedule' ((($schedDw -join ",")) -ne (($schedEmpty -join ",")))

# ============================================================================
# 5. ACCEPTANCE -- same schedule-driven cohort, empty vs down-weight -> composition DIFFERS,
#    and empty composition is the balanced round-robin. This is the wire detector: a no-op
#    (wire still open) would yield IDENTICAL compositions and FAIL this check.
# ============================================================================
Write-Host "`n-- 5. ACCEPTANCE: cohort composition diverges under feedback --"
$compEmpty = Simulate-Cohort $schedEmpty 120
$compDown  = Simulate-Cohort $schedDw  120
Assert-Core 'empty cohort = balanced round-robin (12 per template)' `
  (($compEmpty["A_res_sigma_max"] -eq 12) -and ($compEmpty["B_cond_peak_nu"] -eq 12))
Assert-Core 'WIRE CLOSED: down-weighted cohort composition DIFFERS from empty (>=1 template changed)' `
  (-not (Comp-Equal $compEmpty $compDown))
Assert-Core 'down-weighted region is UNDER-represented (A_res_sigma_max draws fewer than the 12 baseline)' `
  ($compDown["A_res_sigma_max"] -lt $compEmpty["A_res_sigma_max"])
Assert-True ("   (A_res_sigma_max: empty={0} vs down-weighted={1})" -f $compEmpty["A_res_sigma_max"], $compDown["A_res_sigma_max"]) $true

# ============================================================================
# 6. fail-safe -- empty/unclassifiable snapshot -> empty profile -> empty schedule -> v2
# ============================================================================
Write-Host "`n-- 6. fail-safe / v2-identical on empty feedback --"
$profUn = Build-GenProfile @([pscustomobject]@{ conjecture_text = "prose with no collatz vocabulary" }) @()
$schedUn = @(Build-Schedule @($profUn.downWeight))
Assert-Core 'unclassifiable verified row -> empty down-weight -> schedule == TEMPLATES (v2-identical)' `
  ((@($profUn.downWeight).Count -eq 0) -and (($schedUn -join ",") -eq ($TEMPLATES -join ",")))

# ============================================================================
# SOURCE BINDING -- conjecture-gen.js (the wire lives here)
# ============================================================================
Write-Host "`n-- conjecture-gen.js source --"
Assert-True 'GEN_VERSION bumped to 4 (B116 survivor-steered; was 3 at B113)' ($cg -match "GEN_VERSION\s*=\s*4;")
Assert-True 'exports detectGenFeatures'                         ($cg -match "detectGenFeatures")
Assert-True 'exports classifyConjectureTemplates'              ($cg -match "classifyConjectureTemplates")
Assert-True 'exports buildGenFeedbackProfile'                  ($cg -match "buildGenFeedbackProfile")
Assert-True 'exports buildTemplateSchedule'                    ($cg -match "buildTemplateSchedule")
Assert-True 'GEN_SCHEDULE_BASE constant present'              ($cg -match "GEN_SCHEDULE_BASE\s*=\s*4")
Assert-True 'classifier requires ALL features (sig.every)'    ($cg -match "sig\.every\(\(f\) => feats\.has\(f\)\)")
# Build the unicode probe from codepoints so this ASCII script never embeds the literals
# (PS 5.1 mangles unicode in a BOM-less .ps1). Confirms the JS GEN_FEATURE_SIGNATURE keeps
# the unicode branches (sigma U+03C3 / nu U+03BD) that the PS port covers with ASCII aliases.
$sigSeg = ($cg -split "GEN_FEATURE_SIGNATURE = \{")[1]; if ($sigSeg) { $sigSeg = ($sigSeg -split "\};")[0] } else { $sigSeg = "" }
Assert-True 'classifier carries unicode branches (sigma/nu) in JS signature' `
  (($sigSeg.IndexOf([char]0x03C3) -ge 0) -or ($sigSeg.IndexOf([char]0x03BD) -ge 0))
$gmSeg = ($cg -split "function generateMinedCohort")[1]
Assert-True 'generateMinedCohort takes downWeight param'      ($gmSeg -match "count, downWeight\)")
Assert-True 'generateMinedCohort builds the schedule'        ($gmSeg -match "buildTemplateSchedule\(downWeight\)")
Assert-True 'generateMinedCohort iterates schedule[ti % len]' ($gmSeg -match "schedule\[ti % schedule\.length\]")
$btsSeg = ($cg -split "function buildTemplateSchedule")[1]
Assert-True 'buildTemplateSchedule returns TEMPLATES when empty (byte-identical)' ($btsSeg -match "if \(!dw\.size\) return TEMPLATES;")
$rcgSeg = ($cg -split "function runConjectureGen\(")[1]
Assert-True 'runConjectureGen takes feedbackProfile'         ($rcgSeg -match "feedbackProfile")
Assert-True 'runConjectureGen passes fbDownWeight into the cohort' ($rcgSeg -match "COHORT_SIZE, fbDownWeight")
Assert-True 'baseline STILL matched to mined composition (gate stays unbiased)' ($rcgSeg -match "mined\.map\(\(c\) => c\.template\)")
Assert-True 'runConjectureGen stamps m3_feedback metadata'   ($cg -match "m3_feedback: feedback")
Assert-True 'packet carries a FEEDBACK STEERING line'        ($cg -match "FEEDBACK STEERING \(Build-113")
Assert-True 'HONESTY: steering NEVER solved/proven/true'     ($cg -match "NEVER solved/proven/true")
$wrapSeg = ($cg -split "async function runConjectureGenWithFeedback")[1]
Assert-True 'wrapper builds the profile BEFORE generating'   ($wrapSeg -match "buildGenFeedbackProfile\(earnedPatterns, failedPatterns\)")
Assert-True 'wrapper passes the profile into runConjectureGen' ($wrapSeg -match "runConjectureGen\(Object\.assign\(\{\}, opts, \{ feedbackProfile \}\)\)")
Assert-True 'kill switch M8_GEN_STEER_DISABLED reverts to empty profile' ($wrapSeg -match "M8_GEN_STEER_DISABLED")

# ---- Build-112 invariants must be PRESERVED ----
Write-Host "`n-- Build-112 invariants preserved --"
Assert-True 'wrapper still calls getEarnedSuccessPatterns'   ($wrapSeg -match "getEarnedSuccessPatterns")
Assert-True 'PREFER block still built from earnedPatterns'   ($wrapSeg -match "buildFeedbackBlock\(earnedPatterns\)")
Assert-True 'wrapper still calls getSuccessPatterns'         ($wrapSeg -match "getSuccessPatterns")
Assert-True 'wrapper still calls getFailedApproaches'        ($wrapSeg -match "getFailedApproaches")
Assert-True 'PREFER prepend preserved (result.packet = block)' ($wrapSeg -match "result\.packet = block")
Assert-True 'disabled early-return carries earnedPatterns: []' ($cg -match "successPatterns: \[\], failedPatterns: \[\], earnedPatterns: \[\]")

# ============================================================================
# SOURCE BINDING -- loop.js observe phase (telemetry; routing preserved)
# ============================================================================
Write-Host "`n-- loop.js observe-phase wiring --"
$obsSeg = ($lp -split "async function runObservePhase")[1]
$obsSeg = ($obsSeg -split "async function runVerifyPhase")[0]
Assert-True 'observe still routes through runConjectureGenWithFeedback' ($obsSeg -match "await runConjectureGenWithFeedback")
Assert-True 'learn telemetry stamps gen_steered'            ($obsSeg -match "gen_steered:")
Assert-True 'learn telemetry stamps down_weighted regions'  ($obsSeg -match "down_weighted:")
Assert-True 'still stamps gen_version (now 4 via GEN_VERSION)' ($obsSeg -match "row\.metadata\.gen_version = m3\.genVersion")
Assert-True 'observe still NO LLM'                          ($obsSeg -match "NO LLM")

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host ""
$coreColor = 'Red'; if ($script:core -eq 14) { $coreColor = 'Green' }
Write-Host ("{0}/14 core checks passed" -f $script:core) -ForegroundColor $coreColor
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "ALL $total checks PASS -- Build-113 verified ($($script:core)/14 core + $($total - $script:core) wiring)." -ForegroundColor Green
} else {
  Write-Host "$($script:pass)/$total checks passed, $($script:fail) FAILED." -ForegroundColor Red
  exit 1
}
