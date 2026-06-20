# B91-pnl-verify.ps1
# Pure-PS mirror of lib/pnl-engine.js (no local Node). ASCII only. No ternary.
# The correction under test: the company earns RENTAL + 50% of the Bolt tier bonus.
# The driver's Bolt net is the DRIVER's money and is NEVER company revenue (it is
# only the bonus-tier input).

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

# ---- Mirror of pnl-engine ----
$BONUS_TIERS = @(
    @{ min = 6000; gross = 2500 },
    @{ min = 5000; gross = 2000 },
    @{ min = 4000; gross = 1500 }
)
$COMPANY_SHARE = 0.5

function DriverBonusTier($net) {
    foreach ($t in $BONUS_TIERS) {
        if ($net -ge $t.min) {
            return @{ min = $t.min; gross = $t.gross; companyShare = ($t.gross * $COMPANY_SHARE) }
        }
    }
    return $null
}

function CompanyRevenueFromDriver($net, $rental) {
    $rentalNum = [double]$rental
    $tier = DriverBonusTier $net
    $bonus = 0.0
    if ($null -ne $tier) { $bonus = $tier.companyShare }
    return @{ rental = $rentalNum; bonus = $bonus; total = ($rentalNum + $bonus) }
}

function CompanyPnl($drivers) {
    $totalRevenue = 0.0
    $totalCosts   = 0.0
    foreach ($d in $drivers) {
        $rev = CompanyRevenueFromDriver $d.driverNet $d.rentalAmount
        $costs = [double]$d.salaryCost + [double]$d.fuelCost + [double]$d.otherCosts
        $totalRevenue = $totalRevenue + $rev.total
        $totalCosts   = $totalCosts + $costs
    }
    return @{ totalRevenue = $totalRevenue; totalCosts = $totalCosts; netProfit = ($totalRevenue - $totalCosts) }
}

Write-Host "`n== Build-91 P&L engine ==" -ForegroundColor Cyan

# Case 1: driverNet=3500 -> below the 4000 floor -> no tier, bonus 0.
$c1tier = DriverBonusTier 3500
$c1rev  = CompanyRevenueFromDriver 3500 0
Check "Case 1: net 3500 -> bonus 0 (no tier)" (($null -eq $c1tier) -and ($c1rev.bonus -eq 0))

# Case 2: driverNet=4200 -> 4000 tier -> company share 750.
$c2 = DriverBonusTier 4200
Check "Case 2: net 4200 -> companyShare 750" (($null -ne $c2) -and ($c2.companyShare -eq 750))

# Case 3: driverNet=5100 -> 5000 tier -> company share 1000.
$c3 = DriverBonusTier 5100
Check "Case 3: net 5100 -> companyShare 1000" (($null -ne $c3) -and ($c3.companyShare -eq 1000))

# Case 4: driverNet=6500 -> 6000 tier -> company share 1250.
$c4 = DriverBonusTier 6500
Check "Case 4: net 6500 -> companyShare 1250" (($null -ne $c4) -and ($c4.companyShare -eq 1250))

# Case 5: net 5000, rental 2000 -> revenue 2000 rental + 1000 bonus = 3000.
$c5 = CompanyRevenueFromDriver 5000 2000
Check "Case 5: net 5000 + rental 2000 -> total 3000" ($c5.total -eq 3000)

# Case 6: fleet of three -> totalRevenue 0 + 3000 + 3250 = 6250.
$fleet = @(
    @{ driverNet = 3500; rentalAmount = 0 },
    @{ driverNet = 5000; rentalAmount = 2000 },
    @{ driverNet = 6500; rentalAmount = 2000 }
)
$c6 = CompanyPnl $fleet
Check "Case 6: fleet totalRevenue 6250" ($c6.totalRevenue -eq 6250)

Write-Host ""
Write-Host ("{0}/6 passed" -f $global:pass) -ForegroundColor Yellow
if ($global:fail -gt 0) { exit 1 }
exit 0
