# M8 Build-6b — compound search->compute port verification (no-node, project standard)
# Ports COMPOUND_HEURISTIC + the orchestrator gate changes so the sequential-
# ownership routing (search owns the live value, compute owns the arithmetic)
# is verified before deploy. Pure ASCII (PS 5.1 mangles no-BOM UTF-8).
#   Run:  powershell -File tests/compound-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}
$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---- ported from lib/orchestrator.js (COMPOUND_CURRENCIES / COMPOUND_HEURISTIC) ----
$CUR = "(?:usd|eur|gbp|jpy|inr|aed|egp|kwd|qar|bhd|omr|try|cny|sar|riyals?|dollars?|euros?|dirhams?|rupees?|lira)"
$COMPOUND = ("\b[\d][\d.,]*\s*k?\s*" + $CUR + "\s+(?:to|in|into)\s+" + $CUR + "\b") `
  + "|" + ("\bconvert\s+\`$?[\d][\d.,]*\s*k?\s*" + $CUR + "\b") `
  + "|" + "\b(?:current|today'?s?|latest|live)\b[^.?!\n]{0,50}\b(?:price|rate|value|exchange)\b[^.?!\n]{0,80}\b\d" `
  + "|" + "\b\d[\d.,]*\s*(?:grams?|kg|kilos?|ounces?|oz|barrels?|shares?|units?|btc|eth)\b[^.?!\n]{0,60}\b(?:current|today'?s?|latest|live|market)\b[^.?!\n]{0,30}\b(?:price|rate|value)\b"
function Compound($msg) { return [regex]::IsMatch($msg, $COMPOUND, $IC) }

# COMPUTE_HEURISTIC slice that overlaps compound (the bug class: 'convert <amount>')
$COMPUTE_CONVERT = "\bconvert\s+\`$?[\d.,]+"

Write-Host "== (1) COMPOUND_HEURISTIC fires on live-value + arithmetic ==" -ForegroundColor Cyan
Check "FX: convert amount A to B + current rate" (Compound "convert 12,500 SAR to USD at the current exchange rate") $true
Check "FX: amount A in B right now"              (Compound "what's 2,500 USD in SAR right now?")                    $true
Check "FX: bare convert amount currency"         (Compound "convert 50,000 SAR to USD")                             $true
Check "commodity: current price + quantity"      (Compound "at the current gold price, what would 250 grams cost me in SAR?") $true
Check "crypto: quantity + today's price"         (Compound "what's 0.37 BTC worth at today's price?")               $true

Write-Host "== (2) COMPOUND_HEURISTIC stays SILENT on self-contained math ==" -ForegroundColor Cyan
Check "fixed-factor: km to miles"        (Compound "convert 250 km to miles")                          $false
Check "pure power"                       (Compound "what is 7 to the power of 13?")                    $false
Check "bill split"                       (Compound "7 people are splitting a 294 SAR restaurant bill equally. How much does each person pay?") $false
Check "fleet net query"                  (Compound "how much did the fleet make in SAR yesterday?")    $false
Check "cash mention, no conversion"      (Compound "I paid 500 SAR in cash to the driver")             $false
Check "transfer to a person"             (Compound "transfer 2,000 SAR to Ahmed for the rent")         $false
Check "plain chat"                       (Compound "the weather in riyadh is nice today")              $false

Write-Host "== (3) the bug class: FX conversion ALSO matches the compute regex ==" -ForegroundColor Cyan
# This is WHY Build-6b exists: computeMode hijacked the turn and Build-6
# suppressed search, so the rate came from training data. Both must be true
# so the compound override is load-bearing.
Check "FX matches COMPUTE convert slice" ([regex]::IsMatch("convert 50,000 SAR to USD", $COMPUTE_CONVERT, $IC)) $true
Check "FX matches COMPOUND too"          (Compound "convert 50,000 SAR to USD")                        $true

# ---- (4) gate ladders (orchestrator.js): compound forces search, owns the turn ----
function CompoundSearchFires($compound,$discovery,$fleet,$fleetLike,$finance,$eosb,$company,$state,$notebook) {
  return ($compound -and -not $discovery -and -not $fleet -and -not $fleetLike -and -not $finance -and -not $eosb -and -not $company -and -not $state -and -not $notebook)
}
function RegularSearchFires($intentNone,$compute,$compound,$discovery,$fleet,$notebook) {
  return ((-not $intentNone) -and -not $compute -and -not $compound -and -not $discovery -and -not $fleet -and -not $notebook)
}
function UseCompute($compute,$routerCompute,$tutor,$discovery,$compound,$fleet,$notebook,$finance,$eosb) {
  return (($compute -or $routerCompute -or $tutor -or $discovery -or $compound) -and -not $fleet -and -not $notebook -and -not $finance -and -not $eosb)
}
function ComputeContract($compute,$routerCompute,$discovery,$compound,$fleet) {
  return (($compute -or $routerCompute -or $discovery) -and -not $compound -and -not $fleet)
}
function ToolDecision($fleet,$state,$notebook,$compound,$compute,$search) {
  if ($fleet) { return 'fleet' } elseif ($state) { return 'state' } elseif ($notebook) { return 'notebook' }
  elseif ($compound) { return 'search_compute' } elseif ($compute) { return 'compute' } elseif ($search) { return 'search' }
  else { return 'answer' }
}

Write-Host "== (4) gates: search fires for compound even when computeMode hijacked ==" -ForegroundColor Cyan
Check "compound search fires"            (CompoundSearchFires $true  $false $false $false $false $false $false $false $false) $true
Check "compound search not on fleet"     (CompoundSearchFires $true  $false $true  $false $false $false $false $false $false) $false
Check "compound search not on discovery" (CompoundSearchFires $true  $true  $false $false $false $false $false $false $false) $false
Check "regular search skips compound"    (RegularSearchFires  $false $false $true  $false $false $false) $false
Check "regular search intact otherwise"  (RegularSearchFires  $false $false $false $false $false $false) $true

Write-Host "== (5) gates: compute fires for compound; compute CONTRACT does not ==" -ForegroundColor Cyan
Check "useCompute on for compound"       (UseCompute $false $false $false $false $true  $false $false $false $false) $true
Check "useCompute off on fleet"          (UseCompute $false $false $false $false $true  $true  $false $false $false) $false
Check "compute contract OFF on compound" (ComputeContract $true  $false $false $true  $false) $false
Check "compute contract ON plain compute"(ComputeContract $true  $false $false $false $false) $true

Write-Host "== (6) toolDecision: compound labelled search_compute, fleet still wins ==" -ForegroundColor Cyan
Check "compound label"                   (ToolDecision $false $false $false $true  $true  $true ) "search_compute"
Check "fleet beats compound"             (ToolDecision $true  $false $false $true  $false $false) "fleet"
Check "notebook beats compound"          (ToolDecision $false $false $true  $true  $false $false) "notebook"
Check "plain compute unchanged"          (ToolDecision $false $false $false $false $true  $false) "compute"

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
