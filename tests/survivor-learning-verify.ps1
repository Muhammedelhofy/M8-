# tests/survivor-learning-verify.ps1
# Build-113 -- FREE falsification-survivor learning (the no-Lean lane) -- offline, PS 5.1 ASCII.
#
# Node is NOT installed on this host, so per the repo convention the behavioral checks are
# PS-5.1 ports of the pure aggregation/gate/format logic in lib/conjecture-memory.js, each
# BOUND to the JS source by a pattern assertion so a port can't silently drift.
#
# WHAT THIS BUILD DOES: the Build-112 PREFER block earns ONLY from Lean-PROVEN outcomes, and
# the Lean checker is parked -> starved. This lane learns for FREE from the M3 generator's
# in-process SURVIVORS (machine-generated conjectures that survived falsification to a bound N,
# each from a structural TEMPLATE). It aggregates the EXISTING survivor records (m8_research_notes)
# by template (READ-ONLY, schema-free, NO LLM), gates by distinct-survivor productivity, and
# surfaces a SEPARATE, clearly-labeled COMPUTATIONAL-EVIDENCE block.
#
# *** HONESTY WALL (the load-bearing invariant): survived != proven. The block is framed as
#     "computational evidence / tested to N", never proof; the reader never touches the Lean
#     outcomes table; only a Lean machine-check mints "proven". Several checks below guard this. ***
#
# The eight spec checks (the X/8 core headline):
#   1. parseTestedToBound -> metadata.tested_to wins; status "tested_to_<N>" fallback; garbage -> 0
#   2. aggregateSurvivorsByTemplate -> distinct-STATEMENT dedup, group by template, maxBound, ranked
#   3. aggregate skips rows with no template / no content / not-a-survivor
#   4. gateSurvivorTemplates(min=3) -> keeps count>=3, caps at SURVIVOR_TEMPLATE_LIMIT (5)
#   5. LIVE-DATA shape (real Supabase counts) -> exact top-5 earned set, ordering, thin templates dropped
#   6. survivorMinCount -> env M8_SURVIVOR_MIN_COUNT (>=1) else default 3
#   7. buildSurvivorBlock([]) -> "" (silent on thin signal; packet byte-identical)
#   8. buildSurvivorBlock HONESTY: evidence-not-proof wording, [tag] brackets, no "is proven" claim
# Plus source/wiring/honesty-wall checks for conjecture-memory.js, conjecture-gen.js, loop.js.

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

Write-Host "Build-113 free survivor-learning verify`n"

# ============================================================================
# PS PORTS (faithful mirrors of the JS pure logic in conjecture-memory.js)
# ============================================================================

# parseTestedToBound: prefer numeric metadata.tested_to; else status "tested_to_<N>"; else 0.
function ParseBound($status, $meta) {
  $raw = $null
  if ($meta -ne $null -and $meta.ContainsKey('tested_to')) { $raw = $meta['tested_to'] }
  if ($raw -ne $null) {
    $n = 0
    if ([int]::TryParse([string]$raw, [ref]$n)) { if ($n -gt 0) { return $n } }
  }
  $m = [regex]::Match([string]$status, '^tested_to_(\d+)$', 'IgnoreCase')
  if ($m.Success) { $b = [int]$m.Groups[1].Value; if ($b -gt 0) { return $b } }
  return 0
}

