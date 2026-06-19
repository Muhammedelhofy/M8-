# B73-nudges-verify.ps1
# Offline PS-mirror of lib/nudges.js LOGIC (no local Node; ASCII only, so the
# Arabic message templates themselves are not exercised here -- only the bucket
# assignment, new-driver window, perDay math, and English request detection).
# No ternary operators. $color pre-computed before Write-Host.

$ErrorActionPreference = "Stop"
$global:pass = 0
$global:fail = 0
$global:tot  = 0

function Check($name, $cond) {
    $global:tot = $global:tot + 1
    $status = "FAIL"
    $color  = "Red"
    if ($cond) { $status = "PASS"; $color = "Green"; $global:pass = $global:pass + 1 }
    else { $global:fail = $global:fail + 1 }
    Write-Host ("[{0}] {1}" -f $status, $name) -ForegroundColor $color
}

function PutB($map, $bucket, $name) {
    if (-not $map.ContainsKey($name)) { $map[$name] = $bucket }
}

Write-Host "`n== Section A: bucket assignment priority ==" -ForegroundColor Cyan

# Standings (names): onTrack objects carry a 'hit' flag.
$onTrack = @(
    [pscustomobject]@{ name = "Ali";   hit = $true },    # already hit -> appreciation
    [pscustomobject]@{ name = "Omar";  hit = $false }     # on track    -> keepItUp
)
$below   = @("Khalid", "Sara", "Faisal")   # Sara also dropped; Faisal is new
$dropped = @("Sara")                        # urgent (wins over awareness)
$tooEarly = @("Nora", "Hadi")               # Hadi is new -> welcome; Nora -> reEngage
$newSet  = @("Faisal", "Hadi")

$assigned = @{}
# 1) NEW overrides
foreach ($n in $tooEarly) { if ($newSet -contains $n) { PutB $assigned "welcome" $n } }
foreach ($d in $onTrack)  { if ($newSet -contains $d.name) { PutB $assigned "welcome" $d.name } }
foreach ($n in $below)    { if ($newSet -contains $n) { PutB $assigned "welcome" $n } }
foreach ($n in $dropped)  { if ($newSet -contains $n) { PutB $assigned "welcome" $n } }
# 2) URGENT (dropped)
foreach ($n in $dropped)  { PutB $assigned "urgent" $n }
# 3) appreciation / keepItUp
foreach ($d in $onTrack)  { $b = "keepItUp"; if ($d.hit) { $b = "appreciation" }; PutB $assigned $b $d.name }
# 4) awareness
foreach ($n in $below)    { PutB $assigned "awareness" $n }
# 5) reEngage
foreach ($n in $tooEarly) { PutB $assigned "reEngage" $n }

Check "Ali (hit) -> appreciation"          ($assigned["Ali"] -eq "appreciation")
Check "Omar (on track) -> keepItUp"         ($assigned["Omar"] -eq "keepItUp")
Check "Sara (dropped+below) -> urgent"      ($assigned["Sara"] -eq "urgent")
Check "Khalid (below) -> awareness"         ($assigned["Khalid"] -eq "awareness")
Check "Faisal (below but new) -> welcome"   ($assigned["Faisal"] -eq "welcome")
Check "Hadi (tooEarly but new) -> welcome"  ($assigned["Hadi"] -eq "welcome")
Check "Nora (tooEarly) -> reEngage"         ($assigned["Nora"] -eq "reEngage")

Write-Host "`n== Section B: new-driver window ==" -ForegroundColor Cyan

# JS ymdKey = y*10000 + m*100 + d with m 0-indexed. Today = 19 Jun 2026 (m=5).
$NEW_DAYS = 7
function Ymd($y, $m0, $d) { return ($y * 10000) + ($m0 * 100) + $d }
$todayDt   = [datetime]::new(2026, 6, 19)   # .NET month is 1-indexed
$cutoffDt  = $todayDt.AddDays(-$NEW_DAYS)    # 12 Jun
$cutoffKey = Ymd $cutoffDt.Year ($cutoffDt.Month - 1) $cutoffDt.Day
function Is-New($firstKey) { return ($firstKey -ge $cutoffKey) }

Check "first active 15 Jun -> NEW"     ((Is-New (Ymd 2026 5 15)) -eq $true)
Check "first active 12 Jun -> NEW (edge)" ((Is-New (Ymd 2026 5 12)) -eq $true)
Check "first active 5 Jun  -> NOT new" ((Is-New (Ymd 2026 5 5)) -eq $false)
Check "first active 1 Jun  -> NOT new" ((Is-New (Ymd 2026 5 1)) -eq $false)

Write-Host "`n== Section C: perDay needed (awareness) ==" -ForegroundColor Cyan

$T = 5000
$WORK = 26
function PerDay($net, $daysOnline) {
    $remain = [math]::Max(1, $WORK - $daysOnline)
    $need = [math]::Max(0, [math]::Ceiling(($T - $net) / $remain))
    return [int]$need
}
Check "net 2000 / 10d -> 188/day"  ((PerDay 2000 10) -eq 188)
Check "net 4900 / 20d -> 17/day"   ((PerDay 4900 20) -eq 17)
Check "net 5200 (over) / 15d -> 0" ((PerDay 5200 15) -eq 0)

Write-Host "`n== Section D: English request detection ==" -ForegroundColor Cyan

$NUDGE = @(
    'draft\b[^.?!\n]{0,25}\b(nudges?|messages?|texts?|whatsapp)',
    '(write|compose|create|prepare|generate|send\s+me)\b[^.?!\n]{0,25}\b(messages?|nudges?|texts?)\b[^.?!\n]{0,20}\b(driver|captain|courier|fleet)',
    '(driver|captain|courier)s?\s+(nudges?|messages?|texts?)',
    'nudge\s+(the\s+)?(drivers?|captains?|couriers?)',
    'what\s+(should|do|can)\s+i\s+(tell|send|message|say\s+to|write\s+to)\b[^.?!\n]{0,20}\b(drivers?|captains?|couriers?)',
    'messages?\s+(for|to)\s+(the\s+|my\s+)?(drivers?|captains?|couriers?)'
)
function Detect-Nudge($msg) {
    foreach ($p in $NUDGE) { if ($msg -imatch $p) { return $true } }
    return $false
}

$npos = @(
    "draft the driver nudges",
    "write messages for the drivers",
    "nudge the drivers",
    "what should i tell my drivers",
    "draft driver messages",
    "send me messages for the captains"
)
foreach ($m in $npos) { Check ("NUDGE: '{0}'" -f $m) (Detect-Nudge $m) }

$nneg = @(
    "morning brief",
    "who is behind",
    "send me the brief email now",
    "draft a board deck"
)
foreach ($m in $nneg) { Check ("NOT-NUDGE: '{0}'" -f $m) (-not (Detect-Nudge $m)) }

Write-Host ""
Write-Host ("RESULT: {0}/{1} passed, {2} failed" -f $global:pass, $global:tot, $global:fail) -ForegroundColor Yellow
if ($global:fail -gt 0) { exit 1 }
exit 0
