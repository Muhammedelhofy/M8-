# B95-fleet-report-verify.ps1
# Pure-PS 5.1 mirror of lib/fleet-report.js (no local Node). ASCII only. No ternary.
# Mirrors: the company P&L arithmetic (rental + 50% Bolt-bonus share - costs), the
# onTrackFor5000 month-end projection, and the recommended-actions precedence.
# Plus static wiring checks for lib/fleet-report.js + the orchestrator slots.
#
# PS 5.1 notes (see feedback-ps-test-mirror-gotchas):
#  - JsRound mirrors JS Math.round (round half toward +Inf), NOT banker's rounding.
#  - File reads use [IO.File]::ReadAllText (OneDrive Get-Content can flake).
#  - No function named CP (Copy-Item alias). No non-ASCII literals.

$ErrorActionPreference = "Stop"
$global:pass = 0
$global:fail = 0

function Check($name, $cond) {
    $status = "FAIL"
    $color  = "Red"
    if ($cond) { $status = "PASS"; $color = "Green"; $global:pass = $global:pass + 1 }
    else { $global:fail = $global:fail + 1 }
    Write-Host ("[{0}] {1}" -f $status, $name) -ForegroundColor $color
}

# ---- Mirror of fleet-report arithmetic ----
$TARGET      = 5000
$PROJECTDAYS = 30
$MINPROJECT  = 3
$OFFLINE     = 3
$BONUSFLOOR  = 4000

function JsRound($x) { return [math]::Floor([double]$x + 0.5) }

# Company 50% share of the Bolt tier bonus, by net (canonical pnl-engine schedule).
function CompanyBonus($net) {
    if ($net -ge 6000) { return 1250 }
    if ($net -ge 5000) { return 1000 }
    if ($net -ge 4000) { return 750 }
    return 0
}

# Projected-tier floor (0 = below the bonus floor).
function TierFloor($net) {
    if ($net -ge 6000) { return 6000 }
    if ($net -ge 5000) { return 5000 }
    if ($net -ge 4000) { return 4000 }
    return 0
}

function TierLabel($floor) {
    if ($floor -ge 6000) { return "T6" }
    if ($floor -ge 5000) { return "T5" }
    if ($floor -ge 4000) { return "T4" }
    return "none"
}

# projectedNet = round( (net / min(daysElapsed, projectDays)) * projectDays ).
function ProjNet($net, $daysElapsed, $projectDays) {
    $den = 0
    if ($daysElapsed -gt 0) { $den = [math]::Min($daysElapsed, $projectDays) }
    if ($den -gt 0) { return JsRound( ($net / $den) * $projectDays ) }
    return JsRound($net)
}

# Compute one driver record, mirroring buildFleetReport's per-driver branch.
function ComputeDriver($d, $daysElapsed) {
    $driverNet  = [double]$d.driverNet
    $daysActive = [int]$d.daysActive
    $lastActive = [int]$d.lastActiveDay
    $offlineStreak = 0
    if ($daysElapsed -gt 0 -and $lastActive -gt 0) {
        $tmp = $daysElapsed - $lastActive
        if ($tmp -gt 0) { $offlineStreak = $tmp }
    }
    $projected = ProjNet $driverNet $daysElapsed $PROJECTDAYS
    $onTrack = ($projected -ge $TARGET)

    $hasProfile = [bool]$d.hasProfile
    $rental = 0.0; $salary = 0.0; $fuel = 0.0; $other = 0.0
    if ($hasProfile) {
        $rental = [double]$d.rental
        $salary = [double]$d.salary
        $fuel   = [double]$d.fuel
        $other  = [double]$d.other
    }
    $costs = $salary + $fuel + $other
    $bonus = CompanyBonus $projected
    $totalRevenue = $rental + $bonus
    $netProfit = $totalRevenue - $costs
    $floor = TierFloor $projected

    return @{
        name = $d.name; driverNet = (JsRound $driverNet); daysActive = $daysActive;
        lastActiveDay = $lastActive; offlineStreak = $offlineStreak;
        projectedNet = $projected; onTrackFor5000 = $onTrack; hasProfile = $hasProfile;
        rentalRevenue = (JsRound $rental); bonusShare = (JsRound $bonus);
        totalRevenue = (JsRound $totalRevenue); totalCosts = (JsRound $costs);
        netProfit = (JsRound $netProfit); tier = $floor; tierLabel = (TierLabel $floor)
    }
}

# Recommended-actions mirror: one action per driver, most urgent first.
function BuildRecs($computed) {
    $recs = @()
    foreach ($d in $computed) {
        if ($d.offlineStreak -ge $OFFLINE) {
            $recs += @{ driver = $d.name; kind = "offline"; priority = 1 }; continue
        }
        if ($d.daysActive -lt $MINPROJECT) { continue }
        if ($d.hasProfile -and ($d.netProfit -lt 0)) {
            $recs += @{ driver = $d.name; kind = "unprofitable"; priority = 2 }; continue
        }
        if ($d.projectedNet -lt $BONUSFLOOR) {
            $recs += @{ driver = $d.name; kind = "below_floor"; priority = 3 }; continue
        }
        if ($d.onTrackFor5000 -and ($d.driverNet -lt $TARGET)) {
            $recs += @{ driver = $d.name; kind = "encourage"; priority = 4 }; continue
        }
    }
    return ($recs | Sort-Object { $_.priority })
}

