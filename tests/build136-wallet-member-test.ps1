# Build-136 — PS-5.1 mirror of matchMember() + isBareMemberRef() (lib/orchestrator.js).
# Node is absent on the host, so this mirrors the member-resolution decisions:
#   (A) does a phrase resolve to a household member (Muhammad / Sara) or null?
#   (B) is a phrase a BARE member reference ("and sara") that should resolve to
#       "that member's last expense" when a wallet reply is on screen?
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build136-wallet-member-test.ps1

$ErrorActionPreference = "Stop"

# household members (mirrors getMembers() output for Hofy Home)
$Members = @(
    @{ name = "Muhammad"; aliases = @("muhammad","mohammed","mohamed","mohammad","محمد") },
    @{ name = "Sara";     aliases = @("sara","sarah","سارة","سارا","ساره") }
)

function Get-MatchedMember([string]$text) {
    foreach ($mem in $Members) {
        foreach ($a in $mem.aliases) {
            if ($a -match '[a-z]') {
                $esc = [regex]::Escape($a)
                if ($text -match "\b$esc(?:'s)?\b") { return $mem.name }
            } else {
                if ($text.IndexOf($a) -ge 0) { return $mem.name }
            }
        }
    }
    return $null
}

function Test-BareMemberRef([string]$text, [string]$memName) {
    if (-not $memName) { return $false }
    $mem = $Members | Where-Object { $_.name -eq $memName } | Select-Object -First 1
    $s = " " + $text.ToLower() + " "
    foreach ($a in $mem.aliases) { $s = $s.Replace($a, " ") }
    $s = $s -replace '\b(and|what about|how about|the|one|then|also|too|for|of)\b', ' '
    $s = $s -replace 'و|ماذا عن|كذلك|أيضا|ايضا|عن|بتاع', ' '
    $s = $s -replace '[^\p{L}\p{N}]+', ' '
    return ($s.Trim().Length -eq 0)
}

# --- (A) member resolution ---
$matchCases = @(
    @("EN possessive",   "what is sara's last expense",      "Sara"),
    @("EN spend",        "how much did sara spend this month","Sara"),
    @("EN follow-up",    "and sara",                          "Sara"),
    @("AR muhammad",     "محمد آخر مصروف",                    "Muhammad"),
    @("AR sara bare",    "سارة",                              "Sara"),
    @("no name (my)",    "what's my last expense",            $null),
    @("no name (i)",     "how much did i spend",              $null)
)
# --- (B) bareness (only meaningful when a member matched) ---
$bareCases = @(
    @("bare and-sara",   "and sara",            "Sara", $true),
    @("bare what-about", "what about sara?",    "Sara", $true),
    @("bare AR w-sara",  "وسارة",               "Sara", $true),
    @("not-bare poss",   "sara's last expense", "Sara", $false),
    @("not-bare spend",  "how much did sara spend","Sara", $false)
)

$pass = 0; $fail = 0
foreach ($c in $matchCases) {
    $got = Get-MatchedMember $c[1]
    $ok = ($got -eq $c[2]) -or ($null -eq $got -and $null -eq $c[2])
    if ($ok) { $pass++; "PASS  match: $($c[0])" } else { $fail++; "FAIL  match: $($c[0])  expected '$($c[2])' got '$got'  <= '$($c[1])'" }
}
foreach ($c in $bareCases) {
    $got = Test-BareMemberRef $c[1] $c[2]
    if ($got -eq $c[3]) { $pass++; "PASS  bare:  $($c[0])" } else { $fail++; "FAIL  bare:  $($c[0])  expected '$($c[3])' got '$got'  <= '$($c[1])'" }
}

""
"Result: $pass passed, $fail failed, $($matchCases.Count + $bareCases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