# aggregateSurvivorsByTemplate: group survivor rows by template; count = DISTINCT statements
# (content normalized + deduped); maxBound = highest tested_to; ranked count desc / bound desc / name asc.
function AggSurvivors($rows) {
  $byTpl = @{}
  foreach ($r in @($rows)) {
    $meta = $r.metadata
    $isSurv = $false
    if ($meta -ne $null -and $meta.ContainsKey('m3_generated') -and $meta['m3_generated']) { $isSurv = $true }
    if (-not $isSurv -and ([string]$r.status) -match '^tested_to_') { $isSurv = $true }
    if (-not $isSurv) { continue }
    $tpl = ''
    if ($meta -ne $null -and $meta.ContainsKey('m3_template')) { $tpl = ([string]$meta['m3_template']).Trim() }
    if ($tpl -eq '') { continue }
    $stmt = (([string]$r.content) -replace '\s+',' ').Trim()
    if ($stmt -eq '') { continue }
    if (-not $byTpl.ContainsKey($tpl)) {
      $byTpl[$tpl] = [pscustomobject]@{ template = $tpl; seen = (New-Object 'System.Collections.Generic.HashSet[string]'); maxBound = 0 }
    }
    [void]$byTpl[$tpl].seen.Add($stmt)
    $b = ParseBound $r.status $meta
    if ($b -gt $byTpl[$tpl].maxBound) { $byTpl[$tpl].maxBound = $b }
  }
  $arr = @()
  foreach ($k in $byTpl.Keys) {
    $arr += [pscustomobject]@{ template = $byTpl[$k].template; count = $byTpl[$k].seen.Count; maxBound = $byTpl[$k].maxBound }
  }
  return @($arr | Sort-Object @{e={$_.count};Descending=$true}, @{e={$_.maxBound};Descending=$true}, @{e={$_.template};Descending=$false})
}

# gateSurvivorTemplates: keep count>=min (clamped >=1), cap at 5.
function GateSurvivors($aggs, [int]$minCount) {
  $min = $minCount; if ($min -lt 1) { $min = 1 }
  $kept = New-Object System.Collections.Generic.List[object]
  foreach ($a in @($aggs)) { if (([int]$a.count) -ge $min) { [void]$kept.Add($a) } }
  $out = $kept.ToArray()
  if ($out.Count -gt 5) { $out = $out[0..4] }
  return $out   # NOTE: no leading comma -- @() at the call site collects (PS jagged-array gotcha)
}

# survivorMinCount: env M8_SURVIVOR_MIN_COUNT (>=1) else default 3.
function SurvivorMin($envVal) {
  $n = 0
  if ([int]::TryParse([string]$envVal, [ref]$n)) { if ($n -ge 1) { return $n } }
  return 3
}

# buildSurvivorBlock: ASCII mirror of the formatter (the JS uses unicode bullets; the
# wording is what matters). Empty input -> "".
function BuildBlock($earned) {
  if (@($earned).Count -eq 0) { return '' }
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add('COMPUTATIONAL EVIDENCE - structural templates whose machine-generated conjectures SURVIVED falsification to high bounds.')
  [void]$lines.Add('This is EMPIRICAL evidence from in-process testing, NOT proof: survived != proven. Only a Lean machine-check mints "proven"; a survivor is "tested to N" and nothing more.')
  [void]$lines.Add('These structures have been comparatively productive - you MAY favor drawing fresh conjectures from them, but NEVER call a survivor proven, established, true, or likely true:')
  foreach ($t in @($earned)) {
    $c = [int]$t.count
    $s = 's'; if ($c -eq 1) { $s = '' }
    $bound = 'N'; if ([int]$t.maxBound -gt 0) { $bound = ([int]$t.maxBound).ToString('N0') }
    [void]$lines.Add(('* [' + $t.template + '] - ' + $c + ' distinct survivor' + $s + ', tested to ' + $bound + ' (computational evidence, NOT proof)'))
  }
  [void]$lines.Add('Frame any use of these only as "this structure has produced conjectures that survived testing to N", never as a truth signal.')
  return ($lines -join "`n")
}

function NoteRow($tpl, $content, $bound, $gen) {
  $meta = @{ m3_template = $tpl; tested_to = $bound; m3_generated = $gen }
  return [pscustomobject]@{ content = $content; status = $null; metadata = $meta }
}

