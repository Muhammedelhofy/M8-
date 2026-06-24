# Build-135 — PS-5.1 mirror of parseRecentQuery() routing (lib/orchestrator.js).
# Node is absent on the host, so this mirrors the regex ACCEPT/REJECT decision:
# does a phrase route to the new "last/latest expense" read lane (returns an N)
# or not (null → falls through to spend/edit/add as before)?
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build135-wallet-recent-test.ps1

$ErrorActionPreference = "Stop"

# --- mirror of parseRecentQuery: returns the count N, or $null for "no route" ---
function Get-RecentRoute([string]$raw) {
    $msg = ($raw).Trim()
    $low = $msg.ToLower()
    # an add/edit/delete verb means a WRITE lane owns this phrasing, not a read
    if ($low -match '\b(add|log|record|spent|paid|fix|correct|change|update|edit|remove|delete|undo)\b') { return $null }
    if ($msg -match 'صرفت|دفعت|عدّل|عدل|صحّح|صحح|غيّر|غير|اضف|أضف|سجّل|سجل|احذف|امسح|الغ') { return $null }
    $en = ($low -match '\b(last|latest|recent|most\s+recent)\b') -and `
          ($low -match '\b(expense|expenses|transaction|transactions|entry|entries|purchase|purchases|payment|payments|spend|spent)\b')
    $ar = ($msg -match '(آخر|اخر|أحدث|احدث)\s*(?:[\d٠-٩۰-۹]+\s*)?(مصروف|مصاريف|عملية|عمليات|معامله|معاملة|دفعة|مشترى|مشتريات)') -or `
          ($msg -match '(مصروفاتي|عملياتي)\s*(الأخيرة|الاخيرة)')
    if (-not $en -and -not $ar) { return $null }
    # normalize Arabic-Indic / Persian digits to ASCII for the count
    $norm = -join ($msg.ToCharArray() | ForEach-Object {
        $c = [int][char]$_
        if ($c -ge 0x0660 -and $c -le 0x0669) { [char]($c - 0x0660 + 48) }
        elseif ($c -ge 0x06F0 -and $c -le 0x06F9) { [char]($c - 0x06F0 + 48) }
        else { $_ }
    })
    $n = 1
    if ($norm.ToLower() -match '\b(?:last|latest|recent)\s+(\d{1,2})\b') {
        $d = [int]$Matches[1]; if ($d -ge 1 -and $d -le 20) { $n = $d }
    } elseif ($norm -match '(?:آخر|اخر)\s*(\d{1,2})') {
        $d = [int]$Matches[1]; if ($d -ge 1 -and $d -le 20) { $n = $d }
    }
    return $n
}

# label, input, expected (N for route / $null for no-route)
$cases = @(
    @("EN last expense",            "what's my last expense",            1),
    @("EN latest expense",          "what is my latest expense",         1),
    @("EN most recent transaction", "show my most recent transaction",   1),
    @("EN last N",                  "last 3 expenses",                   3),
    @("EN last spend on",           "what did i last spend on",          1),
    @("AR last expense",            "آخر مصروف",                         1),
    @("AR last operation",          "اخر عملية",                         1),
    @("AR last N (indic digits)",   "آخر ٣ مصاريف",                      3),
    @("REJECT add",                 "add 50 sar lunch",                  $null),
    @("REJECT edit",                "change the last expense to 40",     $null),
    @("REJECT remove",              "remove my last expense",            $null),
    @("REJECT spend total",         "how much did i spend this month",   $null),
    @("REJECT AR spent",            "صرفت ٣٠ ريال",                      $null),
    @("REJECT AR edit",             "عدّل آخر مصروف",                    $null),
    @("REJECT weather",             "what is the weather",               $null)
)

$pass = 0; $fail = 0
foreach ($c in $cases) {
    $label = $c[0]; $inp = $c[1]; $exp = $c[2]
    $got = Get-RecentRoute $inp
    $ok = ($got -eq $exp) -or ($null -eq $got -and $null -eq $exp)
    if ($ok) { $pass++; "PASS  $label" }
    else { $fail++; "FAIL  $label  (expected '$exp' got '$got')  <= '$inp'" }
}

""
"Result: $pass passed, $fail failed, $($cases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
