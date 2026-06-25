# Build-146 — PS-5.1 mirror of parsePaymentCheck() (lib/orchestrator.js).
# "did I pay the rent?" -> "rent"; "how much did I pay for X" -> null (spend query).
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build146-payment-check-test.ps1
$ErrorActionPreference = "Stop"

function Clean-PayTerm([string]$t) {
    $s = $t -replace '(?i)\b(bill|the|my|our|for|already|yet|this month|this week)\b',' '
    $s = $s -replace 'فاتورة|الفاتورة',' '
    $s = $s -replace '[?؟.!,]',' '
    $s = ($s -replace '\s+',' ').Trim()
    return $s
}
function Parse-PaymentCheck([string]$raw) {
    $m = $raw.ToLower()
    if ($m -match '\bhow (much|many)\b') { return $null }
    if ($m -match '\b(?:did|have|has|have we|did we)\s+(?:i|we|you)\s+(?:already\s+)?(?:pay|paid)\s+(?:for\s+|the\s+|my\s+|our\s+)?(.+?)(?:\s+bill)?\s*\??$') {
        $t = Clean-PayTerm $Matches[1]; if ($t) { return $t } else { return $null }
    }
    if ($m -match '\bis\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:bill\s+)?paid\b') {
        $t = Clean-PayTerm $Matches[1]; if ($t) { return $t } else { return $null }
    }
    if ($raw -match 'هل\s+(?:دفعت|دفعنا)\s+(.+?)\s*[?؟]?$') {
        $t = Clean-PayTerm $Matches[1]; if ($t) { return $t } else { return $null }
    }
    return $null
}

$cases = @(
    @("did I pay the rent",        "did I pay the rent?",                "rent"),
    @("have we paid electricity",  "have we paid electricity?",          "electricity"),
    @("is the internet bill paid", "is the internet bill paid?",         "internet"),
    @("did I pay for groceries",   "did I pay for groceries",            "groceries"),
    @("how much -> null",          "how much did I pay for groceries",   $null),
    @("last expense -> null",      "what was my last expense",           $null),
    @("AR hal dafa3t",             "هل دفعت الايجار؟",                     "الايجار")
)
$pass=0; $fail=0
foreach ($c in $cases) {
    $g = Parse-PaymentCheck $c[1]
    $ok = ($g -eq $c[2]) -or ($null -eq $g -and $null -eq $c[2])
    if ($ok) { $pass++; "PASS  $($c[0])" } else { $fail++; "FAIL  $($c[0]) exp '$($c[2])' got '$g'" }
}
""
"Result: $pass passed, $fail failed, $($cases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
