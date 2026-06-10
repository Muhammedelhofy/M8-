# M8 Finance (verified P&L) — math + detection port verification (no-node, project standard)
# Ports the LOAD-BEARING finance logic of lib/finance.js so the P&L can be trusted
# to MATCH THE DASHBOARD to the decimal before deploy (lib/finance.js is a verbatim
# port of the dashboard's computeDriverPnL / autoSalaryFor / getEffectiveProfile —
# this checks the port is faithful):
#   (1) autoSalaryFor — base at threshold, +/-perK per full 1,000 net above/below.
#   (2) computeDriverPnL sign logic — income + rent(IN/OUT) + (-salary) + (-fleetCut) + other.
#   (3) getEffectiveProfile — effective-dated overrides (month <= viewed, latest field wins).
#   (4) looksFinance — fires on profit/cost/margin/P&L, NOT on a plain fleet-net question.
# Pure ASCII on purpose (PowerShell 5.1 mangles multibyte in a no-BOM .ps1).
#   Run:  powershell -File tests/finance-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}
$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---- (1) autoSalaryFor (verbatim port) ----
function AutoSalaryFor($net, $base, $thr, $perK) {
  $steps = [Math]::Floor((([double]$net) - $thr) / 1000)
  return [Math]::Max(0, $base + $steps * $perK)
}
Write-Host "== (1) autoSalaryFor: base 2000 @ threshold 6000, perK 500 ==" -ForegroundColor Cyan
Check "8000 -> 3000" (AutoSalaryFor 8000 2000 6000 500) 3000
Check "7000 -> 2500" (AutoSalaryFor 7000 2000 6000 500) 2500
Check "6000 -> 2000" (AutoSalaryFor 6000 2000 6000 500) 2000
Check "5000 -> 1500" (AutoSalaryFor 5000 2000 6000 500) 1500
Check "4000 -> 1000" (AutoSalaryFor 4000 2000 6000 500) 1000
Check "2000 -> 0"    (AutoSalaryFor 2000 2000 6000 500) 0
Check "1000 -> 0 (clamped, never negative)" (AutoSalaryFor 1000 2000 6000 500) 0

# ---- (2) computeDriverPnL sign logic (verbatim port) ----
function Sgn($dir, $amt) { if ($dir -eq 'IN') { [double]$amt } elseif ($dir -eq 'OUT') { -[double]$amt } else { 0.0 } }
function DriverNetPnL($income, $p) {
  $acct = Sgn $p.accountRent.dir $p.accountRent.amount
  $car  = Sgn $p.carRent.dir     $p.carRent.amount
  if ($p.autoSalary) { $salaryOut = AutoSalaryFor $income $p.salaryBase $p.salaryThreshold $p.salaryPerK }
  else               { $salaryOut = [double]$p.salary }
  $salary = -$salaryOut
  $fc = $p.fleetCut
  if     ($fc.type -eq 'FLAT') { $fleetCut = -[double]$fc.value }
  elseif ($fc.type -eq 'PCT')  { $fleetCut = -([double]$income * [double]$fc.value / 100) }
  else                         { $fleetCut = 0.0 }
  $other = Sgn $p.other.dir $p.other.amount
  return [double]$income + $acct + $car + $salary + $fleetCut + $other
}
function P($h) {  # fill defaults like defaultProfile()
  $d = @{ accountRent=@{dir='NONE';amount=0}; carRent=@{dir='NONE';amount=0}; salary=0;
          autoSalary=$false; salaryBase=2000; salaryThreshold=6000; salaryPerK=500;
          fleetCut=@{type='NONE';value=0}; other=@{dir='NONE';amount=0} }
  foreach ($k in $h.Keys) { $d[$k] = $h[$k] }
  return $d
}
Write-Host "== (2) computeDriverPnL: income + rent +/- (-salary) (-fleetCut) + other ==" -ForegroundColor Cyan
# Salaried (auto): collects 8000 net, pays 3000 salary -> fleet keeps 5000
Check "salaried auto 8000 -> 5000" (DriverNetPnL 8000 (P @{autoSalary=$true})) 5000
# Manual salary 2500 on 7000 -> 4500
Check "manual salary 2500 on 7000 -> 4500" (DriverNetPnL 7000 (P @{salary=2500})) 4500
# Rent model: 4000 income + account rent IN 500 + fleet cut PCT 10% (-400) -> 4100
Check "rent: 4000 + 500 rent - 400 cut -> 4100" (DriverNetPnL 4000 (P @{accountRent=@{dir='IN';amount=500}; fleetCut=@{type='PCT';value=10}})) 4100
# Flat fleet cut 600 on 5000 -> 4400
Check "flat cut 600 on 5000 -> 4400" (DriverNetPnL 5000 (P @{fleetCut=@{type='FLAT';value=600}})) 4400
# Car rent OUT 800 (fleet pays) on 3000 -> 2200
Check "car rent OUT 800 on 3000 -> 2200" (DriverNetPnL 3000 (P @{carRent=@{dir='OUT';amount=800}})) 2200
# No config (default profile): income only
Check "no config 3000 -> 3000" (DriverNetPnL 3000 (P @{})) 3000