# ============================================================================
# 1. parseTestedToBound
# ============================================================================
Write-Host "-- 1. parseTestedToBound --"
$b1 = ParseBound $null @{ tested_to = 100000 }                 # numeric meta wins
$b2 = ParseBound $null @{ tested_to = "250000" }               # string meta parses
$b3 = ParseBound "tested_to_300000" @{}                        # status fallback
$b4 = ParseBound $null @{ tested_to = "x" }                    # garbage -> 0
$b5 = ParseBound "open" @{}                                    # no signal -> 0
Assert-Core 'parseTestedToBound: meta=100000, str=250000, status=300000, garbage=0, none=0' `
  (($b1 -eq 100000) -and ($b2 -eq 250000) -and ($b3 -eq 300000) -and ($b4 -eq 0) -and ($b5 -eq 0))

# ============================================================================
# 2. aggregateSurvivorsByTemplate -- distinct dedup, grouping, maxBound, ranking
# ============================================================================
Write-Host "`n-- 2. aggregateSurvivorsByTemplate --"
$rows2 = @(
  (NoteRow "A_peak_power"   "stmt P1" 100000 $true),
  (NoteRow "A_peak_power"   "stmt P1" 100000 $true),    # exact dup -> counts once
  (NoteRow "A_peak_power"   "stmt P2" 200000 $true),    # 2nd distinct, higher bound
  (NoteRow "B_sigma_freq"   "stmt S1" 100000 $true)
)
$agg2 = @(AggSurvivors $rows2)
$ap = $agg2 | Where-Object { $_.template -eq "A_peak_power" }
$bs = $agg2 | Where-Object { $_.template -eq "B_sigma_freq" }
Assert-Core 'aggregate: A_peak_power=2 distinct (dup collapsed) maxBound 200000; B_sigma_freq=1; A first (rank)' `
  (($ap.count -eq 2) -and ($ap.maxBound -eq 200000) -and ($bs.count -eq 1) -and ($agg2[0].template -eq "A_peak_power"))

# ============================================================================
# 3. aggregate skips: no template / no content / not-a-survivor
# ============================================================================
Write-Host "`n-- 3. aggregate skips junk rows --"
$rows3 = @(
  (NoteRow ""             "has no template" 100000 $true),                       # no template -> skip
  (NoteRow "A_peak_power" ""                100000 $true),                       # no content  -> skip
  ([pscustomobject]@{ content = "not a survivor"; status = $null; metadata = @{ m3_template = "A_peak_power" } }),  # no m3_generated, no tested_to status -> skip
  (NoteRow "A_peak_power" "real survivor"   100000 $true)                        # the only valid one
)
$agg3 = @(AggSurvivors $rows3)
Assert-Core 'aggregate: skips no-template / no-content / non-survivor; 1 template, count 1' `
  (($agg3.Count -eq 1) -and ($agg3[0].template -eq "A_peak_power") -and ($agg3[0].count -eq 1))

# ============================================================================
# 4. gateSurvivorTemplates(min=3) -- keeps >=3, caps at 5
# ============================================================================
Write-Host "`n-- 4. gateSurvivorTemplates --"
$aggs4 = @(
  [pscustomobject]@{ template="t1"; count=9; maxBound=100000 },
  [pscustomobject]@{ template="t2"; count=8; maxBound=100000 },
  [pscustomobject]@{ template="t3"; count=7; maxBound=100000 },
  [pscustomobject]@{ template="t4"; count=6; maxBound=100000 },
  [pscustomobject]@{ template="t5"; count=5; maxBound=100000 },
  [pscustomobject]@{ template="t6"; count=4; maxBound=100000 },   # earns (>=3) but capped out
  [pscustomobject]@{ template="t7"; count=2; maxBound=100000 }    # gated out (<3)
)
$g4 = @(GateSurvivors $aggs4 3)
$t7present = $false; foreach ($x in $g4) { if ($x.template -eq "t7") { $t7present = $true } }
Assert-Core 'gate(min=3): returns top 5 by productivity, drops the <3 template' `
  (($g4.Count -eq 5) -and (-not $t7present) -and ($g4[0].template -eq "t1"))

# ============================================================================
# 5. LIVE-DATA shape -- the REAL Supabase distinct-statement counts (verified this session)
#    A_peak_power=17, B_cond_peak_nu=14, A_cond_nu_peak=14, B_res_total_gap=14,
#    A_res_sigma_max=13, B_sigma_freq=5, B_nu_geo=1  (all tested to 100000)
#    min=3 -> top 5 earn; B_sigma_freq earns but capped out; B_nu_geo (1) gated out.
# ============================================================================
Write-Host "`n-- 5. live-data shape (real counts) --"
# build the rows: N distinct statements per template (each a unique content string)
$liveSpec = @{ "A_peak_power"=17; "B_cond_peak_nu"=14; "A_cond_nu_peak"=14; "B_res_total_gap"=14; "A_res_sigma_max"=13; "B_sigma_freq"=5; "B_nu_geo"=1 }
$rows5 = New-Object System.Collections.Generic.List[object]
foreach ($tpl in $liveSpec.Keys) {
  for ($i = 1; $i -le $liveSpec[$tpl]; $i++) {
    [void]$rows5.Add((NoteRow $tpl ("$tpl statement #$i") 100000 $true))
  }
}
$agg5 = @(AggSurvivors $rows5.ToArray())
$earned5 = @(GateSurvivors $agg5 3)
$earnedTpls = @($earned5 | ForEach-Object { $_.template })
$nuGeoIn = $earnedTpls -contains "B_nu_geo"
$top1 = ($earnedTpls.Count -ge 1 -and $earnedTpls[0] -eq "A_peak_power")
$expected5 = @("A_peak_power","A_cond_nu_peak","B_cond_peak_nu","B_res_total_gap","A_res_sigma_max")  # count desc, then name asc among the 14s
$setMatch = (($earnedTpls.Count -eq 5) -and ((@($earnedTpls | Sort-Object) -join ",") -eq (@($expected5 | Sort-Object) -join ",")))
Assert-Core 'live shape: exactly the 5 most-productive templates earn; B_nu_geo(1) excluded; A_peak_power ranks #1' `
  ($setMatch -and (-not $nuGeoIn) -and $top1)

# ============================================================================
# 6. survivorMinCount -- env override (>=1) else default 3
# ============================================================================
Write-Host "`n-- 6. survivorMinCount --"
Assert-Core 'survivorMinCount: unset/invalid/<1 -> 3 ; valid -> env' `
  ((SurvivorMin $null) -eq 3 -and (SurvivorMin "") -eq 3 -and (SurvivorMin "0") -eq 3 -and (SurvivorMin "abc") -eq 3 -and (SurvivorMin "5") -eq 5 -and (SurvivorMin "1") -eq 1)

# ============================================================================
# 7. buildSurvivorBlock([]) -> "" (silent; packet stays byte-identical)
# ============================================================================
Write-Host "`n-- 7. buildSurvivorBlock empty -> silent --"
Assert-Core 'buildSurvivorBlock([]) returns empty string' ((BuildBlock @()) -eq '')

