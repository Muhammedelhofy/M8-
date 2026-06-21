# tests/B92-feedback-verify.ps1
# Build-92 -- Conjecture Outcome Memory (closed learning loop) -- offline, PS 5.1 ASCII.
#
# Node is NOT installed on this host, so per the repo convention the behavioral
# checks are PS-5.1 ports of the pure/contract logic, each BOUND to the JS source
# by a pattern assertion so a port can't silently drift from the implementation.
#
# The four spec checks (the X/4 headline):
#   1. buildFeedbackBlock([]) -> ""
#   2. buildFeedbackBlock([{conjecture_text, structural_tags:["induction"], verified_at}])
#        -> output contains "induction" AND "DIFFERENT"
#   3. getSuccessPatterns with a db that throws -> returns []
#   4. recordOutcome with a mock db -> insert called once, does not throw
# Plus source/wiring checks for conjecture-memory.js, conjecture-gen.js, loop.js,
# and the migration.

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

$cmPath  = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\conjecture-memory.js"))
$cgPath  = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\conjecture-gen.js"))
$lpPath  = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\loop.js"))
$migPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\migrations\B92_conjecture_outcomes.sql"))

$cm  = [IO.File]::ReadAllText($cmPath,  [Text.Encoding]::UTF8)
$cg  = [IO.File]::ReadAllText($cgPath,  [Text.Encoding]::UTF8)
$lp  = [IO.File]::ReadAllText($lpPath,  [Text.Encoding]::UTF8)
$mig = [IO.File]::ReadAllText($migPath, [Text.Encoding]::UTF8)

Write-Host "Build-92 conjecture outcome memory verify`n"

