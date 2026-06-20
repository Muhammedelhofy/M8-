# ============================================================================
# Build-96: Driver Nudge Logging -- offline verifier (PS 5.1, no Node).
#   powershell -File tests/B96-nudge-log-verify.ps1
#
# Node is not on the box, so Part 1 is a PowerShell MIRROR of the PURE logic in
# lib/nudge-logger.js (buildRow validation, toPreview, toNum, clampDays, and the
# summarize aggregation) kept in lockstep with the JS, run over the spec cases.
# Part 2 is static wiring: the lib exports the right surface, the migration is
# present, nudges.js logs each draft, morning-brief.js rolls up the weekly line,
# and the api endpoint is wired. Pure ASCII source (PS 5.1 reads no-BOM as ANSI).
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- PURE-LOGIC MIRROR of lib/nudge-logger.js ------------------------------
$PREVIEW_MAX = 120

# toPreview: trim, then cap at PREVIEW_MAX chars. null -> "".
function ToPreview($t) {
  if ($null -eq $t) { return "" }
  $s = ([string]$t).Trim()
  if ($s.Length -gt $PREVIEW_MAX) { return $s.Substring(0, $PREVIEW_MAX) }
  return $s
}

# toNum: a finite number or $null (mirrors Number()+Number.isFinite guard).
function ToNum($v) {
  $d = 0.0
  if ([double]::TryParse([string]$v, [ref]$d)) { return $d }
  return $null
}

# clampDays: floor; non-finite or <=0 -> 7; cap 365.
function ClampDays($days) {
  $n = 0.0
  if (-not [double]::TryParse([string]$days, [ref]$n)) { return 7 }
  $f = [math]::Floor($n)
  if ($f -le 0) { return 7 }
  if ($f -gt 365) { return 365 }
  return [int]$f
}

# buildRow: requires driverName + toneBucket (the two NOT-NULL columns). Returns
# a hashtable @{ ok; reason } or @{ ok; row }.
function BuildRow($pName, $pTone, $pPreview, $pReason, $pNet) {
  $nm = ''; if ($null -ne $pName) { $nm = ([string]$pName).Trim() }
  $tn = ''; if ($null -ne $pTone) { $tn = ([string]$pTone).Trim() }
  if ($nm.Length -eq 0) { return @{ ok = $false; reason = 'missing driverName' } }
  if ($tn.Length -eq 0) { return @{ ok = $false; reason = 'missing toneBucket' } }
  $rs = ''; if ($null -ne $pReason) { $rs = ([string]$pReason).Trim() }
  $rsVal = $null; if ($rs.Length -gt 0) { $rsVal = $rs }
  $row = @{
    driver_name     = $nm
    tone_bucket     = $tn
    message_preview = (ToPreview $pPreview)
    trigger_reason  = $rsVal
    driver_net_sar  = (ToNum $pNet)
  }
  return @{ ok = $true; row = $row }
}

# summarize: totalSent + byTone + driversNudged (first-seen order) + byDriver.
# byDriver uses key 'c' for count to dodge the hashtable .Count property clash;
# all key access is via the indexer for the same reason.
function Summarize($rows) {
  $byTone = @{}
  $byDriver = @{}
  $driversNudged = New-Object System.Collections.ArrayList
  foreach ($r in $rows) {
    $tone = 'unknown'
    if ($null -ne $r.tone_bucket -and ([string]$r.tone_bucket).Trim().Length -gt 0) {
      $tone = ([string]$r.tone_bucket).Trim()
    }
    if ($byTone.ContainsKey($tone)) { $byTone[$tone] = $byTone[$tone] + 1 } else { $byTone[$tone] = 1 }
    $name = ''
    if ($null -ne $r.driver_name) { $name = ([string]$r.driver_name).Trim() }
    if ($name.Length -eq 0) { continue }
    if (-not $byDriver.ContainsKey($name)) {
      $byDriver[$name] = @{ c = 0; tones = (New-Object System.Collections.ArrayList) }
      [void]$driversNudged.Add($name)
    }
    $byDriver[$name]['c'] = $byDriver[$name]['c'] + 1
    if (-not ($byDriver[$name]['tones'] -contains $tone)) { [void]$byDriver[$name]['tones'].Add($tone) }
  }
  $total = 0
  if ($null -ne $rows) { $total = @($rows).Count }
  return @{ totalSent = $total; byTone = $byTone; driversNudged = $driversNudged; byDriver = $byDriver }
}

