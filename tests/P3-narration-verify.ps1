# P3-narration-verify.ps1 -- offline tests for Build P3 narration layer
# Covers: renderDriverPnLPacket (R/F/S models + bonus), buildFinanceContext driver hit-check,
#         renderFleetPnLPacket model-aware revenue-by-source + bonus total.
# Run from the M8/ directory: powershell -File tests\P3-narration-verify.ps1
# Pure ASCII, no Unicode.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$pass = 0
$fail = 0

function T([string]$label, [string]$got, [string]$expect) {
  if ($got -eq $expect) {
    $script:pass++
    Write-Host "  PASS $label"
  } else {
    $script:fail++
    Write-Host "  FAIL $label"
    Write-Host "       expected: $expect"
    Write-Host "       got:      $got"
  }
}
function TContains([string]$label, [string]$hay, [string]$needle) {
  if ($hay.Contains($needle)) {
    $script:pass++
    Write-Host "  PASS $label"
  } else {
    $script:fail++
    Write-Host "  FAIL $label"
    Write-Host "       missing:  $needle"
    Write-Host "       in:       $hay"
  }
}

$js = @'
"use strict";
const {
  renderDriverPnLPacket, renderFleetPnLPacket, computeDriverPnLV2, computeFleetPnL,
  computeFleetBonusPacket, bonusFor, bonusGapFor, sN
} = require("./lib/finance");

const results = {};

// ── Shared helpers ────────────────────────────────────────────────
function makeEntries(drivers, month0, year) {
  return [{
    period: "1 Jun " + year + " - 28 Jun " + year,
    periodInfo: { end: { month: month0, year: year } },
    drivers: drivers
  }];
}
const MONTH = "2026-06";

// ── R model driver: Farouk ────────────────────────────────────────
// Foreigner driving on Saudi account.
// carRent IN 1000, acctRent IN 500, other OUT 800 (Saudi holder payment)
// driverNet = 5500 (their own money) -> company earns rent only
const rProfile = {
  "farouk": {
    model: "R", modelCustom: null,
    carRent:    { dir: "IN",  amount: 1000 },
    accountRent:{ dir: "IN",  amount: 500  },
    salary: 0, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other:      { dir: "OUT", amount: 800  },
    startDate: null
  }
};
const rEntries = makeEntries([{ name: "Farouk", netEarnings: 5500 }], 5, 2026);
const rPl = computeDriverPnLV2("Farouk", MONTH, rEntries, rProfile, {});
// income=0, driverNet=5500, acctRent=500, carRent=1000, other=-800, netPnL=700
// bonus: 5500 -> T5 (5000 floor) -> company 1000
const rBonus = bonusFor(rPl.driverNet);
const rGap   = bonusGapFor(rPl.driverNet);
const rPacket = renderDriverPnLPacket(rPl, MONTH, { bonus: rBonus, gap: rGap });

results.r_pl_income     = String(rPl.income);       // 0
results.r_pl_driverNet  = String(rPl.driverNet);    // 5500
results.r_pl_netPnL     = String(rPl.netPnL);       // 700

// Narration must contain model-aware labels
results.r_hasRentModel    = String(rPacket.includes("RENT MODEL"));
results.r_hasDriverMoney  = String(rPacket.includes("5,500") && rPacket.includes("their money"));
results.r_hasRentIn       = String(rPacket.includes("1,000") && rPacket.includes("500") && rPacket.includes("rent collected"));
results.r_hasHolderPay    = String(rPacket.includes("800") && rPacket.includes("Account holder"));
results.r_hasCarCostNote  = String(rPacket.includes("no maintenance"));
results.r_netPnLLine      = String(rPacket.includes("700") && rPacket.includes("NET P&L"));
// Bonus: driverNet 5500 -> T5 -> company 1000, combined = 700+1000=1700
results.r_bonusCompany    = String(rBonus.companyBonus); // 1000
results.r_hasBonusLine    = String(rPacket.includes("1,000") && rPacket.includes("BOLT BONUS"));
results.r_hasCombined     = String(rPacket.includes("1,700") && rPacket.includes("Combined"));

// ── F model driver: Fahed ─────────────────────────────────────────
// Saudi on own account. driverNet=5200 -> incentiveOut=400, netPnL=4800
const fProfile = {
  "fahed": {
    model: "F", modelCustom: null,
    carRent:    { dir: "NONE", amount: 0 },
    accountRent:{ dir: "NONE", amount: 0 },
    salary: 0, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other:      { dir: "NONE", amount: 0 },
    startDate: null
  }
};
const fEntries = makeEntries([{ name: "Fahed", netEarnings: 5200 }], 5, 2026);
const fPl = computeDriverPnLV2("Fahed", MONTH, fEntries, fProfile, {});
const fBonus = bonusFor(fPl.driverNet);
const fGap   = bonusGapFor(fPl.driverNet);
const fPacket = renderDriverPnLPacket(fPl, MONTH, { bonus: fBonus, gap: fGap });