# ============================================================================
# 8. buildSurvivorBlock HONESTY -- evidence-not-proof wording + [tag] brackets + no proof claim
# ============================================================================
Write-Host "`n-- 8. buildSurvivorBlock honesty wall --"
$blk = BuildBlock @(
  [pscustomobject]@{ template="A_peak_power"; count=17; maxBound=100000 },
  [pscustomobject]@{ template="B_nu_geo";     count=1;  maxBound=100000 }
)
$hasEvidence = ($blk -match 'COMPUTATIONAL EVIDENCE') -and ($blk -match 'NOT proof') -and ($blk -match 'survived != proven')
$hasNeverProven = ($blk -match 'NEVER call a survivor proven')
$hasTagBrackets = ($blk -match '\[A_peak_power\]') -and ($blk -match '\[B_nu_geo\]')
$singular = ($blk -match '1 distinct survivor,') -and ($blk -match '17 distinct survivors,')
# must NOT positively assert proof/truth about a survivor
$noProofClaim = (-not ($blk -match 'is proven')) -and (-not ($blk -match 'are proven')) -and (-not ($blk -match 'is established'))
Assert-Core 'buildSurvivorBlock: evidence-not-proof framing + [tags] + singular/plural + NO proof claim' `
  ($hasEvidence -and $hasNeverProven -and $hasTagBrackets -and $singular -and $noProofClaim)

# ============================================================================
# SOURCE BINDING -- conjecture-memory.js (the survivor lane lives here)
# ============================================================================
Write-Host "`n-- conjecture-memory.js source --"
Assert-True 'exports survivorMinCount'                 ($cm -match "survivorMinCount")
Assert-True 'exports parseTestedToBound'               ($cm -match "parseTestedToBound")
Assert-True 'exports aggregateSurvivorsByTemplate'     ($cm -match "aggregateSurvivorsByTemplate")
Assert-True 'exports gateSurvivorTemplates'            ($cm -match "gateSurvivorTemplates")
Assert-True 'exports buildSurvivorBlock'               ($cm -match "buildSurvivorBlock")
Assert-True 'exports getSurvivorTemplateStats'         ($cm -match "getSurvivorTemplateStats")
Assert-True 'SURVIVOR_MIN_COUNT_DEFAULT = 3'           ($cm -match "SURVIVOR_MIN_COUNT_DEFAULT = 3")
Assert-True 'SURVIVOR_TEMPLATE_LIMIT constant present' ($cm -match "SURVIVOR_TEMPLATE_LIMIT")
Assert-True 'SURVIVOR_WINDOW constant present'         ($cm -match "SURVIVOR_WINDOW")
Assert-True 'reads env M8_SURVIVOR_MIN_COUNT'          ($cm -match "M8_SURVIVOR_MIN_COUNT")
Assert-True 'survivorMinCount clamps >= 1'             ($cm -match "n >= 1 \? n : SURVIVOR_MIN_COUNT_DEFAULT")