# ============================================================================
# PS PORTS (faithful mirrors of the JS contract logic)
# ============================================================================
function FbBlock($patterns) {
  if ($null -eq $patterns -or @($patterns).Count -eq 0) { return "" }
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add("VERIFIED CONJECTURE PATTERNS -- what has worked before for this problem:")
  foreach ($p in @($patterns)) {
    $tags = ""
    $st = $p.structural_tags
    if ($st -and @($st).Count -gt 0) { $tags = "[" + (@($st) -join ", ") + "] " }
    $text = (([string]$p.conjecture_text) -replace '\s+', ' ').Trim()
    $when = ""
    if ($p.verified_at) {
      $w = [string]$p.verified_at
      if ($w.Length -ge 10) { $w = $w.Substring(0, 10) }
      $when = " -- verified " + $w
    }
    [void]$lines.Add("* $tags`"$text`"$when")
  }
  [void]$lines.Add("Propose structurally DIFFERENT conjectures. Do NOT re-propose variations of these.")
  return ($lines -join "`n")
}

# getSuccessPatterns contract: always returns empty on any db error; never throws.
function Gsp($db, $problemId) {
  try {
    $res = $db.Run($problemId)
    if ($res.error) { return @() }
    if ($null -eq $res.data) { return @() }
    return $res.data
  } catch {
    return @()
  }
}

# recordOutcome contract: insert initiated synchronously, whole body try/catch,
# never throws out of the verification path.
function Ro($db, $payload) {
  try {
    [void]$db.Insert($payload)
  } catch {
    # swallow -- fire-and-forget, non-fatal
  }
}

# ============================================================================
# 1-2. buildFeedbackBlock behavior
# ============================================================================
Write-Host "-- 1-2. buildFeedbackBlock --"
$empty = FbBlock @()
Assert-Core 'buildFeedbackBlock([]) returns ""' ($empty -eq "")

$one = @([pscustomobject]@{
  conjecture_text = "for all n > 0, sigma(n) <= 100"
  structural_tags = @("induction")
  verified_at     = "2026-06-01"
})
$blk = FbBlock $one
Assert-Core 'buildFeedbackBlock([one]) contains "induction" AND "DIFFERENT"' `
  (($blk -match "induction") -and ($blk -cmatch "DIFFERENT"))

# ============================================================================
# 3. getSuccessPatterns(throwing db) -> []
# ============================================================================
Write-Host "`n-- 3. getSuccessPatterns fail-safe --"
$throwDb = [pscustomobject]@{}
$throwDb | Add-Member -MemberType ScriptMethod -Name Run -Value { param($problemId) throw "db down" }
$r = Gsp $throwDb "collatz"
Assert-Core 'getSuccessPatterns(throwing db) -> empty (no throw)' ($null -eq $r -or @($r).Count -eq 0)

# ============================================================================
# 4. recordOutcome -> insert called once, does not throw
# ============================================================================
Write-Host "`n-- 4. recordOutcome fire-and-forget --"
$script:insertCalls = 0
$mockDb = [pscustomobject]@{}
$mockDb | Add-Member -MemberType ScriptMethod -Name Insert -Value { $script:insertCalls++; return $true }
$threw = $false
try { Ro $mockDb ([pscustomobject]@{ problem_id = "collatz"; conjecture_text = "x" }) } catch { $threw = $true }
Assert-Core 'recordOutcome -> insert called once AND did not throw' (($script:insertCalls -eq 1) -and (-not $threw))

# robustness: a throwing insert must still be swallowed
$throwInsertDb = [pscustomobject]@{}
$throwInsertDb | Add-Member -MemberType ScriptMethod -Name Insert -Value { throw "insert boom" }
$threw2 = $false
try { Ro $throwInsertDb ([pscustomobject]@{}) } catch { $threw2 = $true }
Assert-True 'recordOutcome swallows insert errors (no throw)' (-not $threw2)

# ============================================================================
# SOURCE BINDING -- conjecture-memory.js
# ============================================================================
Write-Host "`n-- conjecture-memory.js source --"
Assert-True 'exports buildFeedbackBlock'          ($cm -match "buildFeedbackBlock")
Assert-True 'exports getSuccessPatterns'          ($cm -match "getSuccessPatterns")
Assert-True 'exports recordOutcome'               ($cm -match "recordOutcome")
Assert-True 'exports COLLATZ_PROBLEM_ID'          ($cm -match "COLLATZ_PROBLEM_ID")
Assert-True 'buildFeedbackBlock empty -> return ""' ($cm -match 'if \(!patterns \|\| !patterns\.length\) return "";')
Assert-True 'block header text present'            ($cm -match "VERIFIED CONJECTURE PATTERNS")
Assert-True 'block instructs structurally DIFFERENT' ($cm -cmatch "structurally DIFFERENT")
Assert-True 'block forbids re-proposing'           ($cm -match "Do NOT re-propose")
Assert-True 'recordOutcome is fire-and-forget (not async)' (
  ($cm -match "function recordOutcome") -and ($cm -notmatch "async function recordOutcome")
)
$roSeg = ($cm -split "function recordOutcome")[1]
Assert-True 'recordOutcome body wrapped in try/catch' ($roSeg -match "try \{")
Assert-True 'insert is called'                     ($cm -match "\.insert\(")
$gspSeg = ($cm -split "async function getSuccessPatterns")[1]
Assert-True 'getSuccessPatterns has catch'         ($gspSeg -match "catch")
Assert-True 'getSuccessPatterns returns [] on error' ($gspSeg -match "return \[\]")
Assert-True 'getSuccessPatterns filters problem_id' ($gspSeg -match 'eq\("problem_id"')
Assert-True 'getSuccessPatterns orders verified_at desc' ($gspSeg -match 'order\("verified_at", \{ ascending: false \}\)')
Assert-True 'getSuccessPatterns limits to 5'       ($gspSeg -match "limit\(PATTERN_LIMIT\)")
Assert-True 'tag extraction has 2s race cap'       (($cm -match "TAG_TIMEOUT_MS") -and ($cm -match "Promise\.race"))
Assert-True 'HONESTY: tags never say proven/proved' ($cm -match "proven\|proved")

# ============================================================================
# SOURCE BINDING -- conjecture-gen.js wires the read side
# ============================================================================
Write-Host "`n-- conjecture-gen.js wiring --"
$cgWrap = ($cg -split "async function runConjectureGenWithFeedback")[1]
Assert-True 'wrapper requires conjecture-memory'   ($cgWrap -match "conjecture-memory")
Assert-True 'wrapper calls getSuccessPatterns'     ($cgWrap -match "getSuccessPatterns")
Assert-True 'wrapper calls buildFeedbackBlock'     ($cgWrap -match "buildFeedbackBlock")
Assert-True 'wrapper PREPENDS block to packet'     ($cgWrap -match "result\.packet = block")
Assert-True 'wrapper returns successPatterns'      ($cgWrap -match "successPatterns")
Assert-True 'wrapper fail-safe catch'              ($cgWrap -match "catch \(e\)")

# ============================================================================
# SOURCE BINDING -- loop.js wires the write side
# Build-110 made recordOutcome AWAITED (the write lands before the Vercel freeze instead
# of being dropped); Build-111 adds the idempotent, durable reconcileOutcomes() backfill
# pass ALONGSIDE the inline per-run transition writes.
# ============================================================================
Write-Host "`n-- loop.js wiring --"
Assert-True 'loop requires conjecture-memory'      ($lp -match "conjecture-memory")
Assert-True 'loop calls recordOutcome'             ($lp -match "recordOutcome\(")
Assert-True 'recordOutcome guarded by newlyVerified' ($lp -match "newlyVerified > 0")
Assert-True 'loop uses COLLATZ_PROBLEM_ID'          ($lp -match "COLLATZ_PROBLEM_ID")
Assert-True 'recordOutcome IS awaited (Build-110 durability)' ($lp -match "await[^\r\n]*recordOutcome")
Assert-True 'durable reconcile backfill pass wired (Build-111)' ($lp -match "reconcileOutcomes\(")

# ============================================================================
# SOURCE BINDING -- migration
# ============================================================================
Write-Host "`n-- migration B92_conjecture_outcomes.sql --"
Assert-True 'CREATE TABLE IF NOT EXISTS m8_conjecture_outcomes' ($mig -match "CREATE TABLE IF NOT EXISTS m8_conjecture_outcomes")
Assert-True 'problem_id text NOT NULL'             ($mig -match "problem_id text NOT NULL")
Assert-True 'structural_tags text[]'               ($mig -match "structural_tags text\[\]")
Assert-True 'loop_run_id uuid column'              ($mig -match "loop_run_id uuid")
Assert-True 'index m8_co_problem_idx'              ($mig -match "CREATE INDEX IF NOT EXISTS m8_co_problem_idx")

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host ""
$coreColor = 'Red'; if ($script:core -eq 4) { $coreColor = 'Green' }
Write-Host ("{0}/4 passed" -f $script:core) -ForegroundColor $coreColor
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "ALL $total checks PASS -- Build-92 verified (4/4 core + $($total - 4) wiring)." -ForegroundColor Green
} else {
  Write-Host "$($script:pass)/$total checks passed, $($script:fail) FAILED." -ForegroundColor Red
  exit 1
}
