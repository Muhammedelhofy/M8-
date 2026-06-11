# Odysseus Probe Validator -- tests/odysseus/validate.ps1
#
# Validates probe spec(s) against the ingestion contract. Checks: required fields,
# valid category, valid grader kinds, no LLM judges, non-duplicate IDs, weight range.
# Exits 0 if ALL probes pass, 1 if any fail.
#
# Usage:
#   powershell -File tests/odysseus/validate.ps1                       # all pending/
#   powershell -File tests/odysseus/validate.ps1 -File path/to/spec.json

param([string]$File = "")
$ErrorActionPreference = 'Stop'

$scriptDir  = $PSScriptRoot
$testsDir   = Split-Path $scriptDir -Parent
$evalDir    = Join-Path $testsDir 'eval'
$pendingDir = Join-Path $scriptDir 'pending'

# -- Contract constants --------------------------------------------------------
$VALID_CATS = @(
  'grounding','honesty','fleet_intel','reasoning','state_tracking','memory','latency',
  'compression','silent_fail','prompt_bypass','tutoring','tool_decision',
  'research_notebook','finance','odysseus_redteam'
)
$VALID_KINDS = @(
  'present','absent','refusal','flagsAssumption','citesNumber',
  'anyOf','capture','consistentWith','latencyScore','latencyUnder'
)
$BANNED_KINDS = @('llm','judge','llm_grade','llm_judge','model_grade','ai_check')

# -- Read existing probe IDs ---------------------------------------------------
$runnerPath    = Join-Path $evalDir 'run-eval-live.ps1'
$runnerContent = Get-Content $runnerPath -Raw
$existingIds   = [regex]::Matches($runnerContent, "id='([^']+)'") |
                 ForEach-Object { $_.Groups[1].Value }

# -- Helper: validate a checks array (recursive for anyOf) --------------------
# Outputs error strings directly to the pipeline; caller collects with @(...)
function ValidateChecks([array]$checks, [string]$path) {
  foreach ($c in $checks) {
    $k = if ($c.kind) { $c.kind.ToLower() } else { '' }
    if (-not $k) { "${path}: check missing 'kind'"; continue }
    if ($BANNED_KINDS -contains $k) {
      "$path kind '$k' is a non-deterministic LLM judge -- REJECTED"
      continue
    }
    if ($VALID_KINDS -notcontains $k) {
      "$path kind '$k' is unknown (valid: $($VALID_KINDS -join ', '))"
    }
    if ($k -in @('present','absent') -and -not $c.re) {
      "$path kind='$k' requires a 're' (regex string) field"
    }
    if ($k -eq 'anyof') {
      $sub = $c.checks
      if (-not $sub -or @($sub).Count -eq 0) {
        "$path anyOf missing 'checks' sub-array"
      } else {
        ValidateChecks (@($sub)) "$path > anyOf"
      }
    }
  }
}

# -- Helper: validate a single probe object -----------------------------------
# Outputs error strings directly to the pipeline; caller collects with @(...)
function ValidateProbe($p) {
  # Required top-level fields
  if (-not $p.id)              { "Missing required field: id" }
  if (-not $p.category)        { "Missing required field: category" }
  if (-not $p.title)           { "Missing required field: title" }
  if ($null -eq $p.weight)     { "Missing required field: weight" }
  if ($null -eq $p.turns)      { "Missing required field: turns" }
  if (-not $p.note)            { "Missing required field: note" }

  # Category validation
  if ($p.category -and $VALID_CATS -notcontains $p.category) {
    "category '$($p.category)' not in valid list (valid: $($VALID_CATS -join ', '))"
  }

  # Weight range
  if ($null -ne $p.weight) {
    $w = [double]$p.weight
    if ($w -lt 0.5 -or $w -gt 2.0) { "weight $w out of range [0.5, 2.0]" }
  }

  # Duplicate ID check
  if ($p.id -and $existingIds -contains $p.id) {
    "id '$($p.id)' duplicates an existing probe -- choose a unique id"
  }

  # Turns validation
  if ($null -ne $p.turns) {
    $turns = @($p.turns)
    if ($turns.Count -eq 0) { "turns must have at least 1 element" }
    for ($i = 0; $i -lt $turns.Count; $i++) {
      $t = $turns[$i]
      if (-not $t.send) { "turns[$i] missing 'send'" }
      if ($t.checks) { ValidateChecks (@($t.checks)) "turns[$i].checks" }
    }
  }
}

# -- Determine files to validate -----------------------------------------------
if ($File) {
  $files = @((Resolve-Path $File).Path)
} else {
  $files = @(Get-ChildItem $pendingDir -Filter '*.json' -ErrorAction SilentlyContinue |
             Select-Object -ExpandProperty FullName)
  if ($files.Count -eq 0) {
    Write-Host "No pending probe files in $pendingDir -- nothing to validate."
    exit 0
  }
}

# -- Validate ------------------------------------------------------------------
$allPassed = $true
$totalPass = 0; $totalFail = 0

foreach ($f in $files) {
  Write-Host "`nValidating: $(Split-Path $f -Leaf)"
  $content = Get-Content $f -Raw | ConvertFrom-Json
  $probes  = if ($content -is [array]) { $content } else { @($content) }

  foreach ($p in $probes) {
    $errs = @(ValidateProbe $p)
    $id   = if ($p.id) { $p.id } else { "(no id)" }
    if ($errs.Count -eq 0) {
      Write-Host ("  {0,-42} PASS" -f $id) -ForegroundColor Green
      $totalPass++
    } else {
      $allPassed = $false; $totalFail++
      Write-Host ("  {0,-42} FAIL" -f $id) -ForegroundColor Red
      foreach ($e in $errs) { Write-Host "    ! $e" -ForegroundColor Yellow }
    }
  }
}

Write-Host "`n$totalPass passed / $totalFail failed"
if ($allPassed) {
  Write-Host "All valid. Next: powershell -File tests/odysseus/ingest.ps1 -File '<path>'" -ForegroundColor Green
  exit 0
} else {
  Write-Host "Fix the errors above before ingesting." -ForegroundColor Red
  exit 1
}