// Income = 5200, incentiveOut=400, netPnL=4800
// Bonus: 5200 -> T5 -> company 1000, combined=5800
results.f_hasRevenueLabel = String(fPacket.includes("collected to company"));
results.f_hasIncentiveLine= String(fPacket.includes("incentive paid to driver") && fPacket.includes("400"));
results.f_netPnLLine      = String(fPacket.includes("4,800") && fPacket.includes("NET P&L"));
// F bonus: T5 (5000 floor), company 1000, combined 4800+1000=5800
results.f_hasBonusLine    = String(fPacket.includes("BOLT BONUS") && fPacket.includes("1,000"));
results.f_hasCombined     = String(fPacket.includes("5,800") && fPacket.includes("Combined"));

// ── F model driver below bonus tier (no bonus) ────────────────────
const fEntries3k = makeEntries([{ name: "Fahed", netEarnings: 3000 }], 5, 2026);
const fPl3k = computeDriverPnLV2("Fahed", MONTH, fEntries3k, fProfile, {});
const fBonus3k = bonusFor(fPl3k.driverNet);
const fGap3k   = bonusGapFor(fPl3k.driverNet);
const fPacket3k = renderDriverPnLPacket(fPl3k, MONTH, { bonus: fBonus3k, gap: fGap3k });
// Below 4000: bonus=0, gap.sarToNextTier=1000, gap.bonusUnlocked=750
results.f3k_hasNoBonusTier = String(fPacket3k.includes("not yet reached") || fPacket3k.includes("below 4,000"));

// ── S model driver with car rent OUT ─────────────────────────────
// Salaried driver on company car: carRent OUT 2000
const sProfile = {
  "sara": {
    model: "S", modelCustom: null,
    carRent:    { dir: "OUT", amount: 2000 },
    accountRent:{ dir: "OUT", amount: 600  },
    salary: 0, autoSalary: true,
    salaryBase: 4000, salaryThreshold: 10000, salaryPerK: 500,
    fleetCut: { type: "NONE", value: 0 },
    other:      { dir: "NONE", amount: 0   },
    startDate: null
  }
};
const sEntries = makeEntries([{ name: "Sara", netEarnings: 10000 }], 5, 2026);
const sPl = computeDriverPnLV2("Sara", MONTH, sEntries, sProfile, {});
const sBonus = bonusFor(sPl.driverNet);
const sGap   = bonusGapFor(sPl.driverNet);
const sPacket = renderDriverPnLPacket(sPl, MONTH, { bonus: sBonus, gap: sGap });
// income=10000, salary=-4000, acctRent=-600, carRent=-2000, netPnL=3400
// bonus: 10000 -> T6 -> company 1250, combined=4650
results.s_netPnL           = String(sPl.netPnL);                // 3400
results.s_hasCarCostLine   = String(sPacket.includes("Car cost") && sPacket.includes("2,000"));
results.s_hasCarNoMaint    = String(sPacket.includes("no maintenance"));
// Sara at 10000 -> T6 bonus -> company 1250
results.s_hasBonusT6       = String(sPacket.includes("BOLT BONUS") && sPacket.includes("1,250"));
results.s_hasCombined      = String(sPacket.includes("4,650") && sPacket.includes("Combined"));

// ── renderFleetPnLPacket model-aware revenue-by-source ────────────
// Fleet: Farouk R (carRent+acctRent IN, other OUT, driverNet 5500)
//        Fahed  F (net 5200, incentiveOut 400)
const mixedProfiles = { ...rProfile, ...fProfile };
const mixedEntries  = makeEntries([
  { name: "Farouk", netEarnings: 5500 },
  { name: "Fahed",  netEarnings: 5200 }
], 5, 2026);
const fleet = computeFleetPnL(MONTH, mixedEntries, mixedProfiles, {});
const bonusPkt = computeFleetBonusPacket(MONTH, mixedEntries, mixedProfiles, {});
const fleetPacket = renderFleetPnLPacket(fleet, bonusPkt);

