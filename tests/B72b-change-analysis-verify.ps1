# B72b-change-analysis-verify.ps1
# Offline PS-mirror of lib/fleet-analysis.js logic (no local Node; ASCII only,
# so only the English detection cues are exercised, not the Arabic ones).
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

function Pct($t, $b) {
    if ($b -eq 0) { return $null }
    return [math]::Round((($t - $b) / $b) * 100)
}

Write-Host "`n== Section A: net = active x ordersPerDriver x netPerOrder decomposition ==" -ForegroundColor Cyan

# Baseline (trailing avg): active 20, orders 200 (opd 10), net 4000 (npo 20).
# Today: active 25, orders 300 (opd 12), net 6600 (npo 22).
$bActive = 20; $bOrders = 200; $bNet = 4000
$tActive = 25; $tOrders = 300; $tNet = 6600
$bOpd = $bOrders / $bActive; $bNpo = $bNet / $bOrders
$tOpd = $tOrders / $tActive; $tNpo = $tNet / $tOrders

Check "identity holds: 25*12*22 = 6600" (($tActive * $tOpd * $tNpo) -eq 6600)
$pPart = Pct $tActive $bActive
$pVol  = Pct $tOpd $bOpd
$pVal  = Pct $tNpo $bNpo
Check "participation +25%" ($pPart -eq 25)
Check "volume (orders/driver) +20%" ($pVol -eq 20)
Check "value (net/order) +10%" ($pVal -eq 10)
Check "net +65% vs baseline" ((Pct $tNet $bNet) -eq 65)

# Dominant factor = largest absolute pct.
$comp = @(
    [pscustomobject]@{ key = "participation"; pct = $pPart },
    [pscustomobject]@{ key = "volume"; pct = $pVol },
    [pscustomobject]@{ key = "value"; pct = $pVal }
)
$dominant = ($comp | Sort-Object { [math]::Abs($_.pct) } -Descending)[0].key
Check "dominant factor = participation" ($dominant -eq "participation")

Write-Host "`n== Section B: driver swing vs own trailing average ==" -ForegroundColor Cyan
function Swing($todayNet, $trailAvg) { return [math]::Round($todayNet - $trailAvg) }
Check "today 500 vs avg 300 -> +200" ((Swing 500 300) -eq 200)
Check "today 100 vs avg 400 -> -300" ((Swing 100 400) -eq -300)

Write-Host "`n== Section C: change-query detection (English) ==" -ForegroundColor Cyan
$CHANGE = 'why|what\s+(changed|happened|drove|caused|made)|explain|(reason|cause)s?|what''?s\s+(driving|behind)|how\s+come'
$PERF   = 'net|gross|earnings?|revenue|numbers?|orders?|down|up|drop(ped)?|fell|rose|higher|lower|less|more|slow|bad|good|today|yesterday'

function Detect-Strict($msg) {
    $hasCue  = ($msg -imatch $CHANGE)
    $hasPerf = ($msg -imatch $PERF)
    return ($hasCue -and $hasPerf)
}
function Detect-Loose($msg, $recentFleet) {
    if (Detect-Strict $msg) { return $true }
    return (($msg -imatch $CHANGE) -and $recentFleet)
}

$spos = @(
    "why did net drop today",
    "what happened to our earnings",
    "why are we down today",
    "explain the drop in net",
    "what's driving the numbers"
)
foreach ($m in $spos) { Check ("STRICT: '{0}'" -f $m) (Detect-Strict $m) }

$sneg = @(
    "morning brief",
    "draft the driver nudges",
    "who is behind"
)
foreach ($m in $sneg) { Check ("NOT: '{0}'" -f $m) (-not (Detect-Strict $m)) }

# Loose: bare "why?" only fires inside an active fleet conversation.
Check "loose 'why?' with fleet context -> TRUE"  ((Detect-Loose "why?" $true) -eq $true)
Check "loose 'why?' no fleet context -> FALSE"   ((Detect-Loose "why?" $false) -eq $false)

Write-Host "`n== Section D: change-analysis OWNS fleet context (guard-preserving overwrite) ==" -ForegroundColor Cyan
# Mirrors the orchestrator fix: when change-analysis fires it OVERWRITES fleetCtx.text
# (preserving an INTEGRITY/PRESENCE guard) instead of prepending, so a conflicting
# base packet can't leak a second net figure (the 7,001-vs-4,901 fabrication bug).
function ApplyChangeOverwrite($fleetText, $changeText) {
    $hadGuard = ($fleetText -match '^(INTEGRITY ALERT|PRESENCE HONESTY)')
    $guardPrefix = ""
    if ($hadGuard) { $guardPrefix = (($fleetText -split "`n`n")[0]) + "`n`n" }
    return $guardPrefix + $changeText
}
$basePacket   = "FLEET SNAPSHOT - last month net 22988 SAR; another day net 4901 SAR"
$changePacket = "FLEET CHANGE ANALYSIS - June 18: net 7001 SAR, up 5% vs trailing avg"

# No guard: result is ONLY the change packet; the conflicting 4901 is gone.
$r1 = ApplyChangeOverwrite $basePacket $changePacket
Check "overwrite drops the conflicting base figure (no 4901)" ($r1 -notmatch "4901")
Check "overwrite keeps the authoritative change figure (7001)" ($r1 -match "7001")
Check "overwrite result equals the change packet" ($r1 -eq $changePacket)

# With an INTEGRITY guard present: the guard line is preserved, base body still dropped.
$guarded = "INTEGRITY ALERT: do not fabricate`n`n" + $basePacket
$r2 = ApplyChangeOverwrite $guarded $changePacket
Check "guard prefix preserved on overwrite" ($r2 -match "^INTEGRITY ALERT")
Check "guarded overwrite still drops 4901" ($r2 -notmatch "4901")
Check "guarded overwrite keeps 7001" ($r2 -match "7001")

Write-Host ""
Write-Host ("RESULT: {0}/{1} passed, {2} failed" -f $global:pass, $global:tot, $global:fail) -ForegroundColor Yellow
if ($global:fail -gt 0) { exit 1 }
exit 0
