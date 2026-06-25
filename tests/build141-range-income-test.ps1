# Build-141 — PS-5.1 mirror of parseDateRange() + parseMoneyKind() (lib/orchestrator.js).
# Verifies date-range boundaries (independently computed) and income/net/expense intent.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build141-range-income-test.ps1

$ErrorActionPreference = "Stop"
$MONTHS = @{ jan=1;feb=2;mar=3;apr=4;may=5;jun=6;jul=7;aug=8;sep=9;oct=10;nov=11;dec=12 }
$today = (Get-Date).ToUniversalTime().AddHours(3).Date
function ISO($d) { $d.ToString('yyyy-MM-dd') }
function AddD($iso,$n) { ([datetime]::ParseExact($iso,'yyyy-MM-dd',$null)).AddDays($n).ToString('yyyy-MM-dd') }

function Get-Range([string]$raw) {
    $m = $raw.ToLower(); $t = ISO $today
    if ($m -match '\bbetween\b(.+?)\band\b(.+)') {
        $a = Get-ExpDate $Matches[1]; $b = Get-ExpDate $Matches[2]
        if ($a -and $b) { $lo = if ($a -le $b) { $a } else { $b }; $hi = if ($a -le $b) { $b } else { $a }; return "$lo|$(AddD $hi 1)" }
    }
    if ($m -match '\b(?:last|past)\s+(\d{1,3})\s+days?\b') { $n=[int]$Matches[1]; return "$(AddD $t (-($n-1)))|$(AddD $t 1)" }
    if ($m -match '\blast\s+week\b') { $ws = Get-WeekStart $t; return "$(AddD $ws -7)|$ws" }
    if ($m -match '\bthis\s+week\b') { $ws = Get-WeekStart $t; return "$ws|$(AddD $t 1)" }
    if ($m -match '\blast\s+month\b') { $d=[datetime]::ParseExact("$($t.Substring(0,7))-01",'yyyy-MM-dd',$null).AddMonths(-1); return "$(ISO $d)|$(ISO $d.AddMonths(1))" }
    if ($m -match '\bthis\s+month\b') { $d=[datetime]::ParseExact("$($t.Substring(0,7))-01",'yyyy-MM-dd',$null); return "$(ISO $d)|$(ISO $d.AddMonths(1))" }
    if (-not (Get-ExpDate $m)) {
        if ($m -match '\b(?:in\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b') {
            $mo = $MONTHS[$Matches[1].Substring(0,3)]; $yr = [int]$t.Substring(0,4)
            if ($mo -gt [int]$t.Substring(5,2)) { $yr-- }
            $d = [datetime]::new($yr,$mo,1); return "$(ISO $d)|$(ISO $d.AddMonths(1))"
        }
    }
    return $null
}
function Get-ExpDate([string]$raw) {  # minimal mirror: month-name+day / ISO only (for 'between')
    $m = $raw.ToLower()
    if ($m -match '\b(20\d{2})-(\d{1,2})-(\d{1,2})\b') { return ("{0}-{1:D2}-{2:D2}" -f $Matches[1],[int]$Matches[2],[int]$Matches[3]) }
    $mon='(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
    if ($m -match ('\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?'+$mon+'\b')) { return ("{0}-{1:D2}-{2:D2}" -f $today.Year,$MONTHS[$Matches[2].Substring(0,3)],[int]$Matches[1]) }
    if ($m -match ('\b'+$mon+'\s+(\d{1,2})(?:st|nd|rd|th)?\b'))        { return ("{0}-{1:D2}-{2:D2}" -f $today.Year,$MONTHS[$Matches[1].Substring(0,3)],[int]$Matches[2]) }
    return $null
}
function Get-WeekStart([datetime]$d) { $dow=[int]$d.DayOfWeek; $back=(($dow-6)+7)%7; return ISO $d.AddDays(-$back) }

function Get-MoneyKind([string]$raw) {
    $s = $raw.ToLower()
    if ($s -match '\b(net|profit|bottom line)\b|صافي|ربح') { return 'net' }
    if ($s -match '\b(income|earn(ed|ings)?|revenue|received|deposits?|made|salary)\b|دخل') { return 'income' }
    return 'expense'
}

# independent expected helpers
$tISO = ISO $today
$curStart = "$($tISO.Substring(0,7))-01"
$curEnd   = ISO ([datetime]::ParseExact($curStart,'yyyy-MM-dd',$null).AddMonths(1))
$ws = Get-WeekStart $today

$pass=0; $fail=0
$rCases = @(
    @("this month", "how much did i spend this month", "$curStart|$curEnd"),
    @("this week",  "expenses this week",               "$ws|$(AddD $tISO 1)"),
    @("last week",  "what did sara spend last week",    "$(AddD $ws -7)|$ws"),
    @("last 7 days","spending in the last 7 days",      "$(AddD $tISO -6)|$(AddD $tISO 1)"),
    @("between",    "expenses between june 1 and june 10", "$($today.Year)-06-01|$($today.Year)-06-11"),
    @("single date->null","what did i spend on june 23", $null),
    @("no range->null",  "what is my last expense",      $null)
)
$kCases = @(
    @("earn->income",   "how much did we earn this month", "income"),
    @("net positive",   "are we net positive",            "net"),
    @("profit",         "what's our profit this week",     "net"),
    @("spend->expense", "how much did i spend",            "expense"),
    @("income word",    "our income last month",           "income")
)
foreach ($c in $rCases) {
    $got = Get-Range $c[1]
    $ok = ($got -eq $c[2]) -or ($null -eq $got -and $null -eq $c[2])
    if ($ok) { $pass++; "PASS  R: $($c[0])" } else { $fail++; "FAIL  R: $($c[0])  expected '$($c[2])' got '$got'" }
}
foreach ($c in $kCases) {
    $got = Get-MoneyKind $c[1]
    if ($got -eq $c[2]) { $pass++; "PASS  K: $($c[0])" } else { $fail++; "FAIL  K: $($c[0])  expected '$($c[2])' got '$got'" }
}
""
"Result: $pass passed, $fail failed, $($rCases.Count + $kCases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
