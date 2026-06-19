# P2-model-aware-verify.ps1 -- offline tests for model-aware P&L (Build P2)
# Covers: computeDriverPnLV2 (R/F/S), computeFleetPnL with V2 flag,
#         legacy mode unchanged, spec S2e worked example.
# Run from the M8/ directory: powershell -File tests\P2-model-aware-verify.ps1
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

$js = @'
"use strict";
const {
  computeDriverPnLV2, computeFleetPnL,
  FLEET_FINANCE_CONFIG, bonusFor
} = require("./lib/finance");

const results = {};

// ── Shared synthetic data helpers ─────────────────────────────────
function makeEntries(drivers, month, year) {
  // month is 0-indexed (Jan=0) to match entryMonthYear convention
  return [{
    period: "1 " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month] + " " + year +
            " - 28 " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month] + " " + year,
    periodInfo: { end: { month: month, year: year } },
    drivers: drivers
  }];
}
// YYYY-MM monthKey where month param is 0-indexed
function mk(year, month0) {
  return year + "-" + String(month0 + 1).padStart(2, "0");
}

// ── computeDriverPnLV2: R model ───────────────────────────────────
// R driver: net 5200, carRent IN 1500, no salary. Company gets rent only (0 net income).
const rentProfiles = {
  "ahmed": {
    model: "R", modelCustom: null,
    carRent: { dir: "IN", amount: 1500 },
    accountRent: { dir: "NONE", amount: 0 },
    salary: 0, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other: { dir: "NONE", amount: 0 },
    startDate: null
  }
};
const rentEntries = makeEntries([{ name: "Ahmed", netEarnings: 5200 }], 5, 2026); // Jun 2026
const rentPl = computeDriverPnLV2("Ahmed", mk(2026, 5), rentEntries, rentProfiles, {});
results.r_income    = String(rentPl.income);    // 0 -- R model, not company's money
results.r_driverNet = String(rentPl.driverNet); // 5200 -- real net, exposed for bonus
results.r_carRent   = String(rentPl.carRent);   // 1500 -- rent the company collects
results.r_netPnL    = String(rentPl.netPnL);    // 1500 (0 + 1500)
results.r_modelAware = String(rentPl._modelAware); // true

// R model with accountRent IN 800 and car rent OUT 0
const rentProfiles2 = {
  "khalid": {
    model: "R", modelCustom: null,
    carRent: { dir: "NONE", amount: 0 },
    accountRent: { dir: "IN", amount: 800 },
    salary: 0, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other: { dir: "NONE", amount: 0 },
    startDate: null
  }
};
const rentEntries2 = makeEntries([{ name: "Khalid", netEarnings: 4200 }], 5, 2026);
const rentPl2 = computeDriverPnLV2("Khalid", mk(2026, 5), rentEntries2, rentProfiles2, {});
results.r2_income  = String(rentPl2.income);   // 0
results.r2_acctRent = String(rentPl2.acctRent); // 800
results.r2_netPnL  = String(rentPl2.netPnL);   // 800

// ── computeDriverPnLV2: F model (fleet-account, same as legacy) ───
const fleetProfiles = {
  "majed": {
    model: "F", modelCustom: null,
    carRent: { dir: "NONE", amount: 0 },
    accountRent: { dir: "NONE", amount: 0 },
    salary: 2000, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other: { dir: "NONE", amount: 0 },
    startDate: null
  }
};
const fleetEntries = makeEntries([{ name: "Majed", netEarnings: 6000 }], 5, 2026);
const fleetPl = computeDriverPnLV2("Majed", mk(2026, 5), fleetEntries, fleetProfiles, {});
results.f_income    = String(fleetPl.income);    // 6000 -- F model: earnings land in company
results.f_driverNet = String(fleetPl.driverNet); // 6000
results.f_salary    = String(fleetPl.salary);    // -2000
results.f_netPnL    = String(fleetPl.netPnL);    // 4000 (6000 - 2000)

// ── computeDriverPnLV2: S model (salaried, same as F) ─────────────
const salProfiles = {
  "sara": {
    model: "S", modelCustom: null,
    carRent: { dir: "NONE", amount: 0 },
    accountRent: { dir: "NONE", amount: 0 },
    salary: 1500, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other: { dir: "NONE", amount: 0 },
    startDate: null
  }
};
const salEntries = makeEntries([{ name: "Sara", netEarnings: 4500 }], 5, 2026);
const salPl = computeDriverPnLV2("Sara", mk(2026, 5), salEntries, salProfiles, {});
results.s_income = String(salPl.income);    // 4500 -- S treated same as F
results.s_netPnL = String(salPl.netPnL);   // 3000 (4500 - 1500)

// ── spec S2e worked example ───────────────────────────────────────
// Rent driver, net 5200, pays 1500 car rent. No salary, no carFixedCost yet.
// Company P&L from computeDriverPnLV2: income=0, carRent=1500, netPnL=1500
// Bonus (separate): bonusFor(5200).companyBonus = 1000
// Combined (as narrated): 1500 + 1000 = 2500 -- matches spec "revenue = 1500 rent + 1000 bonus"
results.s2e_pnl     = String(rentPl.netPnL);                      // 1500
results.s2e_bonus   = String(bonusFor(5200).companyBonus);         // 1000
results.s2e_combined = String(rentPl.netPnL + bonusFor(5200).companyBonus); // 2500

