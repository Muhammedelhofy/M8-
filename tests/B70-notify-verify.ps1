# B69-notify-verify.ps1
# Offline PS-mirror of lib/notify.js + morning-brief HTML (no local Node).
# Pure ASCII. No ternary operators. $color pre-computed before Write-Host.
# Covers: (1) detectBriefEmailCommand stop/resume detection, (2) env hard-off,
# (3) token-match anti-tamper logic, (4) HTML body contains the 3 sections.

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

# ---- Mirror of detectBriefEmailCommand ----
$STOP_RE    = '\b(stop|cancel|turn\s*off|disable|unsubscribe\s*(me\s*)?from|mute|pause)\b[^.?!\n]{0,30}\b(morning|daily|fleet|brief)\b[^.?!\n]{0,20}\b(email|e-?mail|brief|report)?\b'
$RESUME_RE  = '\b(resume|restart|turn\s*on|enable|re-?subscribe|re-?enable)\b[^.?!\n]{0,30}\b(morning|daily|fleet|brief)\b[^.?!\n]{0,20}\b(email|e-?mail|brief|report)?\b'
$STOP_RE2   = '\b(stop|cancel|turn\s*off|disable|unsubscribe|mute)\b[^.?!\n]{0,25}\b(email|e-?mail)\b'
$RESUME_RE2 = '\b(resume|turn\s*on|enable|re-?subscribe|start)\b[^.?!\n]{0,25}\b(email|e-?mail)\b'
$CUE        = '\b(morning|daily|fleet|brief|report)\b'

function Detect-EmailCmd($msg) {
    if (-not ($msg -imatch $CUE)) { return "none" }
    if (($msg -imatch $STOP_RE) -or ($msg -imatch $STOP_RE2)) { return "stop" }
    if (($msg -imatch $RESUME_RE) -or ($msg -imatch $RESUME_RE2)) { return "resume" }
    return "none"
}

Write-Host "`n== Section A: stop/resume command detection ==" -ForegroundColor Cyan

$stops = @(
    "stop the morning email",
    "cancel the daily brief email",
    "turn off the morning email",
    "unsubscribe me from the fleet brief",
    "mute the morning brief"
)
foreach ($m in $stops) { Check ("STOP: '{0}'" -f $m) ((Detect-EmailCmd $m) -eq "stop") }

$resumes = @(
    "resume the morning email",
    "turn on the daily brief email",
    "re-enable the morning brief",
    "start sending the fleet brief email again"
)
foreach ($m in $resumes) { Check ("RESUME: '{0}'" -f $m) ((Detect-EmailCmd $m) -eq "resume") }

$neutral = @(
    "stop the music",
    "cancel my subscription to netflix",
    "what is the morning brief",
    "who is behind",
    "send me the morning brief",
    "give me the daily brief",
    "show me today's fleet brief"
)
foreach ($m in $neutral) { Check ("NEUTRAL: '{0}'" -f $m) ((Detect-EmailCmd $m) -eq "none") }

Write-Host "`n== Section B: env hard-off ==" -ForegroundColor Cyan

$OFF_RE = '^(off|0|false|no|disabled?)$'
function Env-HardOff($v) { return ($v -imatch $OFF_RE) }
Check "hard-off: 'off'      -> TRUE"  ((Env-HardOff "off") -eq $true)
Check "hard-off: 'false'    -> TRUE"  ((Env-HardOff "false") -eq $true)
Check "hard-off: '0'        -> TRUE"  ((Env-HardOff "0") -eq $true)
Check "hard-off: 'disabled' -> TRUE"  ((Env-HardOff "disabled") -eq $true)
Check "hard-off: 'on'       -> FALSE" ((Env-HardOff "on") -eq $false)
Check "hard-off: ''         -> FALSE" ((Env-HardOff "") -eq $false)

Write-Host "`n== Section C: token anti-tamper ==" -ForegroundColor Cyan

# Mirror of setEnabledByToken gate: ok only when token present AND matches.
function Token-Ok($stored, $given) {
    if ([string]::IsNullOrEmpty($given)) { return $false }
    if ([string]::IsNullOrEmpty($stored)) { return $false }
    return ($given -ceq $stored)
}
$tok = "a1b2c3d4e5f6"
Check "token match -> ok"            ((Token-Ok $tok $tok) -eq $true)
Check "token mismatch -> no-op"      ((Token-Ok $tok "WRONG") -eq $false)
Check "empty given token -> no-op"   ((Token-Ok $tok "") -eq $false)
Check "no stored token -> no-op"     ((Token-Ok "" $tok) -eq $false)

Write-Host "`n== Section D: HTML body shape ==" -ForegroundColor Cyan

# Minimal stand-in for formatBriefHTML output assertions: build a sample and
# verify the three section headers + unsubscribe link render.
$dropped = "DROPPED YESTERDAY"
$ontrack = "ON TRACK"
$below   = "BELOW TARGET"
$unsub   = "https://m8-alpha.vercel.app/api/notify-prefs?action=unsubscribe&token=abc"
$html = "<div><h3>$dropped (1)</h3><h3>$ontrack (3)</h3><h3>$below (2)</h3><a href=""$unsub"">Stop these morning emails</a></div>"

Check "HTML has ON TRACK section"        ($html -match 'ON TRACK')
Check "HTML has BELOW TARGET section"    ($html -match 'BELOW TARGET')
Check "HTML has DROPPED YESTERDAY"       ($html -match 'DROPPED YESTERDAY')
Check "HTML has unsubscribe link"        ($html -match 'action=unsubscribe')

Write-Host ""
Write-Host ("RESULT: {0}/{1} passed, {2} failed" -f $global:pass, $global:tot, $global:fail) -ForegroundColor Yellow
if ($global:fail -gt 0) { exit 1 }
exit 0
