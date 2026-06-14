# ============================================================================
# M8 Build-19 (L5) -- PS mirror of lib/loop.js PURE CORE
# ----------------------------------------------------------------------------
# No local Node in this env, so the deterministic core (seed rotation, promotion
# gate, regression diff, digest template, backoff) is re-implemented here and
# asserted to match the JS contract. Pure ASCII (PS 5.1 reads a no-BOM UTF-8 .ps1
# as ANSI). Run:  powershell -File tests/loop-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- mirrors of lib/loop.js pure functions ---------------------------------
$SEED_BASE = 20260601
$CLEAN_RUN_TARGET = 3
$BACKOFF_K = 5

function DayIndex([string]$d) {
  $dt    = [datetime]::SpecifyKind([datetime]::ParseExact($d, 'yyyy-MM-dd', $null), 'Utc')
  $epoch = [datetime]::SpecifyKind([datetime]'1970-01-01', 'Utc')
  return [int][math]::Floor(($dt - $epoch).TotalDays)
}
function NextSeed([string]$d, [int]$base = $SEED_BASE) { return [int64]($base + (DayIndex $d)) }

function DiffRegressions($baseline, $current) {
  $regs = @()
  foreach ($id in $baseline.Keys) {
    if (($baseline[$id] -eq $true) -and ($current.Contains($id)) -and ($current[$id] -eq $false)) {
      $regs += $id
    }
  }
  return $regs
}

