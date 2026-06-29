# Build-158 -- fleet per-driver date-range breakdown (PS-5.1 mirror)
# Mirrors the key pieces of lib/fleet.js added in Build-158:
#   driverRangeRef()        -- detects "net per driver from X to Y" phrasing
#   driverRangeRankings()   -- sums per-driver net across a set of day entries
#
# Node is ABSENT on the host -- all assertions are pure PS-5.1 over sample data.
# Arabic phrasing tests use the same regexes and are covered by the live phone
# test (BUILD158_LIVE_TEST.md). OneDrive encoding issues: ASCII corpus only here.
#
# The live-routing fix (B-157 arbiter stopping the wallet lane from stealing the
# question) is a separate session -- these tests verify the FLEET ENGINE only.

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0

function Assert-True([string]$label, [bool]$cond) {
  if ($cond) {
    $script:pass++
    Write-Host ("  PASS: {0}" -f $label) -ForegroundColor Green
  } else {
    $script:fail++
    Write-Host ("  FAIL: {0}" -f $label) -ForegroundColor Red
  }
}

function Assert-Eq([string]$label, $expected, $actual) {
  if ("$expected" -eq "$actual") {
    $script:pass++
    Write-Host ("  PASS: {0}" -f $label) -ForegroundColor Green
  } else {
    $script:fail++
    Write-Host ("  FAIL: {0} - expected [{1}] got [{2}]" -f $label, $expected, $actual) -ForegroundColor Red
  }
}

# ---- Mirror of driverRangeRef() -----------------------------------------------
$DRIVER_RANGE_PATTERNS = @(
  'per[- ](?:driver|captain|courier|rider)',
  'each[- ](?:driver|captain|courier|rider)',
  'every[- ](?:driver|captain|courier|rider)',
  '(?:individual)[^.?!]{0,40}(?:driver|captain|courier|rider)',
  'break(?:down|s)?[^.?!]{0,40}(?:by[- ]driver|per[- ]driver|per[- ]captain)',
  'net\s+(?:earn\w*|income)[^.?!]{0,60}per[- ](?:driver|captain|courier|rider)',
  'for\s+each[- ](?:driver|captain|courier|rider)',
  '(?:driver|captain|courier|rider)[^.?!]{0,40}net[^.?!]{0,50}(?:from|till|until|since|between)'
)

function Test-DriverRangeRef([string]$msg) {
  $s = $msg.ToLower()
  foreach ($p in $DRIVER_RANGE_PATTERNS) {
    if ($s -match $p) { return $true }
  }
  return $false
}

Write-Host "`n=== A. driverRangeRef detection ===" -ForegroundColor Cyan

# Muhammad's exact question that triggered this build
Assert-True "Muhammad actual question: TOTAL NET EARNING PER DRIVER FROM 1ST OF JUNE TILL 28TH OF JUNE" `
  (Test-DriverRangeRef "TOTAL NET EARNING PER DRIVER FROM 1ST OF JUNE TILL 28TH OF JUNE")

Assert-True "net earning per driver from June 1 to June 28" `
  (Test-DriverRangeRef "net earning per driver from June 1 to June 28")

Assert-True "per driver this month" `
  (Test-DriverRangeRef "per driver this month")

Assert-True "breakdown per driver" `
  (Test-DriverRangeRef "breakdown per driver")

Assert-True "for each driver this week" `
  (Test-DriverRangeRef "for each driver this week")

Assert-True "breakdown by driver from June 1 to June 28" `
  (Test-DriverRangeRef "breakdown by driver from June 1 to June 28")

Assert-True "every driver net from June 1 to 28" `
  (Test-DriverRangeRef "every driver net from June 1 to 28")

Assert-True "driver net from June 1 till June 28" `
  (Test-DriverRangeRef "driver net from June 1 till June 28")

# Should NOT match -- single-driver or fleet-total phrasings
Assert-True "NOFIRE: how did the fleet do this week" `
  (-not (Test-DriverRangeRef "how did the fleet do this week"))

Assert-True "NOFIRE: what is the net this month" `
  (-not (Test-DriverRangeRef "what is the net this month"))

Assert-True "NOFIRE: how much did Ali earn this week" `
  (-not (Test-DriverRangeRef "how much did Ali earn this week"))

Assert-True "NOFIRE: show me the leaderboard for June" `
  (-not (Test-DriverRangeRef "show me the leaderboard for June"))

