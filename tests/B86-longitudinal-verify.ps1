# B86-longitudinal-verify.ps1
# Pure-PS mirror of lib/longitudinal.js logic. No Node required.
# Pure ASCII (PS 5.1 reads no-BOM file as ANSI -- non-ASCII chars break parsing).
# Run: powershell -File tests\B86-longitudinal-verify.ps1

$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0

function Ok($cond, $label) {
    if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor DarkGreen }
    else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}

# -- Mirror: staleSuffix(days) ------------------------------------------------
function StaleSuffix([object]$days) {
    if ($null -eq $days) { return "" }
    if ([int]$days -gt 7) { return " [STALE: ${days}d ago]" }
    return ""
}

# -- Mirror: daysSince(isoDate) -----------------------------------------------
function DaysSince([string]$isoDate) {
    if (-not $isoDate) { return $null }
    $ms = ([datetime]::UtcNow - [datetime]::Parse($isoDate)).TotalMilliseconds
    return [Math]::Floor($ms / 86400000)
}

# -- Mirror: fetchRecurringTopicsFallback aggregation -------------------------
function AggregateTopics($rows, [int]$minCount = 2, [int]$maxRows = 4) {
    $map = @{}
    foreach ($r in $rows) {
        $k = ($r.memory_key + "").Trim()
        if ($k.Length -lt 3) { continue }
        if (-not $map.ContainsKey($k)) { $map[$k] = @{count=0; latest=$r.created_at} }
        $map[$k].count++
        if ($r.created_at -gt $map[$k].latest) { $map[$k].latest = $r.created_at }
    }
    return $map.GetEnumerator() |
        Where-Object { $_.Value.count -ge $minCount } |
        Sort-Object { $_.Value.count } -Descending |
        Select-Object -First $maxRows
}

# -- Tests --------------------------------------------------------------------

# staleSuffix boundary
Ok ((StaleSuffix 3) -eq "")                   "staleSuffix(3) returns empty"
Ok ((StaleSuffix 7) -eq "")                   "staleSuffix(7) boundary returns empty"
Ok ((StaleSuffix 8) -match "STALE")           "staleSuffix(8) returns STALE tag"
Ok ((StaleSuffix 10) -match "10d ago")        "staleSuffix(10) includes day count"
Ok ((StaleSuffix $null) -eq "")              "staleSuffix(null) safe - returns empty"
Ok ((StaleSuffix 0) -eq "")                   "staleSuffix(0) returns empty"

# daysSince
$recent = [datetime]::UtcNow.AddDays(-3).ToString("o")
$old    = [datetime]::UtcNow.AddDays(-10).ToString("o")
Ok ((DaysSince $recent) -le 4)                "daysSince 3 days ago is le 4"
Ok ((DaysSince $old) -ge 9)                   "daysSince 10 days ago is ge 9"
Ok ((DaysSince "") -eq $null)                 "daysSince empty string returns null"

# topic aggregation: min 2 occurrences, max 4 results
$rows = @(
    @{memory_key="fleet"; created_at="2026-06-18"},
    @{memory_key="fleet"; created_at="2026-06-19"},
    @{memory_key="fleet"; created_at="2026-06-20"},
    @{memory_key="lean";  created_at="2026-06-19"},
    @{memory_key="lean";  created_at="2026-06-20"},
    @{memory_key="once";  created_at="2026-06-20"}
)
$topics = AggregateTopics $rows
Ok ($topics.Count -eq 2)                      "aggregation: only keys with count ge 2 returned"
Ok (($topics | Where-Object {$_.Key -eq "fleet"}).Value.count -eq 3)  "aggregation: fleet count = 3"
Ok (-not ($topics | Where-Object {$_.Key -eq "once"}))                "aggregation: once-only key filtered out"

# short key filter (less than 3 chars)
$rowsShort = @(
    @{memory_key="ai"; created_at="2026-06-20"},
    @{memory_key="ai"; created_at="2026-06-19"}
)
$topicsShort = AggregateTopics $rowsShort
Ok ($topicsShort.Count -eq 0)                 "aggregation: key shorter than 3 chars filtered"

# maxRows cap
$manyRows = @()
1..10 | ForEach-Object {
    $n = $_
    $manyRows += @{memory_key="topic$n"; created_at="2026-06-20"}
    $manyRows += @{memory_key="topic$n"; created_at="2026-06-19"}
}
$capped = AggregateTopics $manyRows 2 4
Ok ($capped.Count -le 4)                      "aggregation: capped at maxRows=4"

# longitudinal.js exists and exports required symbols
$jsPath = Join-Path $PSScriptRoot '..\lib\longitudinal.js'
Ok (Test-Path $jsPath)                        "lib/longitudinal.js exists"
$src = Get-Content $jsPath -Raw
Ok ($src -match 'getLongitudinalContext')     "exports getLongitudinalContext"
Ok ($src -match 'staleSuffix')               "exports staleSuffix"
Ok ($src -match 'STALE_DAYS')               "STALE_DAYS constant present"
Ok ($src -match 'TRENDING_DAYS')            "TRENDING_DAYS constant present"
Ok ($src -match 'merged_into')              "fallback query filters merged_into"

Write-Host ""
$total = $script:pass + $script:fail
Write-Host "$($script:pass)/$total passed"
if ($script:fail -gt 0) { exit 1 }