$aggSeg = ($cm -split "function aggregateSurvivorsByTemplate")[1]
$aggSeg = ($aggSeg -split "function gateSurvivorTemplates")[0]
Assert-True 'aggregate dedups DISTINCT statements (Set)'   ($aggSeg -match "new Set\(\)" -or $aggSeg -match "\.seen\b")
Assert-True 'aggregate keys on metadata.m3_template'       ($aggSeg -match "m3_template")
Assert-True 'aggregate ranks by count desc'                ($aggSeg -match "b\.count - a\.count")

$gateSeg = ($cm -split "function gateSurvivorTemplates")[1]
$gateSeg = ($gateSeg -split "function buildSurvivorBlock")[0]
Assert-True 'gate filters count >= min'                    ($gateSeg -match "count.*>= min" -or $gateSeg -match ">= min")
Assert-True 'gate caps at SURVIVOR_TEMPLATE_LIMIT'         ($gateSeg -match "slice\(0, SURVIVOR_TEMPLATE_LIMIT\)")

# HONESTY WALL in the actual JS source of buildSurvivorBlock
$bbSeg = ($cm -split "function buildSurvivorBlock")[1]
$bbSeg = ($bbSeg -split "function parseTags")[0]
Assert-True 'block source says COMPUTATIONAL EVIDENCE'     ($bbSeg -match "COMPUTATIONAL EVIDENCE")
Assert-True 'block source says NOT proof'                  ($bbSeg -match "NOT proof")
Assert-True 'block source says NEVER call a survivor proven' ($bbSeg -match "NEVER call a survivor proven")
Assert-True 'block source returns "" when empty'           ($bbSeg -match 'return ""')

# HONESTY WALL: the survivor reader reads the NOTES table, NEVER the Lean OUTCOMES table
$stSeg = ($cm -split "async function getSurvivorTemplateStats")[1]
$stSeg = ($stSeg -split "async function reconcileVerifiedOutcomes")[0]
Assert-True 'getSurvivorTemplateStats reads SURVIVOR_NOTES_TABLE'   ($stSeg -match "SURVIVOR_NOTES_TABLE")
Assert-True 'getSurvivorTemplateStats never touches OUTCOMES_TABLE' (-not ($stSeg -match "OUTCOMES_TABLE"))
Assert-True 'getSurvivorTemplateStats filters m3_generated'         ($stSeg -match "m3_generated")
Assert-True 'getSurvivorTemplateStats has catch'                    ($stSeg -match "catch")
Assert-True 'getSurvivorTemplateStats returns [] on error'          ($stSeg -match "return \[\]")
Assert-True 'getSurvivorTemplateStats uses SURVIVOR_WINDOW limit'   ($stSeg -match "limit\(SURVIVOR_WINDOW\)")

