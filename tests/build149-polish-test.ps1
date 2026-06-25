# Build-149 — PS-5.1 mirror of the 3 polish fixes (lib/orchestrator.js):
#   (L) Arabic period labels (rangeLabel picks arLabel)
#   (C) category-over-period match (custom + standard, apostrophe-normalized, "Other" excluded)
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build149-polish-test.ps1
$ErrorActionPreference = "Stop"

# (L) label picker mirror
function Range-Label($label, $arLabel, [bool]$ar) { if ($ar -and $arLabel) { return $arLabel } else { return $label } }

# (C) category match mirror
function Norm([string]$s) { return ($s.ToLower() -replace "[’'`]", "'") }
function Cat-Match([string]$msg, $cats) {
    $low = Norm $msg
    $distinct = $cats | Where-Object { $_ -and $_.Length -ge 3 -and $_.ToLower() -ne 'other' } | Sort-Object { $_.Length } -Descending
    foreach ($c in $distinct) { if ($low.Contains((Norm $c))) { return $c } }
    return $null
}

$pass=0; $fail=0
# label cases
$lCases = @(
    @("this week AR",  "this week",  "هذا الأسبوع", $true,  "هذا الأسبوع"),
    @("this week EN",  "this week",  "هذا الأسبوع", $false, "this week"),
    @("last month AR", "last month", "الشهر الماضي", $true,  "الشهر الماضي"),
    @("month no-ar",   "Jun 2026",   "Jun 2026",     $true,  "Jun 2026")
)
foreach ($c in $lCases) {
    $g = Range-Label $c[1] $c[2] $c[3]
    if ($g -eq $c[4]) { $pass++; "PASS  L: $($c[0])" } else { $fail++; "FAIL  L: $($c[0]) exp '$($c[4])' got '$g'" }
}
# category-over-period cases
$cats = @("Iqos","Food","Alia’s clothes","Other","Gas station")
$cCases = @(
    @("custom Iqos",        "how much on iqos last week",        $cats, "Iqos"),
    @("curly apostrophe",   "spending on alia's clothes",        $cats, "Alia’s clothes"),
    @("longest wins",       "gas station this month",            $cats, "Gas station"),
    @("Other excluded",     "how much on other stuff",           $cats, $null),
    @("no category",        "how much this week",                $cats, $null),
    @("standard Food",      "food in june",                      $cats, "Food")
)
foreach ($c in $cCases) {
    $g = Cat-Match $c[1] $c[2]
    $ok = ($g -eq $c[3]) -or ($null -eq $g -and $null -eq $c[3])
    if ($ok) { $pass++; "PASS  C: $($c[0])" } else { $fail++; "FAIL  C: $($c[0]) exp '$($c[3])' got '$g'" }
}
""
"Result: $pass passed, $fail failed, $($lCases.Count + $cCases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
