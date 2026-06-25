# Build-138 — PS-5.1 mirror of parseExpenseDate() + resolveMemberCtx() pronoun logic.
#   (D) date parsing: "23rd of june" / "june 23" / "yesterday" / ISO -> YYYY-MM-DD; amounts -> null
#   (P) pronoun resolution: "her"/"his" -> member via conversation context, then gendered fallback
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build138-pronoun-date-test.ps1

$ErrorActionPreference = "Stop"

$KSA_TODAY = (Get-Date).ToUniversalTime().AddHours(3).ToString("yyyy-MM-dd")
$KSA_YDAY  = (Get-Date).ToUniversalTime().AddHours(3).AddDays(-1).ToString("yyyy-MM-dd")
$YEAR      = $KSA_TODAY.Substring(0,4)
$MONTHS = @{ jan=1;feb=2;mar=3;apr=4;may=5;jun=6;jul=7;aug=8;sep=9;oct=10;nov=11;dec=12 }

function Get-ExpenseDate([string]$raw) {
    $m = $raw.ToLower()
    if ($m -match '\byesterday\b' -or $raw -match 'أمس|امس|البارحة') { return $KSA_YDAY }
    if ($m -match '\btoday\b'     -or $raw -match 'اليوم')          { return $KSA_TODAY }
    if ($m -match '\b(20\d{2})-(\d{1,2})-(\d{1,2})\b') {
        return ("{0}-{1:D2}-{2:D2}" -f $Matches[1], [int]$Matches[2], [int]$Matches[3])
    }
    $mon = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
    $day = $null; $moName = $null
    if ($m -match ('\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?' + $mon + '\b')) { $day = [int]$Matches[1]; $moName = $Matches[2] }
    elseif ($m -match ('\b' + $mon + '\s+(\d{1,2})(?:st|nd|rd|th)?\b'))        { $day = [int]$Matches[2]; $moName = $Matches[1] }
    if ($day -and $moName) {
        $mo = $MONTHS[$moName.Substring(0,3)]
        if ($mo -and $day -ge 1 -and $day -le 31) { return ("{0}-{1:D2}-{2:D2}" -f $YEAR, $mo, $day) }
    }
    return $null
}

# members + matchMember (mirror of Build-136)
$Members = @(
    @{ name="Muhammad"; role="owner";  aliases=@("muhammad","mohammed","mohamed","mohammad","محمد") },
    @{ name="Sara";     role="member"; aliases=@("sara","sarah","سارة","سارا","ساره") }
)
function Get-MatchedMember([string]$text) {
    foreach ($mem in $Members) { foreach ($a in $mem.aliases) {
        if ($a -match '[a-z]') { if ($text -match "\b$([regex]::Escape($a))(?:'s)?\b") { return $mem.name } }
        elseif ($text.IndexOf($a) -ge 0) { return $mem.name }
    } }
    return $null
}
# resolveMemberCtx: $lastNamed = member name found by scanning history (or $null)
function Resolve-MemberCtx([string]$message, [string]$lastNamed) {
    $explicit = Get-MatchedMember $message
    if ($explicit) { return $explicit }
    $fem  = ($message -match '\b(her|hers|she)\b') -or ($message -match '\bmy\s+wife\b') -or ($message -match 'هي|لها|زوجتي')
    $masc = ($message -match '\b(his|him|he)\b')   -or ($message -match '\bmy\s+husband\b') -or ($message -match 'هو|له|زوجي')
    if (-not $fem -and -not $masc) { return $null }
    if ($lastNamed) { return $lastNamed }                       # conversation context wins
    if ($fem)  { return ($Members | Where-Object { $_.role -ne 'owner' } | Select-Object -First 1).name }
    if ($masc) { return ($Members | Where-Object { $_.role -eq 'owner' } | Select-Object -First 1).name }
    return $null
}

$pass = 0; $fail = 0
$dCases = @(
    @("23rd of june", "what were her total expenses on 23rd of june", "$YEAR-06-23"),
    @("june 23",      "sara expenses june 23",                        "$YEAR-06-23"),
    @("23 june",      "what did she spend 23 june",                   "$YEAR-06-23"),
    @("ISO",          "expenses on 2026-06-23",                       "2026-06-23"),
    @("yesterday",    "what did i spend yesterday",                   $KSA_YDAY),
    @("today",        "expenses today",                               $KSA_TODAY),
    @("amount->null", "add 50 sar lunch",                             $null),
    @("month-only->null","how much this month",                      $null)
)
$pCases = @(
    @("her + ctx Sara",  "what was her last expense", "Sara", "Sara"),
    @("her total + ctx", "her total expenses on june 23", "Sara", "Sara"),
    @("her no ctx->nonowner", "what was her last expense", $null, "Sara"),
    @("he no ctx->owner", "what did he spend this month", $null, "Muhammad"),
    @("explicit name",   "sara last expense", $null, "Sara"),
    @("no pronoun->null","what is my last expense", $null, $null)
)
foreach ($c in $dCases) {
    $got = Get-ExpenseDate $c[1]
    $ok = ($got -eq $c[2]) -or ($null -eq $got -and $null -eq $c[2])
    if ($ok) { $pass++; "PASS  D: $($c[0])" } else { $fail++; "FAIL  D: $($c[0])  expected '$($c[2])' got '$got'  <= '$($c[1])'" }
}
foreach ($c in $pCases) {
    $got = Resolve-MemberCtx $c[1] $c[2]
    $ok = ($got -eq $c[3]) -or ($null -eq $got -and $null -eq $c[3])
    if ($ok) { $pass++; "PASS  P: $($c[0])" } else { $fail++; "FAIL  P: $($c[0])  expected '$($c[3])' got '$got'  <= '$($c[1])'" }
}

""
"Result: $pass passed, $fail failed, $($dCases.Count + $pCases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
