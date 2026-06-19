# P3a-driver-incentive-verify.ps1 -- offline tests for F-model driver incentive (Build P3a)
# Covers: driverIncentiveFor (default + profile override), computeDriverPnLV2 F/R/S,
#         fleet outFlow includes incentiveOut, modelAwarePnL now ON by default.
# Run from the M8/ directory: powershell -File tests\P3a-driver-incentive-verify.ps1
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
  driverIncentiveFor, computeDriverPnLV2, computeFleetPnL,
  DRIVER_INCENTIVE_CONFIG, FLEET_FINANCE_CONFIG
} = require("./lib/finance");

const results = {};

// ── driverIncentiveFor: default config ────────────────────────────
results.di0    = String(driverIncentiveFor(0,    {}));  // 0
results.di4999 = String(driverIncentiveFor(4999, {}));  // 0
results.di5000 = String(driverIncentiveFor(5000, {}));  // 400
results.di5999 = String(driverIncentiveFor(5999, {}));  // 400
results.di6000 = String(driverIncentiveFor(6000, {}));  // 750
results.di7000 = String(driverIncentiveFor(7000, {}));  // 750

// ── driverIncentiveFor: profile-level override ────────────────────
// Custom deal: 600 at 5k, 900 at 6k
const customProfile = {
  driverIncentive: {
    tiers: [{ floor: 6000, amount: 900 }, { floor: 5000, amount: 600 }]
  }
};
results.diCustom5k = String(driverIncentiveFor(5200, customProfile)); // 600
results.diCustom6k = String(driverIncentiveFor(6100, customProfile)); // 900
results.diCustom4k = String(driverIncentiveFor(4999, customProfile)); // 0

// ── FLEET_FINANCE_CONFIG.modelAwarePnL is now ON ──────────────────
results.switchOn = String(FLEET_FINANCE_CONFIG.modelAwarePnL); // true

// ── computeDriverPnLV2: F model with incentive ────────────────────
// F driver: net 5200. Incentive: 400 (at 5k). No salary, no rent.
// income = 5200 (F model), incentiveOut = 400, netPnL = 5200 - 400 = 4800
function makeEntries(drivers, month0, year) {
  return [{
    period: "1 Jun " + year + " - 28 Jun " + year,
    periodInfo: { end: { month: month0, year: year } },
    drivers: drivers
  }];
}
const fProfiles = {
  "fahed": {
    model: "F", modelCustom: null,
    carRent: { dir: "NONE", amount: 0 },
    accountRent: { dir: "NONE", amount: 0 },
    salary: 0, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other: { dir: "NONE", amount: 0 },
    startDate: null
  }
};
const fEntries = makeEntries([{ name: "Fahed", netEarnings: 5200 }], 5, 2026);
const fPl = computeDriverPnLV2("Fahed", "2026-06", fEntries, fProfiles, {});
results.f_income      = String(fPl.income);       // 5200
results.f_incentive   = String(fPl.incentiveOut); // 400
results.f_netPnL      = String(fPl.netPnL);       // 4800

// F driver at 6k: incentive = 750, netPnL = 6000 - 750 = 5250
const fEntries6k = makeEntries([{ name: "Fahed", netEarnings: 6000 }], 5, 2026);
const fPl6k = computeDriverPnLV2("Fahed", "2026-06", fEntries6k, fProfiles, {});
results.f6k_incentive = String(fPl6k.incentiveOut); // 750
results.f6k_netPnL    = String(fPl6k.netPnL);       // 5250

// F driver below 5k: incentive = 0
const fEntries4k = makeEntries([{ name: "Fahed", netEarnings: 4000 }], 5, 2026);
const fPl4k = computeDriverPnLV2("Fahed", "2026-06", fEntries4k, fProfiles, {});
results.f4k_incentive = String(fPl4k.incentiveOut); // 0
results.f4k_netPnL    = String(fPl4k.netPnL);       // 4000

// F driver with custom profile override (600 at 5k)
const fProfilesCustom = { "fahed": { ...fProfiles["fahed"], driverIncentive: { tiers: [{ floor: 5000, amount: 600 }] } } };
const fPlCustom = computeDriverPnLV2("Fahed", "2026-06", fEntries, fProfilesCustom, {});
results.f_customIncentive = String(fPlCustom.incentiveOut); // 600
results.f_customNetPnL    = String(fPlCustom.netPnL);       // 4600

// ── R model: incentiveOut = 0 (foreigners get no incentive) ───────
const rProfiles = {
  "ahmad": {
    model: "R", modelCustom: null,
    carRent: { dir: "IN", amount: 1000 },
    accountRent: { dir: "IN", amount: 500 },
    salary: 0, autoSalary: false,
    fleetCut: { type: "NONE", value: 0 },
    other: { dir: "OUT", amount: 800 },
    startDate: null
  }
};
const rEntries = makeEntries([{ name: "Ahmad", netEarnings: 6000 }], 5, 2026);
const rPl = computeDriverPnLV2("Ahmad", "2026-06", rEntries, rProfiles, {});
results.r_income    = String(rPl.income);       // 0
results.r_incentive = String(rPl.incentiveOut); // 0
results.r_netPnL    = String(rPl.netPnL);       // 1000+500-800 = 700

