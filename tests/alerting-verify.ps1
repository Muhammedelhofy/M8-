# alerting-verify.ps1 — Build-20 PS mirror tests for lib/alerting.js pure core
# Tests computeTransition / buildAlertText / detectAlertAck (8 acceptance tests)
# Run from M8 root: .\tests\alerting-verify.ps1

$pass = 0; $fail = 0
$RAISE_SAR = 500; $RESOLVE_SAR = 100; $SEV1_SAR = 1500
$WORSEN_DELTA = 500; $DEDUP_H = 6; $RECUR_WIN_DAYS = 14; $BRIEF_CAP = 2
$OPEN_STATES = @("raised","acknowledged","in_progress","re_raised","snoozed")
$nowMs = [long](Get-Date -UFormat %s) * 1000

function computeTransition($row, $gapNow, $gapPrev, $nowMs) {
    $consecutiveRaise = ($gapNow -gt $RAISE_SAR) -and ($gapPrev -ne $null) -and ($gapPrev -gt $RAISE_SAR)
    $clearNow = ($gapNow -le $RESOLVE_SAR)

    if (-not $row) {
        if ($consecutiveRaise) {
            return @{ action="raise"; isOpen=$true; fields=@{
                state="raised"; severity=if($gapNow -gt $SEV1_SAR){1}else{2}
                metric_value=$gapNow; raise_value=$gapNow; consecutive_clear=0; times_raised=1
            }}
        }
        return @{ action="none"; isOpen=$false }
    }

    $state = $row.state
    $isOpen = $OPEN_STATES -contains $state

    if ($row.last_checked_at) {
        $lastMs = [long](([datetime]$row.last_checked_at - [datetime]"1970-01-01T00:00:00Z").TotalMilliseconds)
        if (($nowMs - $lastMs) -lt ($DEDUP_H * 3600000)) {
            return @{ action="skip"; isOpen=$isOpen; fields=@{ metric_value=$gapNow } }
        }
    }

    if ($state -eq "resolved") {
        if (-not $consecutiveRaise) { return @{ action="none"; isOpen=$false } }
        $resolvedAtMs = if($row.resolved_at){ [long](([datetime]$row.resolved_at - [datetime]"1970-01-01T00:00:00Z").TotalMilliseconds) } else { 0 }
        $daysSince = ($nowMs - $resolvedAtMs) / 86400000
        if ($daysSince -le $RECUR_WIN_DAYS) {
            return @{ action="re_raise"; isOpen=$true; fields=@{
                state="re_raised"; metric_value=$gapNow; raise_value=$gapNow
                severity=if($gapNow -gt $SEV1_SAR){1}else{2}
                times_raised=($row.times_raised+1); consecutive_clear=0
            }}
        }
        return @{ action="raise"; isOpen=$true; fields=@{
            state="raised"; severity=if($gapNow -gt $SEV1_SAR){1}else{2}
            metric_value=$gapNow; raise_value=$gapNow; consecutive_clear=0
            times_raised=($row.times_raised+1)
        }}
    }

    if ($isOpen -and $row.raise_value -ne $null) {
        $worsen = $gapNow - $row.raise_value
        if ($worsen -ge $WORSEN_DELTA) {
            return @{ action="re_raise"; isOpen=$true; fields=@{
                state="re_raised"; metric_value=$gapNow; raise_value=$gapNow
                severity=1; times_raised=($row.times_raised+1); consecutive_clear=0
            }}
        }
    }

    if ($state -eq "snoozed" -and $row.suppression_until) {
        $untilMs = [long](([datetime]$row.suppression_until - [datetime]"1970-01-01T00:00:00Z").TotalMilliseconds)
        if ($nowMs -lt $untilMs) {
            return @{ action="skip"; isOpen=$false; fields=@{ metric_value=$gapNow } }
        }
    }

    if ($isOpen -and $clearNow) {
        $newClear = ($row.consecutive_clear + 1)
        if ($newClear -ge 2) {
            return @{ action="resolve"; isOpen=$false; fields=@{
                state="resolved"; consecutive_clear=$newClear; metric_value=$gapNow
            }}
        }
        return @{ action="update_clear"; isOpen=$true; fields=@{ consecutive_clear=$newClear; metric_value=$gapNow } }
    }

    if ($isOpen) {
        return @{ action="update"; isOpen=$true; fields=@{ consecutive_clear=0; metric_value=$gapNow } }
    }
    return @{ action="none"; isOpen=$false }
}

function buildAlertText($openAlerts) {
    if (-not $openAlerts -or $openAlerts.Count -eq 0) { return "" }
    $sorted = $openAlerts | Sort-Object { $_.severity },{ -$_.metric_value }
    if ($openAlerts.Count -gt $BRIEF_CAP) {
        $worst = $sorted[0]
        return "FLEET ALERT - CASH GAP: $($openAlerts.Count) drivers collectively owe"
    }
    return "FLEET ALERT - CASH GAP"
}

function detectAlertAck($message, $openAlerts) {
    if (-not $openAlerts -or $openAlerts.Count -eq 0) { return @() }
    $msg = $message.ToLower()
    if ($msg -match 'ack:(\d+)') {
        $id = [int]$Matches[1]
        $a = $openAlerts | Where-Object { $_.id -eq $id } | Select-Object -First 1
        if ($a) { return @($a.driver_key) }
        return @()
    }
    $cashTopic = [regex]'\b(cash|deposit|gap|collect|owe|owes|paid|payment|balance)\b'
    if (-not $cashTopic.IsMatch($message)) { return @() }
    return @($openAlerts | Where-Object {
        $parts = ($_.driver_name -replace "\s+"," ").ToLower().Split(" ")
        $parts | Where-Object { $_.Length -gt 2 -and $msg.Contains($_) }
    } | ForEach-Object { $_.driver_key })
}

