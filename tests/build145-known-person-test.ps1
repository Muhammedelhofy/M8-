# Build-145 — PS-5.1 mirror of the "known person → suppress web search" decision
# (lib/orchestrator.js). knownPersonCard = (name is a household member) OR
# (a recalled PROFILE fact mentions the name). Otherwise the turn web-searches as before.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build145-known-person-test.ps1
$ErrorActionPreference = "Stop"

$Members = @(
    @{ name="Muhammad"; aliases=@("muhammad","mohammed","mohamed","mohammad","محمد") },
    @{ name="Sara";     aliases=@("sara","sarah","سارة","سارا","ساره") }
)
function Match-Member([string]$text) {
    foreach ($mem in $Members) { foreach ($a in $mem.aliases) {
        if ($a -match '[a-z]') { if ($text -match "\b$([regex]::Escape($a))(?:'s)?\b") { return $true } }
        elseif ($text.IndexOf($a) -ge 0) { return $true }
    } }
    return $false
}
# pastMemory profile facts (content strings)
$ProfileFacts = @(
    "Muhammad's wife is Sara; she has her own Family Wallet account.",
    "Muhammad's brother is Omar."
)
function Is-KnownPerson([string]$name) {
    if (Match-Member $name) { return $true }
    $low = $name.ToLower()
    foreach ($f in $ProfileFacts) { if ($f.ToLower().Contains($low)) { return $true } }
    return $false
}

$cases = @(
    @("Sara (member)",        "Sara",     $true),
    @("Muhammad (owner)",     "Muhammad", $true),
    @("Omar (profile fact)",  "Omar",     $true),
    @("Tesla (unknown)",      "Tesla",    $false),
    @("Riyadh (unknown)",     "Riyadh",   $false),
    @("Sara AR",              "سارة",      $true)
)
$pass=0; $fail=0
foreach ($c in $cases) {
    $g = [bool](Is-KnownPerson $c[1])
    if ($g -eq $c[2]) { $pass++; "PASS  $($c[0])" } else { $fail++; "FAIL  $($c[0]) exp '$($c[2])' got '$g'" }
}
""
"Result: $pass passed, $fail failed, $($cases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
