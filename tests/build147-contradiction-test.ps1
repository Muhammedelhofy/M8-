# Build-147 — PS-5.1 mirror of _findConflictingPersonFact() (lib/memory.js).
# A NEW relationship for a name should FLAG (not delete) an existing profile fact that
# asserts a DIFFERENT role for the same name. Same key = supersession, not a conflict.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build147-contradiction-test.ps1
$ErrorActionPreference = "Stop"
function Rel-Key([string]$rel) { if ($rel -match '^(wife|husband|spouse|partner|fiance|fiancee)$') { return 'spouse_name' } else { return $rel + '_name' } }
function Find-Conflict([string]$name, [string]$rel, $rows) {
    $newKey = Rel-Key $rel
    # define locally so script-scope resolution can't make it $null inside the function
    $relWords = 'wife|husband|spouse|partner|fiance|fiancee|brother|sister|son|daughter|mother|father|mom|dad|mum|friend|colleague|boss|cousin|uncle|aunt|nephew|niece|neighbour|neighbor|accountant|assistant|manager' -split '\|'
    foreach ($row in $rows) {
        $c = ([string]$row.content).ToLower()
        if (-not $c.Contains($name.ToLower())) { continue }
        if ($row.key -eq $newKey) { continue }   # same slot -> normal supersession
        foreach ($w in $relWords) { if (($w -ne $rel) -and ($c -match "\b$w\b")) { return $w } }
    }
    return $null
}

$accountant = @(@{ key='accountant_name'; content="Muhammad's accountant is Sara Mansour" })
$spouse     = @(@{ key='spouse_name';     content="Muhammad's wife is Sara" })

$pass=0; $fail=0
$cases = @(
    @("wife vs accountant (conflict)", "Sara", "wife", $accountant, "accountant"),
    @("same slot (no conflict)",        "Sara", "wife", $spouse,     $null),
    @("different name (no conflict)",   "Omar", "brother", $spouse,  $null),
    @("empty (no conflict)",            "Sara", "wife", @(),         $null)
)
foreach ($c in $cases) {
    $g = Find-Conflict $c[1] $c[2] $c[3]
    $ok = ($g -eq $c[4]) -or ($null -eq $g -and $null -eq $c[4])
    if ($ok) { $pass++; "PASS  $($c[0])" } else { $fail++; "FAIL  $($c[0]) exp '$($c[4])' got '$g'" }
}
""
"Result: $pass passed, $fail failed, $($cases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