Write-Host "`n-- buildRow validation (driverName + toneBucket required) --" -ForegroundColor Cyan
$bad1 = BuildRow $null 'urgent' 'hi' 'r' 100
Ok ((-not $bad1.ok) -and $bad1.reason -eq 'missing driverName')  "missing driverName -> skipped"
$bad2 = BuildRow 'Ahmad' '   ' 'hi' 'r' 100
Ok ((-not $bad2.ok) -and $bad2.reason -eq 'missing toneBucket')  "blank toneBucket -> skipped"
$good = BuildRow ' Ahmad ' ' urgent ' 'hello' 'below target pace' 1500
Ok ($good.ok)                                                    "valid payload -> ok"
Ok ($good.row.driver_name -eq 'Ahmad')                           "driver_name trimmed"
Ok ($good.row.tone_bucket -eq 'urgent')                          "tone_bucket trimmed"
Ok ($good.row.trigger_reason -eq 'below target pace')            "trigger_reason carried"
Ok ($good.row.driver_net_sar -eq 1500)                           "driver_net_sar numeric"

Write-Host "`n-- toPreview (cap 120) + toNum (finite-or-null) --" -ForegroundColor Cyan
$long = 'x' * 200
$lr = BuildRow 'Omar' 'welcome' $long '' 0
Ok ($lr.row.message_preview.Length -eq 120)                      "preview capped at 120 chars"
Ok ($null -eq $lr.row.trigger_reason)                            "empty reason -> null"
Ok ($lr.row.driver_net_sar -eq 0)                               "net 0 stays 0 (finite)"
$nr = BuildRow 'Sara' 'awareness' 'hi' 'r' 'abc'
Ok ($null -eq $nr.row.driver_net_sar)                            "non-numeric net -> null"

Write-Host "`n-- clampDays --" -ForegroundColor Cyan
Ok ((ClampDays 5)    -eq 5)    "days 5 -> 5"
Ok ((ClampDays 500)  -eq 365)  "days 500 -> 365 (cap)"
Ok ((ClampDays 0)    -eq 7)    "days 0 -> 7 (default)"
Ok ((ClampDays -3)   -eq 7)    "days -3 -> 7 (default)"
Ok ((ClampDays 'abc') -eq 7)   "days non-numeric -> 7 (default)"

Write-Host "`n-- summarize aggregation --" -ForegroundColor Cyan
$rows = @(
  [pscustomobject]@{ driver_name = 'Ahmad'; tone_bucket = 'urgent' },
  [pscustomobject]@{ driver_name = 'Ahmad'; tone_bucket = 'awareness' },
  [pscustomobject]@{ driver_name = 'Omar';  tone_bucket = 'welcome' },
  [pscustomobject]@{ driver_name = '';      tone_bucket = 'awareness' },
  [pscustomobject]@{ driver_name = 'Sara';  tone_bucket = $null }
)
$sum = Summarize $rows
Ok ($sum.totalSent -eq 5)                          "totalSent counts every row (incl. blank-name)"
Ok ($sum.byTone['awareness'] -eq 2)                "byTone awareness = 2"
Ok ($sum.byTone['urgent'] -eq 1)                   "byTone urgent = 1"
Ok ($sum.byTone['welcome'] -eq 1)                  "byTone welcome = 1"
Ok ($sum.byTone['unknown'] -eq 1)                  "null tone -> 'unknown'"
Ok ($sum.driversNudged.Count -eq 3)                "driversNudged = 3 (blank skipped)"
Ok ($sum.driversNudged[0] -eq 'Ahmad')             "driversNudged keeps first-seen order"
Ok ($sum.driversNudged -contains 'Sara')           "Sara counted as a driver"
Ok (-not ($sum.driversNudged -contains ''))        "blank name NOT a driver"
Ok ($sum.byDriver['Ahmad']['c'] -eq 2)             "byDriver Ahmad count = 2"
Ok ($sum.byDriver['Ahmad']['tones'].Count -eq 2)   "byDriver Ahmad has 2 distinct tones"
Ok ($sum.byDriver['Omar']['tones'][0] -eq 'welcome') "byDriver Omar tone = welcome"
Ok (-not $sum.byDriver.ContainsKey(''))            "byDriver has no blank-name key"

$empty = Summarize @()
Ok ($empty.totalSent -eq 0)                        "empty rows -> totalSent 0"

# ---- STATIC WIRING ASSERTIONS ----------------------------------------------
$root = Split-Path -Parent $PSScriptRoot
$loggerPath = Join-Path $root 'lib\nudge-logger.js'
$nudgesPath = Join-Path $root 'lib\nudges.js'
$briefPath  = Join-Path $root 'lib\morning-brief.js'
$apiPath    = Join-Path $root 'api\nudge-history.js'
$migPath    = Join-Path $root 'migrations\B96_nudge_log.sql'

Ok ([IO.File]::Exists($loggerPath))  "lib/nudge-logger.js exists"
Ok ([IO.File]::Exists($nudgesPath))  "lib/nudges.js exists"
Ok ([IO.File]::Exists($briefPath))   "lib/morning-brief.js exists"
Ok ([IO.File]::Exists($apiPath))     "api/nudge-history.js exists"
Ok ([IO.File]::Exists($migPath))     "migrations/B96_nudge_log.sql exists"