function EvaluatePromotionGate($rows, [int]$target = $CLEAN_RUN_TARGET) {
  $clean = 0
  foreach ($r in $rows) {
    $ok = ($r.run_status -eq 'ok') -and ($r.m3_gate_pass -eq $true) -and (([int]$r.survivors_persisted) -ge 1) `
          -and ($r.odysseus_pass -eq $true) -and ($r.odysseus_fresh -eq $true)
    if ($ok) { $clean++ } else { break }
  }
  return @{ promoted = ($clean -ge $target); consecutiveClean = $clean; target = $target }
}

function CountLeadingFailures($rows) {
  $n = 0
  foreach ($r in $rows) { if (($r.run_status -eq 'failed') -or ($r.run_status -eq 'degraded')) { $n++ } else { break } }
  return $n
}

function ShouldBackoff($rows, [int]$k = $BACKOFF_K) {
  if (@($rows).Count -lt $k) { return $false }
  $window = @($rows)[0..($k-1)]
  foreach ($r in $window) { if ((([int]$r.new_survivors) -ne 0) -or (([int]$r.m1_census_nodes) -ne 0)) { return $false } }
  return $true
}

function BuildDigest($r, $g) {
  $lines = @()
  $lines += "M8 AUTONOMOUS LOOP -- run $($r.run_date) (deterministic digest; no model wrote this)."
  $lines += "M3 generator (seed $($r.seed)): $($r.m3_mined) mined, $($r.survivors_persisted) survivor(s) persisted ($($r.new_survivors) new); gate-v2 $(if($r.m3_gate_pass){'PASS'}else{'FAIL'})."
  $lines += "These are MACHINE-GENERATED conjectures, tested to $($r.bound) only -- NOT proven, NOT novel, NOT established. The gate measures GENERATION QUALITY, not truth."
  if ($r.m4_attempted) {
    $lines += "M4 re-check (warm Lean window): leaves verified $($r.m4_leaves_verified) / $($r.m4_leaf_total) on a human-architected scaffold. A verified leaf is one Lean machine-check, NOT a proof of the target; the target stays an OPEN CONJECTURE."
  } else {
    $lines += "M4: $(if($r.lean_ready){'no human-architected scaffold awaiting re-check'}else{'Lean checker cold -- skipped (the run still counts)'})."
  }
  $lines += "Loop status: $($g.consecutiveClean)/$($g.target) consecutive clean run(s)$(if($g.promoted){' -- PROMOTED'}else{''}). Promotion means the autonomous loop is STABLE (ran clean, zero Odysseus regressions, produced survivors) -- it does NOT mean any conjecture is proven or novel."
  return ($lines -join "`n")
}

Write-Host "`nM8 L5 (Build-19) -- loop pure-core mirror`n"

# ---- 1. seed rotation -------------------------------------------------------
$d1 = '2026-06-14'; $d2 = '2026-06-15'
Ok ((NextSeed $d2) - (NextSeed $d1) -eq 1) "nextSeed advances by exactly 1 per day"
Ok ((NextSeed $d1) -eq (NextSeed $d1))     "nextSeed deterministic (same date -> same seed)"
Ok ((NextSeed $d1) -gt $SEED_BASE)         "nextSeed > SEED_BASE for a 2026 date"

# ---- 2. promotion gate ------------------------------------------------------
$clean = @{ run_status='ok'; m3_gate_pass=$true; survivors_persisted=3; odysseus_pass=$true; odysseus_fresh=$true }
$threeClean = @($clean.Clone(), $clean.Clone(), $clean.Clone())
$g = EvaluatePromotionGate $threeClean
Ok ($g.promoted -eq $true -and $g.consecutiveClean -eq 3) "3 consecutive clean runs -> PROMOTED"

$twoClean = @($clean.Clone(), $clean.Clone())
Ok ((EvaluatePromotionGate $twoClean).promoted -eq $false) "only 2 clean -> not promoted"

$degraded = @{ run_status='degraded'; m3_gate_pass=$true; survivors_persisted=3; odysseus_pass=$true; odysseus_fresh=$true }
$brokeStreak = @($clean.Clone(), $degraded.Clone(), $clean.Clone(), $clean.Clone())
$gd = EvaluatePromotionGate $brokeStreak
Ok ($gd.promoted -eq $false -and $gd.consecutiveClean -eq 1) "a degraded run in the window resets the streak"

$reg = @{ run_status='ok'; m3_gate_pass=$true; survivors_persisted=3; odysseus_pass=$false; odysseus_fresh=$true }
$withReg = @($reg.Clone(), $clean.Clone(), $clean.Clone(), $clean.Clone())
Ok ((EvaluatePromotionGate $withReg).promoted -eq $false) "an Odysseus regression (pass=false) blocks promotion"

$stale = @{ run_status='ok'; m3_gate_pass=$true; survivors_persisted=3; odysseus_pass=$true; odysseus_fresh=$false }
$withStale = @($stale.Clone(), $clean.Clone(), $clean.Clone(), $clean.Clone())
Ok ((EvaluatePromotionGate $withStale).promoted -eq $false) "a stale (>24h) attestation is not counted"

$noSurv = @{ run_status='ok'; m3_gate_pass=$true; survivors_persisted=0; odysseus_pass=$true; odysseus_fresh=$true }
$withNoSurv = @($noSurv.Clone(), $clean.Clone(), $clean.Clone())
Ok ((EvaluatePromotionGate $withNoSurv).promoted -eq $false) "0 survivors blocks promotion (>=1 required)"

# ---- 3. regression diff -----------------------------------------------------
$baseline = @{ 'a'=$true; 'b'=$true; 'c'=$true }
$curRegress = @{ 'a'=$true; 'b'=$false; 'c'=$true }
$r1 = DiffRegressions $baseline $curRegress
Ok (@($r1).Count -eq 1 -and $r1[0] -eq 'b') "baseline-true -> now-false is a regression"

$curClean = @{ 'a'=$true; 'b'=$true; 'c'=$true }
Ok (@(DiffRegressions $baseline $curClean).Count -eq 0) "all-pass -> zero regressions"

$curNewFail = @{ 'a'=$true; 'b'=$true; 'c'=$true; 'd'=$false }
Ok (@(DiffRegressions $baseline $curNewFail).Count -eq 0) "a net-new fail (absent from baseline) is NOT a regression"

# ---- 4. backoff -------------------------------------------------------------
$zero = @{ new_survivors=0; m1_census_nodes=0 }
$fiveZero = @($zero.Clone(), $zero.Clone(), $zero.Clone(), $zero.Clone(), $zero.Clone())
Ok ((ShouldBackoff $fiveZero) -eq $true) "5 consecutive zero-progress runs -> backoff"

$someNew = @($zero.Clone(), @{ new_survivors=2; m1_census_nodes=0 }, $zero.Clone(), $zero.Clone(), $zero.Clone())
Ok ((ShouldBackoff $someNew) -eq $false) "a single new survivor in the window -> no backoff"

$fourZero = @($zero.Clone(), $zero.Clone(), $zero.Clone(), $zero.Clone())
Ok ((ShouldBackoff $fourZero) -eq $false) "fewer than K runs -> no backoff"

# ---- 5. leading failures ----------------------------------------------------
$fails = @($degraded.Clone(), @{ run_status='failed' }, @{ run_status='degraded' }, $clean.Clone())
Ok ((CountLeadingFailures $fails) -eq 3) "counts the leading failed/degraded streak (3)"
Ok ((CountLeadingFailures $threeClean) -eq 0) "no leading failures on a clean window"

# ---- 6. digest honesty (template, no model) ---------------------------------
$row = @{ run_date='2026-06-14'; seed=20280615; bound=100000; m3_mined=120; survivors_persisted=5; new_survivors=4; m3_gate_pass=$true; m4_attempted=$true; m4_leaves_verified=1; m4_leaf_total=2; lean_ready=$true }
$gp  = @{ consecutiveClean=3; target=3; promoted=$true }
$digest = BuildDigest $row $gp

Ok ($digest -match '(?i)machine-generated')          "digest carries 'machine-generated'"
Ok ($digest -match '(?i)tested to')                  "digest carries 'tested to N'"
Ok ($digest -match '(?i)generation quality')         "digest carries 'generation quality, not truth'"
Ok ($digest -match '(?i)NOT proven')                 "digest carries the 'NOT proven' framing"
Ok ($digest -match '(?i)STABLE')                     "digest says promotion = loop STABLE"
Ok ($digest -match '(?i)open conjecture')            "digest: target stays an OPEN CONJECTURE"
# absent: NO affirmative upgrade phrasing (negated forms like 'NOT proven' are fine)
Ok (-not ($digest -match '(?i)breakthrough'))                       "digest: no 'breakthrough'"
Ok (-not ($digest -match '(?i)\bnow\s+proven\b'))                   "digest: never 'now proven' (negated 'NOT proven' is fine)"
Ok (-not ($digest -match '(?i)novel\s+result'))                    "digest: no 'novel result'"
Ok (-not ($digest -match '(?i)found\s+a\s+proof'))                 "digest: no 'found a proof'"
Ok (-not ($digest -match '(?i)discovered\s+a\b'))                  "digest: no 'discovered a ...'"
Ok (-not ($digest -match '(?i)proven\s+(?:result|theorem)\b'))     "digest: no 'proven result/theorem'"

# cold-skip digest variant
$coldRow = @{ run_date='2026-06-14'; seed=1; bound=100000; m3_mined=120; survivors_persisted=2; new_survivors=2; m3_gate_pass=$true; m4_attempted=$false; lean_ready=$false }
$coldDigest = BuildDigest $coldRow @{ consecutiveClean=1; target=3; promoted=$false }
Ok ($coldDigest -match '(?i)cold')                   "cold-skip digest says the checker was cold / skipped"
Ok (-not ($coldDigest -match '(?i)PROMOTED'))        "non-promoted digest omits PROMOTED"

# ---- tally ------------------------------------------------------------------
Write-Host ("`n==== loop-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
if ($script:fail) { exit 1 }
