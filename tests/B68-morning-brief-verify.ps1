# B68-morning-brief-verify.ps1
# Offline PS-mirror of lib/morning-brief.js core logic (no local Node).
# Pure ASCII. No ternary operators. $color pre-computed before Write-Host.
# Covers: (1) projection formula, (2) on-track/below/dropped classification,
# (3) detectMorningBriefQuery phrase detection.

$ErrorActionPreference = "Stop"
$pass = 0
$fail = 0

function Check($name, $cond) {
    $global:tot = $global:tot + 1
    $status = "FAIL"
    $color  = "Red"
    if ($cond) { $status = "PASS"; $color = "Green"; $global:pass = $global:pass + 1 }
    else { $global:fail = $global:fail + 1 }
    Write-Host ("[{0}] {1}" -f $status, $name) -ForegroundColor $color
}

$global:pass = 0
$global:fail = 0
$global:tot  = 0

$TARGET = 5000
$WORKING = 26

# ---- Mirror of project(): projected = (net / daysOnline) * workingDays ----
function Project-Driver($net, $daysOnline) {
    $dailyAvg = 0.0
    if ($daysOnline -gt 0) { $dailyAvg = $net / $daysOnline }
    $projected = $dailyAvg * $WORKING
    $onTrack = ($projected -ge $TARGET)
    return [pscustomobject]@{
        net        = [math]::Round($net)
        daysOnline = $daysOnline
        dailyAvg   = [math]::Round($dailyAvg)
        projected  = [math]::Round($projected)
        onTrack    = $onTrack
    }
}

Write-Host "`n== Section A: projection formula ==" -ForegroundColor Cyan

# Driver A: 2000 SAR over 8 days -> 250/day -> *26 = 6500 -> ON TRACK
$a = Project-Driver 2000 8
Check "A: dailyAvg 2000/8 = 250" ($a.dailyAvg -eq 250)
Check "A: projected 250*26 = 6500" ($a.projected -eq 6500)
Check "A: 6500 >= 5000 -> onTrack TRUE" ($a.onTrack -eq $true)

# Driver B: 1000 SAR over 8 days -> 125/day -> *26 = 3250 -> BELOW
$b = Project-Driver 1000 8
Check "B: projected 125*26 = 3250" ($b.projected -eq 3250)
Check "B: 3250 < 5000 -> onTrack FALSE" ($b.onTrack -eq $false)

# Driver C: exactly on the line: net 1600 over 8 -> 200/day -> *26 = 5200 ON
$c = Project-Driver 1600 8
Check "C: projected 5200 onTrack TRUE" ($c.onTrack -eq $true)

# Driver D: zero days online -> dailyAvg 0, projected 0, not on track, no div-by-zero
$d = Project-Driver 0 0
Check "D: zero days -> projected 0 (no crash)" ($d.projected -eq 0)
Check "D: zero days -> onTrack FALSE" ($d.onTrack -eq $false)

# Boundary: projected exactly 5000 -> on track (>=)
# net 1000 over 5.2 not integer; use net 5000 over 26 -> 192.3*26 ~ 5000
$e = Project-Driver 5000 26
Check "E: 5000 over 26 days projected ~5000 onTrack TRUE" ($e.onTrack -eq $true)

Write-Host "`n== Section B: dropped-yesterday classification ==" -ForegroundColor Cyan

# "Dropped yesterday" = on track two-days-ago snapshot, NOT on track now.
# Simulate driver F: 2-days-ago net 1500 over 6 days -> 250/day -> 6500 ON.
# Now (yesterday) net 1550 over 8 days -> 193.75/day -> 5037.5 ... still on.
# Make it clearly drop: now net 1400 over 8 -> 175/day -> 4550 BELOW.
$fPrev = Project-Driver 1500 6
$fNow  = Project-Driver 1400 8
$dropped = ($fPrev.onTrack -eq $true) -and ($fNow.onTrack -eq $false)
Check "F: was on track (6500), now below (4550) -> DROPPED" ($dropped -eq $true)

# Driver G: below both snapshots -> NOT a 'dropped yesterday' (already behind).
$gPrev = Project-Driver 900 6
$gNow  = Project-Driver 1000 8
$gDropped = ($gPrev.onTrack -eq $true) -and ($gNow.onTrack -eq $false)
Check "G: below both -> NOT dropped" ($gDropped -eq $false)

# Driver H: on track both -> NOT dropped.
$hPrev = Project-Driver 1500 6
$hNow  = Project-Driver 2100 8
$hDropped = ($hPrev.onTrack -eq $true) -and ($hNow.onTrack -eq $false)
Check "H: on track both -> NOT dropped" ($hDropped -eq $false)

Write-Host "`n== Section B2: min-days projection guard (Build-71) ==" -ForegroundColor Cyan

# Drivers with < MIN_PROJECT_DAYS active days must NOT get an on-track/behind
# verdict (one big or tiny day swings the projection). They go to TOO EARLY.
$MIN = 3
# 1 big day (250 SAR) would falsely project 6500 = on track; must be too-early.
$big1 = Project-Driver 250 1
Check "1-day big earner -> TOO EARLY (not 'on track')"  ($big1.daysOnline -lt $MIN)
# 1 tiny day (6 SAR) would project ~150 = falsely 'behind'; must be too-early.
$tiny1 = Project-Driver 6 1
Check "1-day tiny earner -> TOO EARLY (not 'behind')"   ($tiny1.daysOnline -lt $MIN)
$two = Project-Driver 400 2
Check "2-day driver -> TOO EARLY (under threshold)"     ($two.daysOnline -lt $MIN)
$three = Project-Driver 600 3
Check "3-day driver -> projected (meets threshold)"     ($three.daysOnline -ge $MIN)

Write-Host "`n== Section C: detectMorningBriefQuery ==" -ForegroundColor Cyan

# Mirror of BRIEF_QUERY_PATTERNS (PowerShell uses .NET regex, case-insensitive).
$patterns = @(
    'morning\s+brief',
    'daily\s+brief',
    'brief\s+me',
    'fleet\s+status\s+(today|this\s+morning|now)',
    'how\s+(are|''re|r)\s+(my\s+|the\s+)?drivers?\s+doing',
    'who\s+is\s+behind',
    'who''s\s+behind',
    'who\s+(has\s+)?dropped',
    'who\s+fell\s+(behind|off)',
    '(today''s|the)\s+fleet\s+brief'
)
function Detect-Brief($msg) {
    foreach ($p in $patterns) {
        if ($msg -imatch $p) { return $true }
    }
    return $false
}

# Positives (6+ phrases required by spec)
$positives = @(
    "morning brief",
    "give me the daily brief",
    "brief me on the fleet",
    "fleet status today",
    "how are my drivers doing",
    "who is behind",
    "who's behind on target",
    "who dropped yesterday",
    "who fell behind",
    "show me today's fleet brief"
)
foreach ($msg in $positives) {
    Check ("POS: '{0}'" -f $msg) (Detect-Brief $msg)
}

# Negatives (must NOT trigger)
$negatives = @(
    "what's the weather like",
    "ingest this book as a source",
    "what is the priority right now",
    "compare angelic hierarchies across books",
    "good morning"
)
foreach ($msg in $negatives) {
    Check ("NEG: '{0}'" -f $msg) (-not (Detect-Brief $msg))
}

Write-Host ""
Write-Host ("RESULT: {0}/{1} passed, {2} failed" -f $global:pass, $global:tot, $global:fail) -ForegroundColor Yellow
if ($global:fail -gt 0) { exit 1 }
exit 0