// ── S model: incentiveOut = 0 (salaried gets salary not incentive) ─
const sProfiles = {
  "sam": {
    model: "S", modelCustom: null,
    carRent: { dir: "NONE", amount: 0 },
    accountRent: { dir: "OUT", amount: 600 },
    salary: 0, autoSalary: true,
    salaryBase: 4000, salaryThreshold: 10000, salaryPerK: 500,
    fleetCut: { type: "NONE", value: 0 },
    other: { dir: "NONE", amount: 0 },
    startDate: null
  }
};
const sEntries = makeEntries([{ name: "Sam", netEarnings: 10000 }], 5, 2026);
const sPl = computeDriverPnLV2("Sam", "2026-06", sEntries, sProfiles, {});
results.s_income    = String(sPl.income);       // 10000
results.s_salary    = String(sPl.salary);       // -4000 (autoSalary at 10k)
results.s_acctRent  = String(sPl.acctRent);     // -600 (company pays Saudi account holder)
results.s_incentive = String(sPl.incentiveOut); // 0
results.s_netPnL    = String(sPl.netPnL);       // 10000 - 4000 - 600 = 5400

// ── Fleet-level: incentiveOut appears in totals.costs ─────────────
// Fleet: Fahed F (net 5200, incentive 400), Ahmad R (net 6000, carRent+acctRent in, out 800)
const mixedProfiles = { ...fProfiles, ...rProfiles };
const mixedEntries = makeEntries([
  { name: "Fahed", netEarnings: 5200 },
  { name: "Ahmad", netEarnings: 6000 }
], 5, 2026);
// Use default config (modelAwarePnL: true now)
const fleet = computeFleetPnL("2026-06", mixedEntries, mixedProfiles, {});
// Fahed F: income=5200, incentiveOut=400, netPnL=4800, outFlow=400
// Ahmad R: income=0, acctRent=+500, carRent=+1000, other=-800, netPnL=700, outFlow=800
// totals: income=5200, inflow=1500, costs=400+800=1200, netPnL=4800+700=5500
results.fleet_income  = String(fleet.totals.income);  // 5200
results.fleet_inflow  = String(fleet.totals.inflow);  // 1500
results.fleet_costs   = String(fleet.totals.costs);   // 1200 (400 incentive + 800 Saudi holder)
results.fleet_netPnL  = String(fleet.totals.netPnL);  // 5500
results.fleet_aware   = String(fleet.modelAware);     // true

console.log(JSON.stringify(results));
'@

$tmpJs = ".\p3a_incentive_test_tmp.js"
$js | Out-File -FilePath $tmpJs -Encoding utf8 -NoNewline

$_nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($_nodeCmd) { $nodeBin = $_nodeCmd.Source } else { $nodeBin = "$env:LOCALAPPDATA\Programs\kimi-desktop\resources\resources\runtime\node.exe" }
if (-not (Test-Path $nodeBin)) {
  Write-Host "FATAL: node not found. Add Node.js to PATH or install from nodejs.org."
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
Write-Host "-- driverIncentiveFor default config -------------------------"
T "di(0)    = 0"                       $r.di0    "0"
T "di(4999) = 0"                       $r.di4999 "0"
T "di(5000) = 400"                     $r.di5000 "400"
T "di(5999) = 400"                     $r.di5999 "400"
T "di(6000) = 750"                     $r.di6000 "750"
T "di(7000) = 750"                     $r.di7000 "750"

Write-Host ""
Write-Host "-- driverIncentiveFor profile override -----------------------"
T "custom 5200 = 600"                  $r.diCustom5k "600"
T "custom 6100 = 900"                  $r.diCustom6k "900"
T "custom 4999 = 0"                    $r.diCustom4k "0"

Write-Host ""
Write-Host "-- modelAwarePnL switch now ON --------------------------------"
T "FLEET_FINANCE_CONFIG.modelAwarePnL" $r.switchOn "true"

Write-Host ""
Write-Host "-- computeDriverPnLV2 F model with incentive -----------------"
T "F at 5200: income = 5200"           $r.f_income      "5200"
T "F at 5200: incentiveOut = 400"      $r.f_incentive   "400"
T "F at 5200: netPnL = 4800"           $r.f_netPnL      "4800"
T "F at 6000: incentiveOut = 750"      $r.f6k_incentive "750"
T "F at 6000: netPnL = 5250"           $r.f6k_netPnL    "5250"
T "F at 4000: incentiveOut = 0"        $r.f4k_incentive "0"
T "F at 4000: netPnL = 4000"           $r.f4k_netPnL    "4000"
T "F custom override 5200 = 600"       $r.f_customIncentive "600"
T "F custom netPnL = 4600"             $r.f_customNetPnL    "4600"

Write-Host ""
Write-Host "-- R model: no incentive (foreigner keeps own net) -----------"
T "R income = 0"                       $r.r_income    "0"
T "R incentiveOut = 0"                 $r.r_incentive "0"
T "R netPnL = 700 (rent - holder)"     $r.r_netPnL    "700"

Write-Host ""
Write-Host "-- S model: no incentive (gets salary instead) ---------------"
T "S income = 10000"                   $r.s_income    "10000"
T "S salary = -4000 autoSalary"        $r.s_salary    "-4000"
T "S acctRent = -600 OUT to Saudi"     $r.s_acctRent  "-600"
T "S incentiveOut = 0"                 $r.s_incentive "0"
T "S netPnL = 5400"                    $r.s_netPnL    "5400"

Write-Host ""
Write-Host "-- Fleet totals: incentiveOut in costs -----------------------"
T "fleet income = 5200"                $r.fleet_income "5200"
T "fleet inflow = 1500"                $r.fleet_inflow "1500"
T "fleet costs = 1200"                 $r.fleet_costs  "1200"
T "fleet netPnL = 5500"                $r.fleet_netPnL "5500"
T "fleet modelAware = true"            $r.fleet_aware  "true"

Write-Host ""
$total = $pass + $fail
Write-Host "-- RESULT: $pass/$total passed -------------------------------"
if ($fail -gt 0) { exit 1 } else { exit 0 }
