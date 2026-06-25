# Build-151 — PS-5.1 mirror of the FOUNDATION fix (lib/orchestrator.js):
#   (P) person resolution: "my spend"->Muhammad (owner), "Sara"->Sara, "our/total"->null(household)
#   (B) breakdown routing: my-spend->WALLET, vague->CLARIFY (ask wallet/fleet), drivers->FLEET
# NOTE: this mirrors the routing DECISION, not just a parser. The real proof is the live
# phone test (see BUILD151_LIVE_TEST.md) — Node is absent so this approximates looksFleet.
$ErrorActionPreference = "Stop"

function Resolve-Member([string]$msg, [string]$lastNamed) {
    if ($msg -match '\b(sara|سارة|ساره|سارا)\b') { return 'Sara' }
    if ($msg -match '\b(muhammad|mohammed|mohamed|mohammad|محمد)\b') { return 'Muhammad' }
    $fem  = ($msg -match '\b(her|hers|she)\b') -or ($msg -match '\bmy\s+wife\b')
    $masc = ($msg -match '\b(his|him|he)\b') -or ($msg -match '\bmy\s+husband\b')
    $fp = ((($msg -match '\bmy\b') -and ($msg -match '\b(spend|spending|spent|expenses?|paid|cost)\b')) -or ($msg -match '\b(did|do|does|how much did)\s+i\s+(spend|spent|pay|paid)\b')) `
        -and ($msg -notmatch '\bmy\s+wallet\b') -and ($msg -notmatch '\bmy\s+(wife|husband|spouse|partner|brother|sister|son|daughter|mother|father|mom|dad|friend)\b')
    if (-not $fem -and -not $masc -and -not $fp) { return $null }   # household total
    if ($fp -or $masc) { return 'Muhammad' }
    if ($fem) { if ($lastNamed) { return $lastNamed } else { return 'Sara' } }
    return $null
}
function Breakdown-Route([string]$msg, [bool]$walletCtx, [bool]$fleetWords) {
    $wants = (($msg -match '\bbreak\s?down\b') -or ($msg -match '\bbreak it down\b')) -and ($msg -notmatch '\b(entr(?:y|ies)|those|that day|what.*\bfor\b)\b')
    if (-not $wants) { return 'none' }
    $who = Resolve-Member $msg $null
    $period = ($msg -match '\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|june|this month|last month|this week|last week)\b')
    $walletSignal = ($null -ne $who) -or $period -or $walletCtx -or ($msg -match '\bmy\s+(spend|spending|expenses?|wallet)\b|\bwallet\b|\bexpenses?\b') -or ($msg -match 'محفظة|مصروف|مصاريف')
    if ($walletSignal -and -not $fleetWords) { return 'wallet' }
    if (-not ($fleetWords -and -not $walletSignal)) { return 'clarify' }
    return 'fleet'
}

$pass=0; $fail=0
$pCases = @(
    @("my spend->Muhammad",      "what is my spend in june", "",     "Muhammad"),
    @("how much did I spend",    "how much did i spend",     "",     "Muhammad"),
    @("my TOTAL expense->Muh",   "what is my total expense in june", "", "Muhammad"),
    @("Sara->Sara",              "how much did sara spend",  "",     "Sara"),
    @("our total->household",    "what is our total spend",  "",     $null),
    @("total (no my)->household","total spend this month",   "",     $null),
    @("her + ctx Sara",          "what was her last expense","Sara", "Sara")
)
$bCases = @(
    @("my spend breakdown->wallet",  "breakdown of my spend in june", $false, $false, "wallet"),
    @("breakdown of my spend->wallet","what is the breakdown of my spend", $false, $false, "wallet"),
    @("vague->clarify",              "give me the breakdown",         $false, $false, "clarify"),
    @("ctx after total->wallet",     "what's the breakdown",          $true,  $false, "wallet"),
    @("drivers->fleet",              "breakdown of the drivers",      $false, $true,  "fleet"),
    @("those entries->none",         "breakdown of those 3 entries",  $false, $false, "none")
)
foreach ($c in $pCases) {
    $g = Resolve-Member $c[1] $c[2]
    $ok = ($g -eq $c[3]) -or ($null -eq $g -and $null -eq $c[3])
    if ($ok) { $pass++; "PASS  P: $($c[0])" } else { $fail++; "FAIL  P: $($c[0]) exp '$($c[3])' got '$g'" }
}
foreach ($c in $bCases) {
    $g = Breakdown-Route $c[1] $c[2] $c[3]
    if ($g -eq $c[4]) { $pass++; "PASS  B: $($c[0])" } else { $fail++; "FAIL  B: $($c[0]) exp '$($c[4])' got '$g'" }
}
""
"Result: $pass passed, $fail failed, $($pCases.Count + $bCases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
