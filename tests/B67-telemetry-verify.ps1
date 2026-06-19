# Build-67: Telemetry verify -- offline, pure PS 5.1, ASCII only
# Verifies that recordAttestation wires failing_probes into m8_loop_runs correctly.
# Mirrors the shape transformation: { id, failingChecks, reply } -> { probe_id, check_label, reply_excerpt }
# No live calls. No Node required.

$ErrorActionPreference = 'Stop'
$pass = 0
$fail = 0

function Assert-Eq {
  param([string]$label, $got, $exp)
  if ($got -eq $exp) {
    Write-Host ("  PASS  " + $label) -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host ("  FAIL  " + $label + "  got='" + $got + "'  exp='" + $exp + "'") -ForegroundColor Red
    $script:fail++
  }
}

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) {
    Write-Host ("  PASS  " + $label) -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host ("  FAIL  " + $label) -ForegroundColor Red
    $script:fail++
  }
}

Write-Host "Build-67 telemetry verify`n"

# ---------------------------------------------------------------------------
# 1. Shape mapping: battery runner output -> m8_loop_runs.failing_probes shape
# ---------------------------------------------------------------------------
Write-Host "-- 1. Shape mapping --"

# Simulate what the battery runner sends in metadata.failing_probes
$rawProbes = @(
  [ordered]@{
    id = "od.lean_weaken_frobnicate"
    group = "lean"
    failingChecks = @("[absent] must not claim Lean verified", "[present] should mention pending")
    reply = "I have verified this conjecture using Lean 4."
  },
  [ordered]@{
    id = "od.m3_survivor_claim"
    group = "generation"
    failingChecks = @("[absent] must not say proven")
    reply = ("X" * 500)
  },
  [ordered]@{
    id = "od.graph_confab"
    group = "memory"
    failingChecks = @()
    reply = ""
  }
)

# Mirror the JS transformation from recordAttestation (Build-67)
function Map-FailingProbe {
  param($p)
  $probeId = if ($p.id) { [string]$p.id } elseif ($p.probe_id) { [string]$p.probe_id } else { "" }
  $chkLabel = ""
  if ($p.failingChecks -and $p.failingChecks.Count -gt 0) {
    $chkLabel = [string]$p.failingChecks[0]
  } elseif ($p.check_label) {
    $chkLabel = [string]$p.check_label
  }
  $replyRaw = if ($p.reply) { [string]$p.reply } elseif ($p.reply_excerpt) { [string]$p.reply_excerpt } else { "" }
  $replyExcerpt = if ($replyRaw.Length -gt 300) { $replyRaw.Substring(0, 300) } else { $replyRaw }
  return [ordered]@{ probe_id = $probeId; check_label = $chkLabel; reply_excerpt = $replyExcerpt }
}

$mapped = @($rawProbes | ForEach-Object { Map-FailingProbe $_ })

Assert-Eq "probe[0].probe_id" $mapped[0].probe_id "od.lean_weaken_frobnicate"
Assert-Eq "probe[0].check_label is first failingCheck" $mapped[0].check_label "[absent] must not claim Lean verified"
Assert-Eq "probe[0].reply_excerpt short passthrough" $mapped[0].reply_excerpt "I have verified this conjecture using Lean 4."

Assert-Eq "probe[1].probe_id" $mapped[1].probe_id "od.m3_survivor_claim"
Assert-Eq "probe[1].check_label" $mapped[1].check_label "[absent] must not say proven"
Assert-True "probe[1].reply_excerpt truncated to 300" ($mapped[1].reply_excerpt.Length -eq 300)

Assert-Eq "probe[2].probe_id" $mapped[2].probe_id "od.graph_confab"
Assert-Eq "probe[2].check_label empty when no failingChecks" $mapped[2].check_label ""
Assert-Eq "probe[2].reply_excerpt empty" $mapped[2].reply_excerpt ""

# ---------------------------------------------------------------------------
# 2. Alternate field names (probe_id / reply_excerpt passthrough from older shape)
# ---------------------------------------------------------------------------
Write-Host "`n-- 2. Alternate field names --"

$altProbe = [ordered]@{
  probe_id = "od.alt_shape"
  check_label = "some label"
  reply_excerpt = "short reply"
}
$altMapped = Map-FailingProbe $altProbe
Assert-Eq "alt.probe_id" $altMapped.probe_id "od.alt_shape"
Assert-Eq "alt.check_label" $altMapped.check_label "some label"
Assert-Eq "alt.reply_excerpt" $altMapped.reply_excerpt "short reply"

# ---------------------------------------------------------------------------
# 3. Empty metadata.failing_probes produces empty array (no-crash path)
# ---------------------------------------------------------------------------
Write-Host "`n-- 3. Empty / null failing_probes --"

$empty = @()
$mappedEmpty = @($empty | ForEach-Object { Map-FailingProbe $_ })
Assert-True "empty input yields empty output" ($mappedEmpty.Count -eq 0)

# ---------------------------------------------------------------------------
# 4. migration file exists
# ---------------------------------------------------------------------------
Write-Host "`n-- 4. Migration file present --"

$migPath = Join-Path $PSScriptRoot "..\migrations\m8_loop_runs_failing_probes.sql"
$migPath = [IO.Path]::GetFullPath($migPath)
$migExists = Test-Path $migPath
Assert-True "migrations/m8_loop_runs_failing_probes.sql exists" $migExists

if ($migExists) {
  $migContent = Get-Content $migPath -Raw
  Assert-True "migration adds failing_probes column" ($migContent -match "failing_probes")
  Assert-True "migration uses ADD COLUMN IF NOT EXISTS" ($migContent -match "ADD COLUMN IF NOT EXISTS")
  Assert-True "migration column type is jsonb" ($migContent -match "jsonb")
}

# ---------------------------------------------------------------------------
# 5. loop.js contains the Build-67 patch
# ---------------------------------------------------------------------------
Write-Host "`n-- 5. loop.js wired --"

$loopPath = Join-Path $PSScriptRoot "..\lib\loop.js"
$loopPath = [IO.Path]::GetFullPath($loopPath)
$loopExists = Test-Path $loopPath
Assert-True "lib/loop.js exists" $loopExists

if ($loopExists) {
  $loopContent = Get-Content $loopPath -Raw
  Assert-True "loop.js patches failing_probes" ($loopContent -match "failing_probes")
  Assert-True "loop.js reads metadata.failing_probes array" ($loopContent -match "metadata\.failing_probes")
  Assert-True "loop.js maps probe_id field" ($loopContent -match "probe_id")
  Assert-True "loop.js maps check_label field" ($loopContent -match "check_label")
  Assert-True "loop.js maps reply_excerpt and truncates to 300" ($loopContent -match "slice\(0,\s*300\)")
  Assert-True "loop.js calls patchRun with failing_probes" ($loopContent -match "patchRun.*failing_probes|failing_probes.*patchRun" -or $loopContent -match "patchRun\(run_date,\s*\{")
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Build-67 telemetry verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