Write-Host "`n== Build-95 fleet-report arithmetic ==" -ForegroundColor Cyan

# ---- Projection (daysElapsed = 15 -> projectedNet = net * 2) ----
Check "Proj: 2600 over 15d -> 5200"      ((ProjNet 2600 15 30) -eq 5200)
Check "Proj: 1500 over 15d -> 3000"      ((ProjNet 1500 15 30) -eq 3000)
Check "Proj: 0 days elapsed -> net as-is" ((ProjNet 1500 0 30) -eq 1500)
Check "Proj: full month 5000/30 -> 5000" ((ProjNet 5000 30 30) -eq 5000)
Check "Proj: over-run clamps at 30 days" ((ProjNet 5000 40 30) -eq 5000)

# ---- Bonus tiers (company 50% share) ----
Check "Bonus: 7000 -> 1250" ((CompanyBonus 7000) -eq 1250)
Check "Bonus: 5200 -> 1000" ((CompanyBonus 5200) -eq 1000)
Check "Bonus: 4400 -> 750"  ((CompanyBonus 4400) -eq 750)
Check "Bonus: 3000 -> 0"    ((CompanyBonus 3000) -eq 0)

# ---- Tier labels ----
Check "Tier label 7000 -> T6"   ((TierLabel (TierFloor 7000)) -eq "T6")
Check "Tier label 5200 -> T5"   ((TierLabel (TierFloor 5200)) -eq "T5")
Check "Tier label 4400 -> T4"   ((TierLabel (TierFloor 4400)) -eq "T4")
Check "Tier label 3000 -> none" ((TierLabel (TierFloor 3000)) -eq "none")

# ---- Fixture: 5 drivers, daysElapsed = 15 ----
$DAYS = 15
$drivers = @(
    @{ name = "Ahmad";  driverNet = 1500; daysActive = 4;  lastActiveDay = 4;  hasProfile = $true;  rental = 900;  salary = 2000; fuel = 300; other = 100 },
    @{ name = "Omar";   driverNet = 2600; daysActive = 14; lastActiveDay = 15; hasProfile = $true;  rental = 1000; salary = 0;    fuel = 0;   other = 0   },
    @{ name = "Sara";   driverNet = 1500; daysActive = 10; lastActiveDay = 14; hasProfile = $true;  rental = 800;  salary = 0;    fuel = 0;   other = 0   },
    @{ name = "Khaled"; driverNet = 2200; daysActive = 15; lastActiveDay = 15; hasProfile = $true;  rental = 1000; salary = 0;    fuel = 0;   other = 0   },
    @{ name = "Faisal"; driverNet = 2100; daysActive = 12; lastActiveDay = 15; hasProfile = $false; rental = 0;    salary = 0;    fuel = 0;   other = 0   }
)

$computed = @()
foreach ($d in $drivers) { $computed += (ComputeDriver $d $DAYS) }
$byName = @{}
foreach ($c in $computed) { $byName[$c.name] = $c }

# ---- Per-driver P&L (rental + bonus share - costs) ----
$ahmad  = $byName["Ahmad"]
$omar   = $byName["Omar"]
$sara   = $byName["Sara"]
$khaled = $byName["Khaled"]
$faisal = $byName["Faisal"]

Check "Ahmad projects 3000 (below floor)"      ($ahmad.projectedNet -eq 3000)
Check "Ahmad offline streak 11 (15-4)"         ($ahmad.offlineStreak -eq 11)
Check "Ahmad netProfit 900-2400 = -1500"       ($ahmad.netProfit -eq -1500)
Check "Ahmad not on track for 5000"            ($ahmad.onTrackFor5000 -eq $false)

Check "Omar projects 5200, on track"           (($omar.projectedNet -eq 5200) -and ($omar.onTrackFor5000 -eq $true))
Check "Omar revenue 1000 rental + 1000 bonus"  ($omar.totalRevenue -eq 2000)
Check "Omar netProfit 2000 (no costs)"         ($omar.netProfit -eq 2000)

Check "Khaled projects 4400 (T4), not on track" (($khaled.projectedNet -eq 4400) -and ($khaled.onTrackFor5000 -eq $false))
Check "Khaled revenue 1000 + 750 = 1750"        ($khaled.totalRevenue -eq 1750)

Check "Faisal no profile -> rental 0, revenue = bonus only" (($faisal.hasProfile -eq $false) -and ($faisal.rentalRevenue -eq 0) -and ($faisal.totalRevenue -eq 750))