$logger = [IO.File]::ReadAllText($loggerPath, [Text.Encoding]::UTF8)
$nudges = [IO.File]::ReadAllText($nudgesPath, [Text.Encoding]::UTF8)
$brief  = [IO.File]::ReadAllText($briefPath,  [Text.Encoding]::UTF8)
$api    = [IO.File]::ReadAllText($apiPath,    [Text.Encoding]::UTF8)
$mig    = [IO.File]::ReadAllText($migPath,    [Text.Encoding]::UTF8)

Write-Host "`n-- lib/nudge-logger.js surface --" -ForegroundColor Cyan
Ok ($logger -match 'function logNudge')          "defines logNudge"
Ok ($logger -match 'function getNudgeHistory')   "defines getNudgeHistory"
Ok ($logger -match 'function getNudgeSummary')   "defines getNudgeSummary"
Ok ($logger -match 'function summarize')         "defines summarize (pure aggregation)"
Ok ($logger -match 'function buildRow')          "defines buildRow (validation)"
Ok ($logger -match 'm8_nudge_log')               "targets m8_nudge_log table"
Ok ($logger -match 'db\.sbFetch')                "optional db.sbFetch injection seam"
Ok ($logger -match 'PREVIEW_MAX\s*=\s*120')      "PREVIEW_MAX = 120"
Ok ($logger -match 'module\.exports')            "has module.exports"
Ok ($logger -match 'logNudge' -and $logger -match 'getNudgeHistory' -and $logger -match 'getNudgeSummary') "exports the 3-fn surface"

Write-Host "`n-- migration B96_nudge_log.sql --" -ForegroundColor Cyan
Ok ($mig -match 'CREATE TABLE IF NOT EXISTS m8_nudge_log')          "creates m8_nudge_log (idempotent)"
Ok ($mig -match 'driver_name\s+text\s+NOT NULL')                    "driver_name text NOT NULL"
Ok ($mig -match 'tone_bucket\s+text\s+NOT NULL')                    "tone_bucket text NOT NULL"
Ok ($mig -match 'message_preview\s+text')                           "message_preview column"
Ok ($mig -match 'trigger_reason\s+text')                            "trigger_reason column"
Ok ($mig -match 'driver_net_sar\s+numeric')                         "driver_net_sar numeric column"
Ok ($mig -match 'CREATE INDEX IF NOT EXISTS m8_nudge_log_driver_idx')  "driver index"
Ok ($mig -match 'CREATE INDEX IF NOT EXISTS m8_nudge_log_created_idx') "created_at index"

Write-Host "`n-- lib/nudges.js wiring (logs each draft) --" -ForegroundColor Cyan
Ok ($nudges -match "require\(['""]\./nudge-logger")  "requires nudge-logger"
Ok ($nudges -match 'logNudge\(')                     "calls logNudge"
Ok ($nudges -match 'TRIGGER_BY_BUCKET')              "maps bucket -> trigger_reason"
Ok ($nudges -match 'logNudgesSafe')                  "defines logNudgesSafe helper"
Ok ($nudges -match 'await logNudgesSafe\(result\)')  "computeNudges logs the result"

Write-Host "`n-- lib/morning-brief.js wiring (weekly nudge line) --" -ForegroundColor Cyan
Ok ($brief -match "require\(['""]\./nudge-logger")   "requires nudge-logger"
Ok ($brief -match 'getNudgeSummary')                 "reads getNudgeSummary"
Ok ($brief -match 'function attachNudgeActivity')    "defines attachNudgeActivity"
Ok ($brief -match 'function formatNudgeActivityLine') "defines formatNudgeActivityLine"
Ok ($brief -match 'nudgeActivity')                   "attaches brief.nudgeActivity"
Ok ($brief -match 'NUDGE ACTIVITY')                  "renders the brief text line"
Ok ($brief -match 'await attachNudgeActivity')       "computeLiveBrief attaches activity"

Write-Host "`n-- api/nudge-history.js wiring --" -ForegroundColor Cyan
Ok ($api -match "require\(['""]\.\./lib/nudge-logger")  "requires lib/nudge-logger"
Ok ($api -match 'getNudgeHistory')                      "uses getNudgeHistory"
Ok ($api -match 'getNudgeSummary')                      "uses getNudgeSummary (no-driver summary)"
Ok ($api -match 'module\.exports\s*=\s*async')          "exports an async handler"

# ---- summary ----------------------------------------------------------------
$total = $script:pass + $script:fail
Write-Host ""
$color = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed") -ForegroundColor $color
Write-Host ("" + $script:pass + "/" + $total + " passed")
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
