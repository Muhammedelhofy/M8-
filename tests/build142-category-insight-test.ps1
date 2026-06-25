# Build-142 — PS-5.1 mirror of parseCategoryInsight() (lib/orchestrator.js).
# "where is the money going" / "top categories" / "spending by category" -> breakdown;
# single-category or flat-total queries must NOT trigger it.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build142-category-insight-test.ps1

$ErrorActionPreference = "Stop"
$EN = '\bwhere\b[^?]*\b(money|spend|spent|spending)\b[^?]*\b(go|going|goes)\b|\btop\s+(categor|spend|expense)|\bbiggest\s+(categor|expense|spend)|\bby\s+categor|\bcategor(y|ies)\s+breakdown\b|\bbreakdown\s+by\s+categor|\bwhat\b[^?]*\bspending\b[^?]*\b(on|most)\b|\bspending\s+by\b'
$AR = 'وين.{0,14}(الفلوس|المصاريف|نصرف|اصرف)|أكثر.{0,12}(تصنيف|فئة|مصروف|بند)|على ايش.{0,12}(اصرف|نصرف|بصرف|يصرف)|تصنيف المصاريف|توزيع المصاريف'
function Test-CatInsight([string]$r) { return ($r -match $EN) -or ($r -match $AR) }

$cases = @(
    @("where money going",   "where is the money going",                 $true),
    @("where sara money",    "where is sara's money going this month",    $true),
    @("top categories",      "top categories this month",                 $true),
    @("spending most on",    "what am I spending the most on",            $true),
    @("spending by cat",     "show me spending by category",              $true),
    @("biggest expense",     "biggest expense category last week",        $true),
    @("AR ween el floos",    "وين تروح الفلوس",                            $true),
    @("NOT flat total",      "how much did I spend this month",           $false),
    @("NOT last expense",    "what was sara's last expense",              $false),
    @("NOT single cat",      "how much on groceries",                     $false),
    @("NOT income",          "how much did we earn this month",           $false)
)
$pass=0; $fail=0
foreach ($c in $cases) {
    $got = Test-CatInsight $c[1]
    if ($got -eq $c[2]) { $pass++; "PASS  $($c[0])" } else { $fail++; "FAIL  $($c[0])  expected '$($c[2])' got '$got'  <= '$($c[1])'" }
}
""
"Result: $pass passed, $fail failed, $($cases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