// Farouk R: income=0, acctRent=500, carRent=1000, other=-800, incentiveOut=0, netPnL=700
// Fahed  F: income=5200, incentiveOut=400, netPnL=4800
// totals: income=5200, inflow=1500, costs=400+800=1200, netPnL=5500
// bonus: Farouk T5(1000) + Fahed T5(1000) = 2000 company total
// totalWithBonus = 5500 + 2000 = 7500
results.fleet_hasRevenueBySource = String(fleetPacket.includes("REVENUE BY SOURCE"));
results.fleet_hasNetCollected    = String(fleetPacket.includes("5,200") && fleetPacket.includes("F/S drivers"));
results.fleet_hasRentalIncome    = String(fleetPacket.includes("1,500") && fleetPacket.includes("rental income"));
results.fleet_hasBonusLine       = String(fleetPacket.includes("2,000") && fleetPacket.includes("Bolt bonus"));
results.fleet_hasDealNetPnL      = String(fleetPacket.includes("5,500") && fleetPacket.includes("NET P&L from deals"));
results.fleet_hasTotalWithBonus  = String(fleetPacket.includes("7,500") && fleetPacket.includes("real bottom line"));
results.fleet_hasCarCostNote     = String(fleetPacket.includes("no maintenance"));

console.log(JSON.stringify(results));
'@

$tmpJs = ".\p3_narration_test_tmp.js"
$js | Out-File -FilePath $tmpJs -Encoding utf8 -NoNewline

$_nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($_nodeCmd) { $nodeBin = $_nodeCmd.Source } else { $nodeBin = "$env:LOCALAPPDATA\Programs\kimi-desktop\resources\resources\runtime\node.exe" }
if (-not (Test-Path $nodeBin)) {
  Write-Host "FATAL: node not found."
  exit 1
}

$raw = & $nodeBin $tmpJs 2>&1
$exitCode = $LASTEXITCODE
Remove-Item $tmpJs -ErrorAction SilentlyContinue
if ($exitCode -ne 0) {
  Write-Host "FATAL: node exited $exitCode"
  Write-Host $raw
  exit 1
}
$r = $raw | ConvertFrom-Json

Write-Host ""
Write-Host "-- R model: model-aware P&L + narration ---------------------"
T "R income = 0"                         $r.r_pl_income     "0"
T "R driverNet = 5500"                   $r.r_pl_driverNet  "5500"
T "R netPnL = 700"                       $r.r_pl_netPnL     "700"
T "narration: RENT MODEL label"          $r.r_hasRentModel  "True"
T "narration: driverNet is their money"  $r.r_hasDriverMoney "True"
T "narration: rent in breakdown"         $r.r_hasRentIn     "True"
T "narration: account holder payment"    $r.r_hasHolderPay  "True"
T "narration: car cost no maintenance"   $r.r_hasCarCostNote "True"
T "narration: NET P&L 700 line"          $r.r_netPnLLine    "True"
T "bonus company = 1000 (T5)"           $r.r_bonusCompany  "1000"
T "narration: BOLT BONUS 1000"           $r.r_hasBonusLine  "True"
T "narration: combined 1700"             $r.r_hasCombined   "True"

Write-Host ""
Write-Host "-- F model: collected net + incentive + bonus ----------------"
T "narration: collected to company"      $r.f_hasRevenueLabel  "True"
T "narration: incentive 400 SAR"         $r.f_hasIncentiveLine "True"
T "narration: NET P&L 4800"             $r.f_netPnLLine       "True"
T "narration: BOLT BONUS 1000"           $r.f_hasBonusLine     "True"
T "narration: combined 5800"             $r.f_hasCombined      "True"
T "F below tier: no bonus message"       $r.f3k_hasNoBonusTier "True"

Write-Host ""
Write-Host "-- S model: car cost note + T6 bonus -------------------------"
T "S netPnL = 3400"                      $r.s_netPnL           "3400"
T "narration: car cost 2000"             $r.s_hasCarCostLine   "True"
T "narration: no maintenance note"       $r.s_hasCarNoMaint    "True"
T "narration: BOLT BONUS T6 1250"        $r.s_hasBonusT6       "True"
T "narration: combined 4650"             $r.s_hasCombined      "True"

Write-Host ""
Write-Host "-- Fleet: revenue-by-source + bonus total --------------------"
T "fleet: REVENUE BY SOURCE header"     $r.fleet_hasRevenueBySource "True"
T "fleet: 5200 F/S net collected"       $r.fleet_hasNetCollected    "True"
T "fleet: 1500 rental income R"         $r.fleet_hasRentalIncome    "True"
T "fleet: 2000 Bolt bonus company"      $r.fleet_hasBonusLine       "True"
T "fleet: NET P&L from deals 5500"      $r.fleet_hasDealNetPnL      "True"
T "fleet: total with bonus 7500"        $r.fleet_hasTotalWithBonus  "True"
T "fleet: car cost no maintenance note" $r.fleet_hasCarCostNote     "True"

Write-Host ""
$total = $pass + $fail
Write-Host "-- RESULT: $pass/$total passed -------------------------------"
if ($fail -gt 0) { exit 1 } else { exit 0 }