# ---- Mirror of driverRangeRankings() ------------------------------------------
# Simulate decoded day-entries with per-driver data.
# 3 days: Jun 1, Jun 2, Jun 3.  3 drivers: Ali, Mansour, Khaled.
# Khaled is absent on Jun 3.

function New-Driver([string]$name, [string]$id, [double]$net, [int]$orders, [bool]$active) {
  return [pscustomobject]@{ name = $name; driverId = $id; netEarnings = $net; orders = $orders; isActive = $active }
}

$day1 = [pscustomobject]@{
  period  = "1 Jun 2026"
  drivers = @(
    (New-Driver "ALI ALSHAHRANI"  "d1" 350.00 12 $true),
    (New-Driver "MANSOUR ALGARNI" "d2" 280.00  9 $true),
    (New-Driver "KHALED ALBISHI"  "d3" 420.00 14 $true)
  )
}

$day2 = [pscustomobject]@{
  period  = "2 Jun 2026"
  drivers = @(
    (New-Driver "ALI ALSHAHRANI"  "d1" 310.00 10 $true),
    (New-Driver "MANSOUR ALGARNI" "d2" 400.00 13 $true),
    (New-Driver "KHALED ALBISHI"  "d3" 180.00  6 $true)
  )
}

$day3 = [pscustomobject]@{
  period  = "3 Jun 2026"
  drivers = @(
    (New-Driver "ALI ALSHAHRANI"  "d1" 390.00 13 $true),
    (New-Driver "MANSOUR ALGARNI" "d2" 310.00 10 $true)
  )
}

$entries = @($day1, $day2, $day3)
$allIdx  = @(0, 1, 2)

# Mirror of driverRangeRankings(entries, indices, label)
function Get-DriverRangeRankings($entries, $indices, [string]$label) {
  $days = @()
  foreach ($i in $indices) { $days += $entries[$i] }
  if ($days.Count -eq 0) { return $null }

  $byKey = @{}
  foreach ($day in $days) {
    foreach ($d in $day.drivers) {
      if ((-not $d.isActive) -and ($d.netEarnings -le 0)) { continue }
      $k = $d.driverId
      if (-not $k) { $k = $d.name }
      if (-not $byKey.ContainsKey($k)) {
        $byKey[$k] = @{ name = $d.name; net = [double]0; orders = [int]0; days = [int]0 }
      }
      $byKey[$k].net    = $byKey[$k].net    + [double]$d.netEarnings
      $byKey[$k].orders = $byKey[$k].orders + [int]$d.orders
      $byKey[$k].days   = $byKey[$k].days   + 1
    }
  }

  $ranked = $byKey.Values | Sort-Object { -[double]$_.net }

  $totalNet = [double]0
  foreach ($d in $ranked) { $totalNet = $totalNet + [double]$d.net }

  $range = if ($days.Count -ge 2) {
    "{0} -> {1}" -f $days[0].period, $days[$days.Count - 1].period
  } else { $days[0].period }

  return [pscustomobject]@{
    label    = $label
    range    = $range
    days     = $days.Count
    totalNet = [Math]::Round($totalNet, 2)
    ranked   = @($ranked)
  }
}

Write-Host "`n=== B. driverRangeRankings -- correctness ===" -ForegroundColor Cyan

$result = Get-DriverRangeRankings $entries $allIdx "1 Jun - 3 Jun"

# B1: correct driver count (3 unique drivers)
Assert-Eq "B1: 3 unique drivers in result" 3 $result.ranked.Count

# B2: fleet total = 350+310+390 + 280+400+310 + 420+180 = 2640
$expectedTotal = 350 + 310 + 390 + 280 + 400 + 310 + 420 + 180
Assert-Eq "B2: fleet total net = 2640" $expectedTotal ([int]$result.totalNet)

# B3: Khaled total = 420 + 180 = 600 (2 days, absent on day 3)
$khaled = $result.ranked | Where-Object { $_.name -eq "KHALED ALBISHI" }
Assert-Eq "B3: Khaled net = 600" 600 ([int]$khaled.net)
Assert-Eq "B3: Khaled days = 2" 2 ([int]$khaled.days)
Assert-Eq "B3: Khaled orders = 20" 20 ([int]$khaled.orders)

# B4: Ali total = 350 + 310 + 390 = 1050 (3 days)
$ali = $result.ranked | Where-Object { $_.name -eq "ALI ALSHAHRANI" }
Assert-Eq "B4: Ali net = 1050" 1050 ([int]$ali.net)
Assert-Eq "B4: Ali days = 3" 3 ([int]$ali.days)