// ── computeFleetPnL with V2 flag ──────────────────────────────────
// Fleet: Ahmed R (net 5200, carRent IN 1500), Majed F (net 6000, salary 2000)
const mixedProfiles = { ...rentProfiles, ...fleetProfiles };
const mixedEntries = makeEntries([
  { name: "Ahmed", netEarnings: 5200 },
  { name: "Majed", netEarnings: 6000 }
], 5, 2026);
const v2Fleet = computeFleetPnL(mk(2026, 5), mixedEntries, mixedProfiles, {}, { modelAwarePnL: true });
// Ahmed R: income=0, carRent=+1500, netPnL=1500
// Majed F: income=6000, salary=-2000, netPnL=4000
// totals: income=6000 (only Majed's), inflow=1500 (Ahmed's rent), costs=2000, netPnL=5500
results.v2_income   = String(v2Fleet.totals.income);   // 6000
results.v2_inflow   = String(v2Fleet.totals.inflow);   // 1500
results.v2_costs    = String(v2Fleet.totals.costs);    // 2000
results.v2_netPnL   = String(v2Fleet.totals.netPnL);  // 5500
results.v2_drivers  = String(v2Fleet.totals.drivers);  // 2
results.v2_flag     = String(v2Fleet.modelAware);      // true

// ── legacy mode unchanged (same fleet, V2 flag OFF) ───────────────
const legacyFleet = computeFleetPnL(mk(2026, 5), mixedEntries, mixedProfiles, {}, { modelAwarePnL: false });
// Ahmed R legacy: income=5200, carRent=+1500, netPnL=5200+1500=6700 (old inflated number)
// Majed F: 6000 - 2000 = 4000
// totals: income=11200, inflow=1500, costs=2000, netPnL=11200+1500-2000=10700... wait
// Actually let me recalculate:
// Ahmed: income=5200, acctRent=0, carRent=1500, salary=0, fleetCut=0, other=0, netPnL=6700
// inFlow = max(0,0) + max(0,1500) + max(0,0) = 1500
// outFlow = 0+0+0+0+0 = 0
// Majed: income=6000, salary=-2000, netPnL=4000
// inFlow = 0, outFlow = 2000
// totals: income=11200, inflow=1500, costs=2000, netPnL=10700
results.leg_income  = String(legacyFleet.totals.income);  // 11200
results.leg_netPnL  = String(legacyFleet.totals.netPnL);  // 10700
results.leg_flag    = String(legacyFleet.modelAware);     // false

// Default (no financeConfig arg) should use FLEET_FINANCE_CONFIG default (false)
const defaultFleet = computeFleetPnL(mk(2026, 5), mixedEntries, mixedProfiles, {});
results.def_flag = String(defaultFleet.modelAware); // false (default off)

console.log(JSON.stringify(results));
'@

$tmpJs = ".\p2_model_aware_test_tmp.js"
$js | Out-File -FilePath $tmpJs -Encoding utf8 -NoNewline

# Locate node: PATH first, then Kimi bundled runtime
$_nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($_nodeCmd) { $nodeBin = $_nodeCmd.Source } else { $nodeBin = "$env:LOCALAPPDATA\Programs\kimi-desktop\resources\resources\runtime\node.exe" }
if (-not (Test-Path $nodeBin)) {
  Write-Host "FATAL: node not found. Add Node.js to PATH or install it from nodejs.org."
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
Write-Host "-- computeDriverPnLV2: R model (Rent) -----------------------"
T "income = 0 not company revenue"      $r.r_income     "0"
T "driverNet = 5200 exposed for tier"   $r.r_driverNet  "5200"
T "carRent = 1500 company collects"     $r.r_carRent    "1500"
T "netPnL = 1500 rent only"             $r.r_netPnL     "1500"
T "_modelAware flag = true"             $r.r_modelAware "true"
T "acctRent IN 800 income=0 pnl=800"    $r.r2_netPnL    "800"
T "R+acctRent income still 0"           $r.r2_income    "0"
T "R+acctRent acctRent = 800"           $r.r2_acctRent  "800"

Write-Host ""
Write-Host "-- computeDriverPnLV2: F model (Fleet-account) --------------"
T "income = 6000 company collects"      $r.f_income     "6000"
T "driverNet = 6000"                    $r.f_driverNet  "6000"
T "salary = -2000"                      $r.f_salary     "-2000"
T "netPnL = 4000"                       $r.f_netPnL     "4000"

Write-Host ""
Write-Host "-- computeDriverPnLV2: S model (Salaried) -------------------"
T "income = 4500 same as F"             $r.s_income     "4500"
T "netPnL = 3000"                       $r.s_netPnL     "3000"

Write-Host ""
Write-Host "-- Spec S2e worked example -----------------------------------"
T "P2 PnL for rent driver = 1500"       $r.s2e_pnl      "1500"
T "bonus companyShare 5200 = 1000"      $r.s2e_bonus    "1000"
T "combined rent+bonus = 2500"          $r.s2e_combined "2500"

Write-Host ""
Write-Host "-- computeFleetPnL V2 flag ON mixed fleet -------------------"
T "income = 6000 Majed only Ahmed R"    $r.v2_income    "6000"
T "inflow = 1500 Ahmed rent"            $r.v2_inflow    "1500"
T "costs = 2000 Majed salary"           $r.v2_costs     "2000"
T "netPnL = 5500"                       $r.v2_netPnL    "5500"
T "drivers = 2"                         $r.v2_drivers   "2"
T "modelAware flag = true"              $r.v2_flag      "true"

Write-Host ""
Write-Host "-- Legacy mode unchanged V2 flag OFF -------------------------"
T "legacy income = 11200 inflated"      $r.leg_income   "11200"
T "legacy netPnL = 10700"               $r.leg_netPnL   "10700"
T "legacy modelAware = false"           $r.leg_flag     "false"
T "default no config = false"           $r.def_flag     "false"

Write-Host ""
$total = $pass + $fail
Write-Host "-- RESULT: $pass/$total passed -------------------------------"
if ($fail -gt 0) { exit 1 } else { exit 0 }
