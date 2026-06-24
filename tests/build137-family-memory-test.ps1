# Build-137 — PS-5.1 mirror of the family-memory routing logic.
#   (B) money capability-card SUPPRESSION: a money-noun sentence that is TEACHING
#       who someone is (and carries no money command/query signal) should fall
#       through to the LLM (suppress=true) instead of the canned wallet decline.
#   (C) deterministic relationship capture: "Sara is my wife" -> {wife, Sara};
#       pronouns/fillers ("she is my wife", "my wife in the room") must be rejected.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build137-family-memory-test.ps1

$ErrorActionPreference = "Stop"

# ---- mirrors of the orchestrator regexes (B) ----
$CAP_MONEY    = '\b(expenses?|wallet|balance|transactions?|spend(?:ing)?|spent)\b|مصروف|مصاريف|محفظة|رصيد|معاملة|معاملات'
$MONEY_ACTION = '\b(add|log|record|spent|spend|spending|paid|pay|owe|balance|total|cost|budget|transfer|how much|delete|remove|edit|change|update)\b|\d|كم|أضف|اضف|سجّل|سجل|صرفت|دفعت|أدفع|ادفع|رصيد|احذف|عدّل|غيّر'
$TEACH_EN     = '\bmy\s+(wife|husband|spouse|partner|fianc[ée]+|brother|sister|son|daughter|mother|father|mom|dad|mum|friend|colleague|boss|cousin|uncle|aunt|neighbou?r)\b|\b(her|his|their)\s+name\s+is\b|\bnamed\b|\b(she|he|they)\s+(is|are|has|have)\b'
$TEACH_AR     = 'زوجتي|زوجي|أخي|اخي|أختي|اختي|ابني|ابنتي|والدتي|والدي|أمي|امي|أبي|ابي|صديقي|صديقتي|اسمها|اسمه'

function Test-SuppressCard([string]$m) {
    $moneyNoun = ($m -match $CAP_MONEY)
    if (-not $moneyNoun) { return $false }                 # card not even considered
    $teaching  = ($m -match $TEACH_EN) -or ($m -match $TEACH_AR)
    $action    = ($m -match $MONEY_ACTION)
    return ($teaching -and -not $action)
}

# ---- mirror of _detectRelationship (C) ----
$REL = 'wife|husband|spouse|partner|fiance|fiancee|brother|sister|son|daughter|mother|father|mom|dad|mum|friend|colleague|boss|cousin|uncle|aunt|nephew|niece|neighbour|neighbor|accountant|assistant|manager'
$NON_NAME = @('i','me','you','he','she','it','we','they','him','her','his','hers','them',
    'this','that','these','those','the','a','an','and','is','are','was','were','my','your',
    'our','their','here','there','in','on','at','of','to','for','with','who','what',
    'someone','somebody','everyone','nobody')

function Test-ValidName([string]$name) {
    $first = ($name.Trim() -split '\s+')[0].ToLower()
    return ($first.Length -ge 2) -and ($NON_NAME -notcontains $first)
}
function Get-Relationship([string]$text) {
    $t = $text.Trim()
    if ($t -match "\b([A-Za-z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+is\s+my\s+($REL)\b") {
        if (Test-ValidName $Matches[1]) { return ($Matches[2].ToLower() + ":" + (Get-Culture).TextInfo.ToTitleCase($Matches[1].ToLower())) }
    }
    if ($t -match "\bmy\s+($REL)\s+(?:is\s+|name\s+is\s+|named\s+|called\s+)?([A-Za-z][a-zA-Z]+)\b") {
        if (Test-ValidName $Matches[2]) { return ($Matches[1].ToLower() + ":" + (Get-Culture).TextInfo.ToTitleCase($Matches[2].ToLower())) }
    }
    return $null
}

# ---- (B) suppression cases ----
$bCases = @(
    @("teach: wife+wallet+expense", "my wife, she has account in the wallet as well and is logging her expense", $true),
    @("teach: her name is + wallet", "her name is Sara and she uses the wallet",     $true),
    @("query: how much spend",       "how much did sara spend in the wallet",        $false),
    @("query: balance",              "check my wallet balance",                      $false),
    @("cmd: delete expense",         "delete my last expense",                       $false),
    @("vague: what is my wallet",    "what is my wallet",                            $false),
    @("AR teach: zawjati + mahfaza", "زوجتي عندها محفظة",                             $true)
)
# ---- (C) relationship cases ----
$cCases = @(
    @("Sara is my wife",            "Sara is my wife",                "wife:Sara"),
    @("my wife Sara",              "my wife Sara",                   "wife:Sara"),
    @("my wife is Sara",          "my wife is Sara",                "wife:Sara"),
    @("my brother Omar (trailing verb)", "my brother Omar lives in Cairo", "brother:Omar"),
    @("two-word via 'is my'",     "Sara Mansour is my accountant",  "accountant:Sara Mansour"),
    @("single-token via 'my X is'", "my accountant is Sara Mansour", "accountant:Sara"),
    @("REJECT pronoun she",       "she is my wife",                 $null),
    @("REJECT filler in-room",    "my wife in the room",            $null),
    @("REJECT no relation",       "how much did I spend",           $null)
)

$pass = 0; $fail = 0
foreach ($c in $bCases) {
    $got = Test-SuppressCard $c[1]
    if ($got -eq $c[2]) { $pass++; "PASS  B: $($c[0])" } else { $fail++; "FAIL  B: $($c[0])  expected '$($c[2])' got '$got'  <= '$($c[1])'" }
}
foreach ($c in $cCases) {
    $got = Get-Relationship $c[1]
    $ok = ($got -eq $c[2]) -or ($null -eq $got -and $null -eq $c[2])
    if ($ok) { $pass++; "PASS  C: $($c[0])" } else { $fail++; "FAIL  C: $($c[0])  expected '$($c[2])' got '$got'  <= '$($c[1])'" }
}

""
"Result: $pass passed, $fail failed, $($bCases.Count + $cCases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