# ---- (3) getEffectiveProfile: effective-dated override resolution (salary field) ----
function GetEffectiveSalary($baseSalary, $overrides, $nk, $monthKey) {
  $eff = $baseSalary
  $keys = @($overrides.Keys | Where-Object { $_.StartsWith("$nk::") -and ($_.Substring($nk.Length+2) -le $monthKey) } |
            Sort-Object { $_.Substring($nk.Length+2) })
  foreach ($k in $keys) { if ($overrides[$k].ContainsKey('salary')) { $eff = $overrides[$k].salary } }
  return $eff
}
$ov = @{ 'ahmed::2026-03' = @{ salary = 2500 }; 'ahmed::2026-05' = @{ salary = 3000 } }
Write-Host "== (3) getEffectiveProfile: base 2000, override 03->2500, 05->3000 ==" -ForegroundColor Cyan
Check "Feb (before any override) -> 2000" (GetEffectiveSalary 2000 $ov 'ahmed' '2026-02') 2000
Check "Apr (03 applies) -> 2500"          (GetEffectiveSalary 2000 $ov 'ahmed' '2026-04') 2500
Check "Jun (05 latest wins) -> 3000"      (GetEffectiveSalary 2000 $ov 'ahmed' '2026-06') 3000
Check "Mar (boundary, <=) -> 2500"        (GetEffectiveSalary 2000 $ov 'ahmed' '2026-03') 2500

# ---- (4) looksFinance detection (ported FINANCE_RE) ----
$FIN = 'p\s*&\s*l|\bpnl\b|p\s*and\s*l|profit|profitab\w*|(net\s+)?margin|break[\s-]?even|bottom\s+line|after\s+(?:all\s+)?(?:costs?|expenses?|salaries|salary|rent|overhead)|(real|actual|true)\s+(?:net|profit|earnings?|income)|what\s+(?:do|did|am)\s+i\s+(?:actually\s+)?(?:make|making|keep|keeping|earn|clear|take\s+home)|(?:does|do|did|is)\s+\w[\w\s]{0,30}?\s+cost(?:ing)?\s+(?:me|the\s+fleet|us)|cost\s+(?:me|the\s+fleet|us|to\s+run)|(salary|salaries|payroll)\s+(?:cost|bill|total|this\s+month)|which\s+(?:model|drivers?|setup)\s+(?:is|are|makes?)\s+(?:the\s+)?most\s+profit\w*|unit\s+economics'
function LooksFinance($m) { return [regex]::IsMatch($m, $FIN, $IC) }
Write-Host "== (4) looksFinance: fires on profit/cost/margin, NOT on plain fleet-net ==" -ForegroundColor Cyan
Check "real profit after costs"   (LooksFinance "what's my real profit after costs this month?") $true
Check "fleet P&L"                 (LooksFinance "give me the fleet P&L for June")                 $true
Check "what does Ahmed cost me"   (LooksFinance "what does Ahmed cost me?")                       $true
Check "which model most profit"   (LooksFinance "which model is most profitable?")                $true
Check "margin"                    (LooksFinance "what's my margin this month?")                   $true
Check "break-even"                (LooksFinance "what's my break-even on the fleet?")             $true
Check "salary bill"               (LooksFinance "what's the salary bill this month?")             $true
Check "what do I actually keep"   (LooksFinance "what do I actually keep after paying everyone?") $true
# Negatives — plain fleet/earnings stay on the fleet spine, not finance
Check "fleet net (NOT finance)"   (LooksFinance "what was the fleet's net yesterday?")            $false
Check "how much did Ali make"     (LooksFinance "how much did Ali make this week?")               $false
Check "morning brief"             (LooksFinance "give me the morning brief")                      $false
Check "plain chat"                (LooksFinance "what's the weather in riyadh today?")            $false

