# Build-143 — PS-5.1 mirror of parseComparison / parseBudgetQuery / parseBillsQuery.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build143-compare-budgets-test.ps1
$ErrorActionPreference = "Stop"

function Get-Comparison([string]$raw) {
    $s = $raw.ToLower()
    if (($s -match '\b(more|less|higher|lower)\b[^.]*\b(than|vs|versus|compared to)\b[^.]*\b(last|previous)\s+(month|week)\b') `
        -or ($s -match '\bthis\s+(month|week)\s+(vs|versus|compared to|against)\s+last\b') `
        -or ($s -match '\bcompared?\s+to\s+last\s+(month|week)\b')) { return 'period' }
    if (($s -match '\b(vs|versus)\b') -or ($s -match '\bcompare\b') -or ($s -match '\bwho\s+(spent|spends|spend)\s+(more|most|less)\b') -or ($s -match '\b(more|less)\s+than\b')) { return 'members' }
    return $null
}
function Test-Budget([string]$r) { return ($r -match '\bbudgets?\b|\bover\s?budget\b|\bwithin budget\b|\bbudget\s+(status|left|remaining)\b') -or ($r -match 'ميزانية|الميزانية') }
function Test-Bills([string]$r) { return ($r -match '\bbills?\b.*\b(due|upcoming|pending|owe|coming)\b|\b(upcoming|due|pending)\b.*\bbills?\b|\bwhat bills\b|\bany bills\b|\bbills?\s+this\b') -or ($r -match 'فواتير|الفواتير|فاتورة') }

$pass=0; $fail=0
$cmp = @(
    @("vs members", "Sara vs me this month", "members"),
    @("who spent more", "who spent more this month", "members"),
    @("compare", "compare our spending", "members"),
    @("more than last month", "am I spending more than last month", "period"),
    @("this vs last", "this month vs last month", "period"),
    @("null last expense", "what was my last expense", $null),
    @("null spend", "how much did i spend this month", $null)
)
$bud = @(
    @("over budget", "am I over budget", $true),
    @("budget status", "budget status", $true),
    @("AR meezania", "كيف الميزانية", $true),
    @("not", "how much did i spend", $false)
)
$bil = @(
    @("bills due", "what bills are due", $true),
    @("upcoming bills", "upcoming bills", $true),
    @("any bills", "any bills this week", $true),
    @("AR fawateer", "عندي فواتير", $true),
    @("not", "how much did i spend", $false)
)
foreach ($c in $cmp) { $g = Get-Comparison $c[1]; $ok = ($g -eq $c[2]) -or ($null -eq $g -and $null -eq $c[2]); if ($ok){$pass++;"PASS  C:$($c[0])"}else{$fail++;"FAIL  C:$($c[0]) exp '$($c[2])' got '$g'"} }
foreach ($c in $bud) { $g = [bool](Test-Budget $c[1]); if ($g -eq $c[2]){$pass++;"PASS  Bd:$($c[0])"}else{$fail++;"FAIL  Bd:$($c[0]) exp '$($c[2])' got '$g'"} }
foreach ($c in $bil) { $g = [bool](Test-Bills $c[1]); if ($g -eq $c[2]){$pass++;"PASS  Bl:$($c[0])"}else{$fail++;"FAIL  Bl:$($c[0]) exp '$($c[2])' got '$g'"} }
""
"Result: $pass passed, $fail failed, $($cmp.Count + $bud.Count + $bil.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
