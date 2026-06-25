# Build-139 — PS-5.1 mirror of isDetailRequest() + lastWalletQueryContext() (lib/orchestrator.js).
#   (I) detail intent: "what were the entries for" / "detailed expenses" / "breakdown" -> true;
#       plain "last expense" / "total ... on june 23" must NOT be hijacked.
#   (X) anaphora recovery: parse {date, member} back out of the last assistant wallet reply.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build139-itemized-detail-test.ps1

$ErrorActionPreference = "Stop"
$YEAR = (Get-Date).ToUniversalTime().AddHours(3).ToString("yyyy")
$MONTHS = @{ jan=1;feb=2;mar=3;apr=4;may=5;jun=6;jul=7;aug=8;sep=9;oct=10;nov=11;dec=12 }

$DETAIL_EN = '\bdetail(s|ed)?\b|\bbreak\s?down\b|\bitemi[sz]e\b|\bentr(y|ies)\b|\bwhat\b[^?]*\b(were|was|are|is)\b[^?]*\bfor\b|\beach\s+(one|entry|expense)\b'
$DETAIL_AR = 'تفاصيل|فصّل|فصل|على ايش|على إيش|وش هي|ايش هي|كل عملية'
function Test-DetailRequest([string]$r) { return ($r -match $DETAIL_EN) -or ($r -match $DETAIL_AR) }

function Get-LastWalletContext([string[]]$assistantReplies) {
    # newest-first scan (caller passes newest first)
    foreach ($c in $assistantReplies) {
        if ($c -notmatch 'expenses?') { continue }
        $dISO = $null
        if ($c -match '\bon\s+([A-Za-z]{3,9})\s+(\d{1,2})\b') {
            $mo = $MONTHS[$Matches[1].ToLower().Substring(0,3)]
            if ($mo) { $dISO = ("{0}-{1:D2}-{2:D2}" -f $YEAR, $mo, [int]$Matches[2]) }
        }
        $mem = $null
        if ($c -match "([A-Z][a-z]+)(?:'s|’s)\s+(?:expenses?|last)") { $mem = $Matches[1] }
        if ($dISO -or $mem) { return ("{0}|{1}" -f $dISO, $mem) }
    }
    return $null
}

$pass = 0; $fail = 0
$iCases = @(
    @("what were the entries for", "what was the entries for?",                 $true),
    @("details of those 3 entries","what are the details of those 3 entries",   $true),
    @("detailed for sara",         "what is the detailed expenses for sara on the 23rd of june", $true),
    @("breakdown",                 "breakdown of sara's expenses",              $true),
    @("AR tafaseel",               "تفاصيل مصاريف سارة",                          $true),
    @("NOT: last expense",         "what was the last expense sara logged",     $false),
    @("NOT: total on date",        "her total expense on 23rd of june",         $false),
    @("NOT: month total",          "how much did i spend this month",           $false)
)
$xCases = @(
    @("date+member reply", @("Sara's expenses on Jun 23: 763 EGP (3 entries)."), "$YEAR-06-23|Sara"),
    @("member-only reply", @("Sara's last expense: 2,560 EGP today."),           "|Sara"),
    @("non-wallet reply",  @("You've spent 500 SAR this month."),                $null)
)
foreach ($c in $iCases) {
    $got = Test-DetailRequest $c[1]
    if ($got -eq $c[2]) { $pass++; "PASS  I: $($c[0])" } else { $fail++; "FAIL  I: $($c[0])  expected '$($c[2])' got '$got'  <= '$($c[1])'" }
}
foreach ($c in $xCases) {
    $got = Get-LastWalletContext $c[1]
    $ok = ($got -eq $c[2]) -or ($null -eq $got -and $null -eq $c[2])
    if ($ok) { $pass++; "PASS  X: $($c[0])" } else { $fail++; "FAIL  X: $($c[0])  expected '$($c[2])' got '$got'" }
}

""
"Result: $pass passed, $fail failed, $($iCases.Count + $xCases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