# B5: Mansour total = 280 + 400 + 310 = 990 (3 days)
$mansour = $result.ranked | Where-Object { $_.name -eq "MANSOUR ALGARNI" }
Assert-Eq "B5: Mansour net = 990" 990 ([int]$mansour.net)

# B6: ranking is high to low (Ali 1050 > Mansour 990 > Khaled 600)
$names = $result.ranked | ForEach-Object { $_.name }
Assert-Eq "B6: rank[0] is Ali (highest)" "ALI ALSHAHRANI" $names[0]
Assert-Eq "B6: rank[1] is Mansour" "MANSOUR ALGARNI" $names[1]
Assert-Eq "B6: rank[2] is Khaled (lowest)" "KHALED ALBISHI" $names[2]

Write-Host "`n=== C. Partial range (days 1-2 only) ===" -ForegroundColor Cyan

$result2 = Get-DriverRangeRankings $entries @(0, 1) "1 Jun - 2 Jun"

Assert-Eq "C1: 2 days in range" 2 $result2.days
Assert-Eq "C2: 3 drivers across 2 days" 3 $result2.ranked.Count

# fleet total for days 1-2 = (350+280+420) + (310+400+180) = 1050 + 890 = 1940
Assert-Eq "C3: fleet total = 1940" 1940 ([int]$result2.totalNet)

# Mansour leads for Jun 1-2: 280+400=680 vs Ali 350+310=660
$names2 = $result2.ranked | ForEach-Object { $_.name }
Assert-Eq "C4: Mansour leads Jun 1-2 with 680" "MANSOUR ALGARNI" $names2[0]

Write-Host "`n=== D. Edge cases ===" -ForegroundColor Cyan

# D1: single-day range
$result3 = Get-DriverRangeRankings $entries @(0) "1 Jun"
Assert-Eq "D1: 3 drivers on day 1" 3 $result3.ranked.Count
$names3 = $result3.ranked | ForEach-Object { $_.name }
Assert-Eq "D1: Khaled leads on day 1 with 420" "KHALED ALBISHI" $names3[0]

# D2: inactive driver with netEarnings=0 should be excluded
$dayWithInactive = [pscustomobject]@{
  period  = "4 Jun 2026"
  drivers = @(
    (New-Driver "ALI ALSHAHRANI" "d1" 300.00 10 $true),
    (New-Driver "IDLE DRIVER"    "d9"   0.00  0 $false)
  )
}
$result4 = Get-DriverRangeRankings @($dayWithInactive) @(0) "4 Jun"
Assert-Eq "D2: inactive zero-net driver excluded" 1 $result4.ranked.Count

# D3: inactive driver WITH positive netEarnings is included (campaign credit)
$dayWithCredit = [pscustomobject]@{
  period  = "5 Jun 2026"
  drivers = @(
    (New-Driver "ALI ALSHAHRANI"  "d1" 300.00 10 $true),
    (New-Driver "CAMPAIGN EARNER" "d8" 100.00  0 $false)
  )
}
$result5 = Get-DriverRangeRankings @($dayWithCredit) @(0) "5 Jun"
Assert-Eq "D3: inactive driver with positive net IS included" 2 $result5.ranked.Count

Write-Host "`n=== E. Additional detection phrases ===" -ForegroundColor Cyan

$shouldMatch = @(
  "each captain this week",
  "net per captain from June 1 to 28",
  "breakdown by driver from June 1 to June 28",
  "net income per driver this month",
  "for each driver from June 1 to June 28",
  "every captain net from June to June"
)
foreach ($msg in $shouldMatch) {
  Assert-True ("MATCH: $msg") (Test-DriverRangeRef $msg)
}

$shouldNotMatch = @(
  "how did the fleet do this week",
  "who is the top earner",
  "how much did Mansour make this month",
  "leaderboard June",
  "morning brief",
  "rank drivers by earnings",
  "can Ali hit 5000 SAR"
)
foreach ($msg in $shouldNotMatch) {
  Assert-True ("NOFIRE: $msg") (-not (Test-DriverRangeRef $msg))
}

# ---- Summary ------------------------------------------------------------------
Write-Host ""
if ($script:fail -eq 0) {
  Write-Host ("PASSED {0}/{0}" -f $script:pass) -ForegroundColor Green
} else {
  Write-Host ("FAILED {0} / PASSED {1}" -f $script:fail, $script:pass) -ForegroundColor Red
  exit 1
}