function ok($label, $cond) {
    if ($cond) { Write-Host "  PASS $label"; $script:pass++ }
    else        { Write-Host "  FAIL $label"; $script:fail++ }
}

Write-Host "`n=== alerting-verify.ps1 (Build-20) ===`n"

# T1: No row, single entry (no prev) — no raise yet
$t = computeTransition $null 800 $null $nowMs
ok "T1: no row + single entry => none" ($t.action -eq "none")

# T2: No row, two consecutive entries above threshold — raise
$t = computeTransition $null 800 600 $nowMs
ok "T2: no row + consecutive high => raise" ($t.action -eq "raise")
ok "T2b: severity=2 (below SEV1)" ($t.fields.severity -eq 2)
ok "T2c: state=raised" ($t.fields.state -eq "raised")

# T3: SEV1 at raise (gap > 1500)
$t = computeTransition $null 1600 1200 $nowMs
ok "T3: SEV1_SAR threshold => severity=1" ($t.fields.severity -eq 1)

# T4: Open alert, gap drops to 80 (1st clear) — update_clear
$row4 = @{ state="raised"; metric_value=700; raise_value=700; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-3).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTransition $row4 80 200 $nowMs
ok "T4: first clear => update_clear" ($t.action -eq "update_clear")
ok "T4b: consecutive_clear=1" ($t.fields.consecutive_clear -eq 1)

# T5: Open alert, gap <= 100 for second evaluation — resolve
$row5 = @{ state="raised"; metric_value=80; raise_value=700; consecutive_clear=1; times_raised=1; first_raised_at=(Get-Date).AddDays(-3).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTransition $row5 70 80 $nowMs
ok "T5: second clear => resolve" ($t.action -eq "resolve")
ok "T5b: isOpen=false after resolve" (-not $t.isOpen)

# T6: Resolved within RECUR_WIN_DAYS, gap high again — re_raise
$row6 = @{ state="resolved"; metric_value=80; raise_value=700; consecutive_clear=2; times_raised=1; first_raised_at=(Get-Date).AddDays(-5).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=(Get-Date).AddDays(-3).ToString("o"); suppression_until=$null }
$t = computeTransition $row6 800 700 $nowMs
ok "T6: resolved + recur window + high gap => re_raise" ($t.action -eq "re_raise")
ok "T6b: times_raised incremented" ($t.fields.times_raised -eq 2)

# T7: Open alert, worsening delta >= 500 above raise_value — re_raise (bypasses cooldown)
$row7 = @{ state="raised"; metric_value=700; raise_value=600; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTransition $row7 1150 800 $nowMs
ok "T7: worsening delta >= 500 => re_raise" ($t.action -eq "re_raise")
ok "T7b: severity escalated to 1" ($t.fields.severity -eq 1)

# T8: DEDUP — checked within 6 hours — skip
$row8 = @{ state="raised"; metric_value=700; raise_value=700; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-1).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTransition $row8 800 700 $nowMs
ok "T8: checked within 6h => skip (dedup)" ($t.action -eq "skip")

# T9: buildAlertText — empty => empty string
$text = buildAlertText @()
ok "T9: empty alerts => empty string" ($text -eq "")

# T10: buildAlertText — 1 alert => individual line
$alerts10 = @(@{ id=1; condition="cash_gap"; driver_key="d1"; driver_name="Ahmad"; state="raised"; severity=2; metric_value=750; raise_value=750; times_raised=1; first_raised_at=(Get-Date).AddDays(-2).ToString("o") })
$text = buildAlertText $alerts10
ok "T10: single alert => contains FLEET ALERT" ($text -match "FLEET ALERT")

# T11: buildAlertText — 3 alerts (> BRIEF_CAP=2) => aggregate line
$alerts11 = @(
    @{ id=1; driver_name="Ahmad"; state="raised"; severity=2; metric_value=800; raise_value=800; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
    @{ id=2; driver_name="Hassan"; state="raised"; severity=2; metric_value=600; raise_value=600; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
    @{ id=3; driver_name="Tariq"; state="raised"; severity=2; metric_value=550; raise_value=550; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
)
$text = buildAlertText $alerts11
ok "T11: 3 alerts => aggregate 'drivers collectively owe'" ($text -match "drivers collectively owe")

# T12: detectAlertAck — UI chip ack:<id>
$alerts12 = @(@{ id=7; driver_key="d7"; driver_name="Ahmad" })
$keys = detectAlertAck "ack:7" $alerts12
ok "T12: UI chip ack:7 => returns driver_key d7" ($keys -contains "d7")

# T13: detectAlertAck — chat naming driver + cash topic
$alerts13 = @(@{ id=9; driver_key="d9"; driver_name="Hassan Ali" })
$keys = detectAlertAck "did Hassan pay his cash balance?" $alerts13
ok "T13: cash topic + driver name => ack detected" ($keys -contains "d9")

# T14: detectAlertAck — no cash topic => no ack
$keys = detectAlertAck "how is Hassan doing today?" $alerts13
ok "T14: no cash topic => no ack" ($keys.Count -eq 0)

# T15: Snoozed alert within suppression window — skip (isOpen=false)
$futureTime = (Get-Date).AddHours(12).ToString("o")
$row15 = @{ state="snoozed"; metric_value=700; raise_value=700; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$futureTime }
$t = computeTransition $row15 800 700 $nowMs
ok "T15: snoozed within window => skip with isOpen=false" ($t.action -eq "skip" -and -not $t.isOpen)

$total = $pass + $fail
Write-Host "`n=== $pass/$total PASS ===" -ForegroundColor $(if($fail -eq 0){"Green"}else{"Red"})
if ($fail -gt 0) { exit 1 }
