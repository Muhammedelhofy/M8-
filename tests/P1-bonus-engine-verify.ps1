# P1-bonus-engine-verify.ps1 -- offline tests for the Bolt bonus engine (Build P1)
# Covers: bonusFor, bonusGapFor, computeFleetBonusPacket, renderFleetBonusLines
# Run from the M8/ directory: powershell -File tests/P1-bonus-engine-verify.ps1
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

# -- Write a temp JS runner so we don't fight PowerShell quoting --
$js = @'
"use strict";
const {
  bonusFor, bonusGapFor, computeFleetBonusPacket, renderFleetBonusLines, BOLT_BONUS_CONFIG
} = require("./lib/finance");

const results = {};

// ── bonusFor ──────────────────────────────────────────────────────
function bf(net) {
  const r = bonusFor(net);
  return r.grossBonus + "," + r.companyBonus + "," + r.tierFloor;
}
results.bf0    = bf(0);
results.bf3999 = bf(3999);
results.bf4000 = bf(4000);
results.bf4999 = bf(4999);
results.bf5000 = bf(5000);
results.bf5999 = bf(5999);
results.bf6000 = bf(6000);
results.bf7500 = bf(7500);

// custom config: 60% to company
const customCfg = { splitPctToCompany: 0.6, tiers: [{ floor: 5000, gross: 2000 }, { floor: 4000, gross: 1000 }] };
const cust = bonusFor(4500, customCfg);
results.bfCustom = cust.grossBonus + "," + cust.companyBonus + "," + cust.tierFloor;

// ── bonusGapFor ───────────────────────────────────────────────────
function bg(net) {
  const r = bonusGapFor(net);
  if (!r) return "null";
  return r.sarToNextTier + "," + r.bonusUnlocked + "," + r.nextTierFloor;
}
results.bg0    = bg(0);
results.bg3999 = bg(3999);
results.bg4000 = bg(4000);
results.bg4500 = bg(4500);
results.bg5000 = bg(5000);
results.bg5500 = bg(5500);
results.bg6000 = bg(6000);
results.bg7000 = bg(7000);

// ── computeFleetBonusPacket ───────────────────────────────────────
// Synthetic fleet: Ahmed 5200 (T5), Khalid 3800 (none, 200 from T4), Majed 6100 (T6)
const entries = [{
  period: "1 Jun 2026 - 30 Jun 2026",
  periodInfo: { end: { month: 5, year: 2026 } },
  drivers: [
    { name: "Ahmed", netEarnings: 5200 },
    { name: "Khalid", netEarnings: 3800 },
    { name: "Majed", netEarnings: 6100 }
  ]
}];
const packet = computeFleetBonusPacket("2026-06", entries, {}, {});

results.pktGross   = String(packet.totalGross);    // 2000+0+2500 = 4500
results.pktCompany = String(packet.totalCompany);  // 1000+0+1250 = 2250
results.pktLen     = String(packet.driverBonuses.length); // 3

const ahmed  = packet.driverBonuses.find(d => d.name === "Ahmed");
const khalid = packet.driverBonuses.find(d => d.name === "Khalid");
const majed  = packet.driverBonuses.find(d => d.name === "Majed");

results.ahmedTier    = String(ahmed.tierFloor);    // 5000
results.ahmedBonus   = String(ahmed.companyBonus); // 1000
results.khalidTier   = String(khalid.tierFloor);   // null
results.khalidGapSar = String(khalid.gap.sarToNextTier); // 200
results.khalidUnlock = String(khalid.gap.bonusUnlocked); // 750
results.majedTier    = String(majed.tierFloor);    // 6000
results.majedBonus   = String(majed.companyBonus); // 1250

// Ahmed at 5200: next tier is 6k, needs 800 SAR -> unlocks 1250 company
results.ahmedGapSar  = String(ahmed.gap.sarToNextTier); // 800
results.ahmedUnlock  = String(ahmed.gap.bonusUnlocked); // 1250
// Majed at 6100: at max, gap = null
results.majedGap     = String(majed.gap);          // null

// ── renderFleetBonusLines ─────────────────────────────────────────
const lines = renderFleetBonusLines(packet);
results.linesIsArray     = Array.isArray(lines) ? "true" : "false";
results.line0HasHeader   = lines[0].indexOf("BOLT BONUS THIS MONTH") >= 0 ? "true" : "false";
results.line0HasGross    = lines[0].indexOf("4,500") >= 0 ? "true" : "false";  // 4500 SAR gross
results.line0HasCompany  = lines[0].indexOf("2,250") >= 0 ? "true" : "false";  // 2250 SAR company
results.line1HasAhmed    = lines[1].indexOf("Ahmed") >= 0 ? "true" : "false";
results.line1HasMajed    = lines[1].indexOf("Majed") >= 0 ? "true" : "false";
// Khalid is within 500 SAR of T4 (needs 200) -> should appear in nearTier line
results.line2HasKhalid   = lines[2] && lines[2].indexOf("Khalid") >= 0 ? "true" : "false";
results.line2HasSar200   = lines[2] && lines[2].indexOf("200") >= 0 ? "true" : "false";

