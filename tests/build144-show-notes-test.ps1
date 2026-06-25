# Build-144 — PS-5.1 mirror of cleanNote() + _notesOn() + note rendering (lib/wallet.js / orchestrator.js).
# The note ("what for") is shown to the OWNER only; the [M8] tag is stripped; empty -> null;
# kill switch M8_WALLET_SHOW_NOTES_DISABLED=1 forces notes off.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build144-show-notes-test.ps1
$ErrorActionPreference = "Stop"

function Clean-Note($n) { $s = ([string]$n) -replace '(?i)\s*\[M8\]\s*$',''; $s = $s.Trim(); if ($s.Length -eq 0) { return $null } else { return $s } }
function Notes-On([bool]$includeNote, [string]$killEnv) { return $includeNote -and ($killEnv -ne '1') }
function Render-Line($amt, $cur, $cat, $note) { $n = Clean-Note $note; return "* $amt $cur . $cat" + $(if ($n) { " . $n" } else { "" }) }

$pass=0; $fail=0
$noteCases = @(
    @("plain",       "Launch",          "Launch"),
    @("m8 tag",      "as launch [M8]",  "as launch"),
    @("only tag",    "[M8]",            $null),
    @("empty",       "",                $null),
    @("whitespace",  "   ",             $null),
    @("super market","Super market",    "Super market")
)
foreach ($c in $noteCases) {
    $g = Clean-Note $c[1]
    $ok = ($g -eq $c[2]) -or ($null -eq $g -and $null -eq $c[2])
    if ($ok){$pass++;"PASS  note:$($c[0])"}else{$fail++;"FAIL  note:$($c[0]) exp '$($c[2])' got '$g'"}
}
# kill switch
$onCases = @(
    @("on default",  $true,  "",  $true),
    @("off killed",  $true,  "1", $false),
    @("off optout",  $false, "",  $false)
)
foreach ($c in $onCases) {
    $g = Notes-On $c[1] $c[2]
    if ($g -eq $c[3]){$pass++;"PASS  on:$($c[0])"}else{$fail++;"FAIL  on:$($c[0]) exp '$($c[3])' got '$g'"}
}
# render with / without note
$r1 = Render-Line 30 "SAR" "Food" "Launch"
$r2 = Render-Line 50 "EGP" "Groceries" $null
if ($r1 -eq "* 30 SAR . Food . Launch") {$pass++;"PASS  render:with-note"} else {$fail++;"FAIL  render:with-note got '$r1'"}
if ($r2 -eq "* 50 EGP . Groceries")      {$pass++;"PASS  render:no-note"}   else {$fail++;"FAIL  render:no-note got '$r2'"}

""
"Result: $pass passed, $fail failed, $($noteCases.Count + $onCases.Count + 2) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