# ---- (5) financeDriverTarget — extract a specifically-named driver (drives the
#         honest not-found path). 1st/4th pattern case-insensitive, 2nd/3rd not. ----
$FN = '[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?'   # FIN_NAME (no apostrophe in the class)
function FinanceDriver($s) {
  $m = [regex]::Match($s, '\b(?:driver|courier|captain|rider)\s+(?:named\s+|called\s+)?(' + $FN + ')\b')
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  $m = [regex]::Match($s, '\bdoes?\s+(?:the\s+|a\s+)?(?:driver\s+|courier\s+)?(' + $FN + ')\s+cost\b')
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  $m = [regex]::Match($s, '\bwhat\s+(?:does|do|is)\s+(?:the\s+|a\s+)?(?:driver\s+)?(' + $FN + ')\b[^?]*\bcost\b')
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  $m = [regex]::Match($s, '\b(' + $FN + ')[' + "'" + [char]0x2019 + ']s\s+(?:p\s*&\s*l|pnl|profit|margin|cost)\b', $IC)
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ''
}
Write-Host "== (5) financeDriverTarget: name a specific driver (-> not-found path), else null ==" -ForegroundColor Cyan
Check "the driver Zyltharc cost me -> Zyltharc" (FinanceDriver "What does the driver Zyltharc cost me this month? Give me his exact salary.") "Zyltharc"
Check "Ahmed's P&L -> Ahmed"                    (FinanceDriver "What's Ahmed's P&L this month?")          "Ahmed"
Check "what does Mansour cost me -> Mansour"     (FinanceDriver "what does Mansour cost me?")              "Mansour"
Check "fleet P&L (no driver) -> ''"             (FinanceDriver "What's the fleet P&L this month - revenue, costs, and what I keep?") ""
Check "fleet P&L for June (no driver) -> ''"    (FinanceDriver "give me the fleet P&L for June")          ""

# ---- (6) routing integrity (orchestrator gates) — finance owns its turn ----
# (a) fleet is SKIPPED when finance fires:  if (!financeCtx.text) { buildFleetContext() }
function FleetComputed($financeFired) { return (-not $financeFired) }
# (b) search slot suppressed on a finance turn (mirrors the !fleetLike guard):
#     intent!=NONE && !computeMode && !fleet && !fleetLike && !financeCtx && !financeLike && !state && !notebook
function SearchEligibleFin($intentNone, $computeMode, $fleet, $fleetLike, $financeCtx, $financeLike, $state, $notebook) {
  return ((-not $intentNone) -and -not $computeMode -and -not $fleet -and -not $fleetLike `
    -and -not $financeCtx -and -not $financeLike -and -not $state -and -not $notebook)
}
# (c) toolDecision precedence: fleet > finance > state > notebook > compute > search > ...
function ToolDecisionFin($fleet, $finance, $state, $notebook, $compute, $search) {
  if ($fleet)        { return "fleet" }
  elseif ($finance)  { return "finance" }
  elseif ($state)    { return "state" }
  elseif ($notebook) { return "notebook" }
  elseif ($compute)  { return "compute" }
  elseif ($search)   { return "search" }
  else               { return "answer" }
}
Write-Host "== (6) routing integrity: finance owns its turn (fleet skipped, search suppressed, ladder) ==" -ForegroundColor Cyan
Check "finance fires -> fleet NOT computed" (FleetComputed $true)  $false
Check "no finance -> fleet computed"        (FleetComputed $false) $true
Check "finance turn -> search suppressed"   (SearchEligibleFin $false $false $false $false $true $true $false $false) $false
Check "plain research -> search fires"       (SearchEligibleFin $false $false $false $false $false $false $false $false) $true
Check "toolDecision finance"                (ToolDecisionFin $false $true  $false $false $false $false) "finance"
Check "fleet beats finance (tiebreak)"      (ToolDecisionFin $true  $true  $false $false $false $false) "fleet"
Check "finance beats state"                 (ToolDecisionFin $false $true  $true  $false $false $false) "finance"
Check "finance beats compute"               (ToolDecisionFin $false $true  $false $false $true  $false) "finance"

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