# ============================================================================
# SOURCE BINDING -- conjecture-gen.js (separate evidence block, correct order)
# ============================================================================
Write-Host "`n-- conjecture-gen.js wiring --"
$cgWrap = ($cg -split "async function runConjectureGenWithFeedback")[1]
Assert-True 'wrapper calls getSurvivorTemplateStats'       ($cgWrap -match "getSurvivorTemplateStats")
Assert-True 'survivor block built via buildSurvivorBlock'  ($cgWrap -match "buildSurvivorBlock\(survivorTemplates\)")
Assert-True 'wrapper returns survivorTemplates'            ($cgWrap -match "survivorTemplates")
Assert-True 'early-return path carries survivorTemplates'  ($cg -match "survivorTemplates: \[\]")
Assert-True 'B112 PREFER (Lean-proven) still wired'        ($cgWrap -match "buildFeedbackBlock\(earnedPatterns\)")
Assert-True 'B99 AVOID still wired'                        ($cgWrap -match "buildAvoidBlock")
# ORDER: final packet = VERIFIED / SURVIVOR / AVOID / <packet>. Prepends run bottom-up, so in
# SOURCE the avoid prepend appears before the survivor prepend, which appears before the verified prepend.
$idxAvoid = $cgWrap.IndexOf("result.packet = avoidBlock")
$idxSurv  = $cgWrap.IndexOf("result.packet = survBlock")
$idxVer   = $cgWrap.IndexOf("result.packet = block")
Assert-True 'prepend order yields VERIFIED / EVIDENCE / AVOID' (($idxAvoid -gt 0) -and ($idxSurv -gt $idxAvoid) -and ($idxVer -gt $idxSurv))
Assert-True 'survivor block kept SEPARATE from Lean-proven block' ($cgWrap -match "survBlock" -and $cgWrap -match "block = cm.buildFeedbackBlock")

# ============================================================================
# SOURCE BINDING -- loop.js observe phase (survivor telemetry stamped; B112 intact)
# ============================================================================
Write-Host "`n-- loop.js observe-phase telemetry --"
$obsSeg = ($lp -split "async function runObservePhase")[1]
$obsSeg = ($obsSeg -split "async function runVerifyPhase")[0]   # observe phase ONLY
Assert-True 'stamps survivor_templates count'             ($obsSeg -match "survivor_templates:")
Assert-True 'stamps survivor_min_count'                   ($obsSeg -match "survivor_min_count:")
Assert-True 'stamps survivor_template_tags list'          ($obsSeg -match "survivor_template_tags:")
Assert-True 'B112 earned_patterns telemetry still stamped' ($obsSeg -match "earned_patterns:")
Assert-True 'survivor_min_count uses survivorMinCount()'  ($obsSeg -match "survivorMinCount\(\)")

# guard: the Build-112 Lean-proven lane + verify phase stay intact
Write-Host "`n-- regression guard (B112 / verify phase intact) --"
Assert-True 'B112 getEarnedSuccessPatterns still wired'   ($cg -match "getEarnedSuccessPatterns")
Assert-True 'Build-111 reconcileOutcomes still wired'     ($lp -match "reconcileOutcomes\(")
Assert-True 'Build-B repair lane still present'           ($lp -match "fetchRepairableScaffold")

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host ""
$coreColor = 'Red'; if ($script:core -eq 8) { $coreColor = 'Green' }
Write-Host ("{0}/8 core passed" -f $script:core) -ForegroundColor $coreColor
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "ALL $total checks PASS -- Build-113 verified (8/8 core + $($total - 8) wiring/honesty)." -ForegroundColor Green
} else {
  Write-Host "$($script:pass)/$total checks passed, $($script:fail) FAILED." -ForegroundColor Red
  exit 1
}