// renderFleetBonusLines(null) must return []
const nullLines = renderFleetBonusLines(null);
results.nullLinesIsEmpty = (nullLines.length === 0) ? "true" : "false";

// splitPct on packet
results.splitPct = String(packet.splitPct); // 0.5

console.log(JSON.stringify(results));
'@

$tmpJs = ".\p1_bonus_test_tmp.js"
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
Write-Host "-- bonusFor --------------------------------------------------"
T "bf(0)    => 0/0/null"              $r.bf0    "0,0,null"
T "bf(3999) => 0/0/null"              $r.bf3999 "0,0,null"
T "bf(4000) => 1500/750/4000"         $r.bf4000 "1500,750,4000"
T "bf(4999) => 1500/750/4000"         $r.bf4999 "1500,750,4000"
T "bf(5000) => 2000/1000/5000"        $r.bf5000 "2000,1000,5000"
T "bf(5999) => 2000/1000/5000"        $r.bf5999 "2000,1000,5000"
T "bf(6000) => 2500/1250/6000"        $r.bf6000 "2500,1250,6000"
T "bf(7500) => 2500/1250/6000"        $r.bf7500 "2500,1250,6000"
T "bf custom 60pct split @4500"       $r.bfCustom "1000,600,4000"

Write-Host ""
Write-Host "-- bonusGapFor -----------------------------------------------"
T "bg(0)    => 4000 sar, 750, T4"     $r.bg0    "4000,750,4000"
T "bg(3999) => 1 sar, 750, T4"        $r.bg3999 "1,750,4000"
T "bg(4000) => 1000 sar, 1000, T5"    $r.bg4000 "1000,1000,5000"
T "bg(4500) => 500 sar, 1000, T5"     $r.bg4500 "500,1000,5000"
T "bg(5000) => 1000 sar, 1250, T6"    $r.bg5000 "1000,1250,6000"
T "bg(5500) => 500 sar, 1250, T6"     $r.bg5500 "500,1250,6000"
T "bg(6000) => null at max"            $r.bg6000 "null"
T "bg(7000) => null at max"            $r.bg7000 "null"

Write-Host ""
Write-Host "-- computeFleetBonusPacket (3 drivers) -----------------------"
T "totalGross = 4500"                  $r.pktGross    "4500"
T "totalCompany = 2250"                $r.pktCompany  "2250"
T "driverBonuses.length = 3"           $r.pktLen      "3"
T "Ahmed tierFloor = 5000 T5"          $r.ahmedTier   "5000"
T "Ahmed companyBonus = 1000"          $r.ahmedBonus  "1000"
T "Ahmed gap sarToNextTier = 800"      $r.ahmedGapSar "800"
T "Ahmed gap bonusUnlocked = 1250"     $r.ahmedUnlock "1250"
T "Khalid tierFloor = null none"       $r.khalidTier  "null"
T "Khalid gap sarToNextTier = 200"     $r.khalidGapSar "200"
T "Khalid gap bonusUnlocked = 750"     $r.khalidUnlock "750"
T "Majed tierFloor = 6000 T6"          $r.majedTier   "6000"
T "Majed companyBonus = 1250"          $r.majedBonus  "1250"
T "Majed gap = null at max"            $r.majedGap    "null"
T "splitPct = 0.5"                     $r.splitPct    "0.5"

Write-Host ""
Write-Host "-- renderFleetBonusLines -------------------------------------"
T "returns array"                      $r.linesIsArray    "true"
T "line0 has BOLT BONUS header"        $r.line0HasHeader  "true"
T "line0 shows gross 4,500 SAR"        $r.line0HasGross   "true"
T "line0 shows company 2,250 SAR"      $r.line0HasCompany "true"
T "line1 names Ahmed earned T5"        $r.line1HasAhmed   "true"
T "line1 names Majed earned T6"        $r.line1HasMajed   "true"
T "line2 names Khalid near T4"         $r.line2HasKhalid  "true"
T "line2 shows 200 SAR to next"        $r.line2HasSar200  "true"
T "renderFleetBonusLines null = empty" $r.nullLinesIsEmpty "true"

Write-Host ""
$total = $pass + $fail
Write-Host "-- RESULT: $pass/$total passed -------------------------------"
if ($fail -gt 0) { exit 1 } else { exit 0 }