# ---- Fleet summary: P&L totals over PROFILED drivers only ----
$profiled = @($computed | Where-Object { $_.hasProfile })
$sumRental = 0; $sumBonus = 0; $sumRev = 0; $sumCost = 0; $sumNet = 0
foreach ($p in $profiled) {
    $sumRental = $sumRental + $p.rentalRevenue
    $sumBonus  = $sumBonus  + $p.bonusShare
    $sumRev    = $sumRev    + $p.totalRevenue
    $sumCost   = $sumCost   + $p.totalCosts
    $sumNet    = $sumNet    + $p.netProfit
}
$above5000 = @($computed | Where-Object { $_.onTrackFor5000 }).Count
$below4000 = @($computed | Where-Object { $_.projectedNet -lt $BONUSFLOOR }).Count
$missing   = @($computed | Where-Object { -not $_.hasProfile }).Count

Check "Summary totalRentalIncome 3700"     ($sumRental -eq 3700)
Check "Summary projectedBonusIncome 1750"  ($sumBonus -eq 1750)
Check "Summary totalRevenue 5450"          ($sumRev -eq 5450)
Check "Summary totalCosts 2400"            ($sumCost -eq 2400)
Check "Summary netProfit 3050"             ($sumNet -eq 3050)
Check "Summary revenue = rental + bonus"   ($sumRev -eq ($sumRental + $sumBonus))
Check "Summary net = revenue - costs"      ($sumNet -eq ($sumRev - $sumCost))
Check "Summary driversAbove5000 = 1"       ($above5000 -eq 1)
Check "Summary driversBelow4000 = 2"       ($below4000 -eq 2)
Check "Summary driversMissingProfile = 1"  ($missing -eq 1)

# ---- Recommended actions: precedence + order ----
$recs = @(BuildRecs $computed)
Check "Recs count = 3 (Khaled+Faisal clean)" ($recs.Count -eq 3)
Check "Rec[0] Ahmad offline (beats unprofitable+floor)" (($recs[0].driver -eq "Ahmad") -and ($recs[0].kind -eq "offline"))
Check "Rec[1] Sara below_floor"              (($recs[1].driver -eq "Sara") -and ($recs[1].kind -eq "below_floor"))
Check "Rec[2] Omar encourage"               (($recs[2].driver -eq "Omar") -and ($recs[2].kind -eq "encourage"))

# ---- Static wiring checks ----
Write-Host "`n== Build-95 static wiring ==" -ForegroundColor Cyan

$here = $PSScriptRoot
$libReport = Join-Path $here "..\lib\fleet-report.js"
$orchPath  = Join-Path $here "..\lib\orchestrator.js"

Check "lib/fleet-report.js exists" (Test-Path $libReport)

$reportSrc = ""
if (Test-Path $libReport) { $reportSrc = [IO.File]::ReadAllText($libReport, [Text.Encoding]::UTF8) }
$orchSrc = ""
if (Test-Path $orchPath) { $orchSrc = [IO.File]::ReadAllText($orchPath, [Text.Encoding]::UTF8) }

Check "exports buildFleetReport"   ($reportSrc.Contains("function buildFleetReport"))
Check "exports formatFleetReport"  ($reportSrc.Contains("function formatFleetReport"))
Check "exports detectFleetReportQuery" ($reportSrc.Contains("function detectFleetReportQuery"))
Check "module.exports buildFleetReport" ($reportSrc.Contains("buildFleetReport,") -or $reportSrc.Contains("buildFleetReport`r") -or $reportSrc.Contains("buildFleetReport`n"))
Check "requires pnl-engine"        ($reportSrc.Contains('require("./pnl-engine")'))
Check "projects over 30 days"      ($reportSrc.Contains("PROJECT_DAYS") -and $reportSrc.Contains("* o.projectDays"))
Check "has offline-streak recommend" ($reportSrc.Contains("offlineStreak") -and $reportSrc.Contains('kind: "offline"'))

# ASCII-only guard on this test file itself (no stray non-ASCII crept in).
$selfBytes = [IO.File]::ReadAllBytes($MyInvocation.MyCommand.Path)
$nonAscii = 0
foreach ($b in $selfBytes) { if ($b -gt 127) { $nonAscii = $nonAscii + 1 } }
Check "test file is pure ASCII" ($nonAscii -eq 0)

# Orchestrator wiring: requires fleet-report in BOTH paths + calls the API.
$reqCount = ([regex]::Matches($orchSrc, [regex]::Escape('require("./fleet-report")'))).Count
Check "orchestrator requires fleet-report (both paths)" ($reqCount -ge 2)
Check "orchestrator calls detectFleetReportQuery" ($orchSrc.Contains("detectFleetReportQuery("))
Check "orchestrator calls buildFleetReport"  ($orchSrc.Contains("buildFleetReport("))
Check "orchestrator calls formatFleetReport" ($orchSrc.Contains("formatFleetReport("))
Check "orchestrator gates on cost profiles"  ($orchSrc.Contains("getAllCostProfiles"))

Write-Host ""
$total = $global:pass + $global:fail
Write-Host ("{0}/{1} passed" -f $global:pass, $total) -ForegroundColor Yellow
if ($global:fail -gt 0) { exit 1 }
exit 0
