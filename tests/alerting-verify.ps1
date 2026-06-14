# alerting-verify.ps1 — Build-20 + Build-21 + Build-22 PS mirror tests for lib/alerting.js pure core
# Tests computeTransition / computeTierSlipTransition / computeTierWatchTransition /
# computeChurnTransition / buildAlertText / detectAlertAck
# Run from M8 root: .\tests\alerting-verify.ps1

$pass = 0; $fail = 0
$RAISE_SAR = 500; $RESOLVE_SAR = 100; $SEV1_SAR = 1500
$WORSEN_DELTA = 500; $DEDUP_H = 6; $RECUR_WIN_DAYS = 14; $BRIEF_CAP = 2
$TIER_WORSEN_LEVEL = 1; $WATCH_WORSEN_PTS = 10; $COACH_ACCEPT = 70; $COACH_FINISH = 80
$CHURN_FLAG_SCORE = 2; $CHURN_WORSEN_DELTA = 1
$TIER_NAMES = @("Bronze","Silver","Gold","Platinum","Diamond")
$OPEN_STATES = @("raised","acknowledged","in_progress","re_raised","snoozed")
$nowMs = [long](Get-Date -UFormat %s) * 1000

function ToMs($iso) { [long](([datetime]$iso - [datetime]"1970-01-01T00:00:00Z").TotalMilliseconds) }

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
        $lastMs = ToMs $row.last_checked_at
        if (($nowMs - $lastMs) -lt ($DEDUP_H * 3600000)) {
            return @{ action="skip"; isOpen=$isOpen; fields=@{ metric_value=$gapNow } }
        }
    }

    if ($state -eq "resolved") {
        if (-not $consecutiveRaise) { return @{ action="none"; isOpen=$false } }
        $resolvedAtMs = if($row.resolved_at){ ToMs $row.resolved_at } else { 0 }
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
        $untilMs = ToMs $row.suppression_until
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

# ── Tier-slip (ground truth) ───────────────────────────────────────────────────
function computeTierSlipTransition($row, $levelNow, $baselineLevel, $nowMs) {
    $hasLevels = ($levelNow -ge 0) -and ($baselineLevel -ge 0)
    $dropped = $hasLevels -and ($levelNow -lt $baselineLevel)

    if (-not $row) {
        if ($dropped) {
            $sev = if (($baselineLevel - $levelNow) -ge 2) {1} else {2}
            return @{ action="raise"; isOpen=$true; fields=@{
                state="raised"; severity=$sev
                metric_value=$levelNow; raise_value=$baselineLevel; threshold=$baselineLevel
                consecutive_clear=0; times_raised=1
            }}
        }
        return @{ action="none"; isOpen=$false }
    }

    $state = $row.state
    $isOpen = $OPEN_STATES -contains $state

    if ($row.last_checked_at) {
        $lastMs = ToMs $row.last_checked_at
        if (($nowMs - $lastMs) -lt ($DEDUP_H * 3600000)) {
            return @{ action="skip"; isOpen=$isOpen; fields=@{ metric_value=$levelNow } }
        }
    }

    if ($state -eq "resolved") {
        if ((-not $hasLevels) -or ($levelNow -ge $row.raise_value)) { return @{ action="none"; isOpen=$false } }
        $newRaiseValue = [Math]::Max($row.raise_value, $baselineLevel)
        $resolvedAtMs = if($row.resolved_at){ ToMs $row.resolved_at } else { 0 }
        $daysSince = ($nowMs - $resolvedAtMs) / 86400000
        $sev = if (($newRaiseValue - $levelNow) -ge 2) {1} else {2}
        if ($daysSince -le $RECUR_WIN_DAYS) {
            return @{ action="re_raise"; isOpen=$true; fields=@{
                state="re_raised"; metric_value=$levelNow; raise_value=$newRaiseValue
                severity=$sev; times_raised=($row.times_raised+1); consecutive_clear=0
            }}
        }
        return @{ action="raise"; isOpen=$true; fields=@{
            state="raised"; severity=$sev
            metric_value=$levelNow; raise_value=$newRaiseValue; threshold=$newRaiseValue
            consecutive_clear=0; times_raised=($row.times_raised+1)
        }}
    }

    if ($isOpen -and $hasLevels) {
        $baseMetric = if($row.metric_value -ne $null){$row.metric_value}else{$row.raise_value}
        if ($levelNow -le ($baseMetric - $TIER_WORSEN_LEVEL)) {
            return @{ action="re_raise"; isOpen=$true; fields=@{
                state="re_raised"; metric_value=$levelNow
                raise_value=([Math]::Max($row.raise_value, $baselineLevel))
                severity=1; times_raised=($row.times_raised+1); consecutive_clear=0
            }}
        }
    }

    if ($state -eq "snoozed" -and $row.suppression_until) {
        $untilMs = ToMs $row.suppression_until
        if ($nowMs -lt $untilMs) {
            return @{ action="skip"; isOpen=$false; fields=@{ metric_value=$levelNow } }
        }
    }

    if ($isOpen -and $hasLevels -and $levelNow -ge $row.raise_value) {
        $newClear = ($row.consecutive_clear + 1)
        if ($newClear -ge 2) {
            return @{ action="resolve"; isOpen=$false; fields=@{
                state="resolved"; consecutive_clear=$newClear; metric_value=$levelNow
            }}
        }
        return @{ action="update_clear"; isOpen=$true; fields=@{ consecutive_clear=$newClear; metric_value=$levelNow } }
    }

    if ($isOpen) {
        $mv = if($hasLevels){$levelNow}else{$row.metric_value}
        return @{ action="update"; isOpen=$true; fields=@{ consecutive_clear=0; metric_value=$mv } }
    }
    return @{ action="none"; isOpen=$false }
}

# ── Tier-watch (weak-lever leading indicator) ───────────────────────────────────
function computeTierWatchTransition($row, $weakNow, $weakPrev, $snapshot, $nowMs) {
    $consecutiveWeak = $weakNow -and ($weakPrev -eq $true)

    if (-not $row) {
        if ($consecutiveWeak) {
            return @{ action="raise"; isOpen=$true; fields=@{
                state="raised"; severity=3
                metric_value=$snapshot.accept; raise_value=$snapshot.accept; threshold=$COACH_ACCEPT
                consecutive_clear=0; times_raised=1
            }}
        }
        return @{ action="none"; isOpen=$false }
    }

    $state = $row.state
    $isOpen = $OPEN_STATES -contains $state

    if ($row.last_checked_at) {
        $lastMs = ToMs $row.last_checked_at
        if (($nowMs - $lastMs) -lt ($DEDUP_H * 3600000)) {
            return @{ action="skip"; isOpen=$isOpen; fields=@{ metric_value=$snapshot.accept } }
        }
    }

    if ($state -eq "resolved") {
        if (-not $consecutiveWeak) { return @{ action="none"; isOpen=$false } }
        $resolvedAtMs = if($row.resolved_at){ ToMs $row.resolved_at } else { 0 }
        $daysSince = ($nowMs - $resolvedAtMs) / 86400000
        if ($daysSince -le $RECUR_WIN_DAYS) {
            return @{ action="re_raise"; isOpen=$true; fields=@{
                state="re_raised"; metric_value=$snapshot.accept; raise_value=$snapshot.accept
                severity=3; times_raised=($row.times_raised+1); consecutive_clear=0
            }}
        }
        return @{ action="raise"; isOpen=$true; fields=@{
            state="raised"; severity=3
            metric_value=$snapshot.accept; raise_value=$snapshot.accept; threshold=$COACH_ACCEPT
            consecutive_clear=0; times_raised=($row.times_raised+1)
        }}
    }

    if ($isOpen -and $weakNow -and (($row.raise_value - $snapshot.accept) -ge $WATCH_WORSEN_PTS)) {
        return @{ action="re_raise"; isOpen=$true; fields=@{
            state="re_raised"; metric_value=$snapshot.accept; raise_value=$snapshot.accept
            severity=3; times_raised=($row.times_raised+1); consecutive_clear=0
        }}
    }

    if ($state -eq "snoozed" -and $row.suppression_until) {
        $untilMs = ToMs $row.suppression_until
        if ($nowMs -lt $untilMs) {
            return @{ action="skip"; isOpen=$false; fields=@{ metric_value=$snapshot.accept } }
        }
    }

    if ($isOpen -and -not $weakNow) {
        $newClear = ($row.consecutive_clear + 1)
        if ($newClear -ge 2) {
            return @{ action="resolve"; isOpen=$false; fields=@{
                state="resolved"; consecutive_clear=$newClear; metric_value=$snapshot.accept
            }}
        }
        return @{ action="update_clear"; isOpen=$true; fields=@{ consecutive_clear=$newClear; metric_value=$snapshot.accept } }
    }

    if ($isOpen) {
        return @{ action="update"; isOpen=$true; fields=@{ consecutive_clear=0; metric_value=$snapshot.accept } }
    }
    return @{ action="none"; isOpen=$false }
}

# ── Churn-risk (wraps fleet.js driverChurn composite) ───────────────────────────
function computeChurnTransition($row, $flagged, $nowMs) {
    $isFlagged = $null -ne $flagged
    $scoreNow = if ($isFlagged) { $flagged.score } else { 0 }
    $sevFor = { param($s) if ($s -ge 3) {1} else {2} }

    if (-not $row) {
        if ($isFlagged) {
            return @{ action="raise"; isOpen=$true; fields=@{
                state="raised"; severity=(& $sevFor $scoreNow)
                metric_value=$scoreNow; raise_value=$scoreNow; threshold=$CHURN_FLAG_SCORE
                consecutive_clear=0; times_raised=1
            }}
        }
        return @{ action="none"; isOpen=$false }
    }

    $state = $row.state
    $isOpen = $OPEN_STATES -contains $state

    if ($row.last_checked_at) {
        $lastMs = ToMs $row.last_checked_at
        if (($nowMs - $lastMs) -lt ($DEDUP_H * 3600000)) {
            return @{ action="skip"; isOpen=$isOpen; fields=@{ metric_value=$scoreNow } }
        }
    }

    if ($state -eq "resolved") {
        if (-not $isFlagged) { return @{ action="none"; isOpen=$false } }
        $resolvedAtMs = if($row.resolved_at){ ToMs $row.resolved_at } else { 0 }
        $daysSince = ($nowMs - $resolvedAtMs) / 86400000
        if ($daysSince -le $RECUR_WIN_DAYS) {
            return @{ action="re_raise"; isOpen=$true; fields=@{
                state="re_raised"; metric_value=$scoreNow; raise_value=$scoreNow
                severity=(& $sevFor $scoreNow); times_raised=($row.times_raised+1); consecutive_clear=0
            }}
        }
        return @{ action="raise"; isOpen=$true; fields=@{
            state="raised"; severity=(& $sevFor $scoreNow)
            metric_value=$scoreNow; raise_value=$scoreNow; threshold=$CHURN_FLAG_SCORE
            consecutive_clear=0; times_raised=($row.times_raised+1)
        }}
    }

    if ($isOpen -and $isFlagged -and (($scoreNow - $row.raise_value) -ge $CHURN_WORSEN_DELTA)) {
        return @{ action="re_raise"; isOpen=$true; fields=@{
            state="re_raised"; metric_value=$scoreNow; raise_value=$scoreNow
            severity=(& $sevFor $scoreNow); times_raised=($row.times_raised+1); consecutive_clear=0
        }}
    }

    if ($state -eq "snoozed" -and $row.suppression_until) {
        $untilMs = ToMs $row.suppression_until
        if ($nowMs -lt $untilMs) {
            return @{ action="skip"; isOpen=$false; fields=@{ metric_value=$scoreNow } }
        }
    }

    if ($isOpen -and -not $isFlagged) {
        $newClear = ($row.consecutive_clear + 1)
        if ($newClear -ge 2) {
            return @{ action="resolve"; isOpen=$false; fields=@{
                state="resolved"; consecutive_clear=$newClear; metric_value=0
            }}
        }
        return @{ action="update_clear"; isOpen=$true; fields=@{ consecutive_clear=$newClear; metric_value=0 } }
    }

    if ($isOpen) {
        return @{ action="update"; isOpen=$true; fields=@{ consecutive_clear=0; metric_value=$scoreNow; severity=(& $sevFor $scoreNow) } }
    }
    return @{ action="none"; isOpen=$false }
}

# ── Brief text + ack detection ──────────────────────────────────────────────────
function buildCashGapText($alerts) {
    if ($alerts.Count -gt $BRIEF_CAP) {
        return "FLEET ALERT - CASH GAP: $($alerts.Count) drivers collectively owe SAR ..."
    }
    $lines = $alerts | ForEach-Object { "$($_.driver_name): SAR $($_.metric_value)" }
    return "FLEET ALERT - CASH GAP: " + ($lines -join " | ")
}

function buildTierSlipText($alerts) {
    if ($alerts.Count -gt $BRIEF_CAP) {
        return "FLEET ALERT - TIER SLIP: $($alerts.Count) drivers have dropped tier"
    }
    $lines = $alerts | ForEach-Object { "$($_.driver_name): $($TIER_NAMES[$_.raise_value])->$($TIER_NAMES[$_.metric_value])" }
    return "FLEET ALERT - TIER SLIP: " + ($lines -join " | ")
}

function buildTierWatchText($alerts) {
    $lines = $alerts | ForEach-Object { "$($_.driver_name): weak lever" }
    return "FLEET WATCH - TIER RISK: " + ($lines -join " | ")
}

function buildChurnText($alerts) {
    if ($alerts.Count -gt $BRIEF_CAP) {
        return "FLEET WATCH - CHURN RISK: $($alerts.Count) drivers show early-warning signs"
    }
    $lines = $alerts | ForEach-Object {
        $reasons = if($_.metadata -and $_.metadata.reasons){ $_.metadata.reasons -join "; " } else { "at risk" }
        "$($_.driver_name): $reasons"
    }
    return "FLEET WATCH - CHURN RISK: " + ($lines -join " | ")
}

function buildAlertText($openAlerts) {
    if (-not $openAlerts -or $openAlerts.Count -eq 0) { return "" }
    $cash  = @($openAlerts | Where-Object { (-not $_.condition) -or ($_.condition -eq "cash_gap") })
    $slip  = @($openAlerts | Where-Object { $_.condition -eq "tier_slip" })
    $watch = @($openAlerts | Where-Object { $_.condition -eq "tier_watch" })
    $churn = @($openAlerts | Where-Object { $_.condition -eq "churn_risk" })
    $blocks = @()
    if ($cash.Count -gt 0)  { $blocks += (buildCashGapText $cash) }
    if ($slip.Count -gt 0)  { $blocks += (buildTierSlipText $slip) }
    if ($watch.Count -gt 0) { $blocks += (buildTierWatchText $watch) }
    if ($churn.Count -gt 0) { $blocks += (buildChurnText $churn) }
    if ($blocks.Count -eq 0) { return "" }
    return "`n`n" + ($blocks -join "`n`n")
}

$TOPIC_PATTERNS = @{
    cash_gap   = [regex]'\b(cash|deposit|gap|collect|owe|owes|paid|payment|balance)\b'
    tier_slip  = [regex]'\b(tier|level|bronze|silver|gold|platinum|diamond|slip|slipp\w*|dropped|demot\w*|downgrad\w*)\b'
    tier_watch = [regex]'\b(tier|level|accept\w*|finish\w*|coach\w*|risk|watch)\b'
    churn_risk = [regex]'\b(churn\w*|attrition|retention|risk|watch|going\s*dark|dropping\s*off|disengag\w*|inactiv\w*|leav\w*|quit\w*)\b'
}

function detectAlertAck($message, $openAlerts) {
    if (-not $openAlerts -or $openAlerts.Count -eq 0) { return @() }
    $msg = $message.ToLower()
    if ($msg -match 'ack:(\d+)') {
        $id = [int]$Matches[1]
        $a = $openAlerts | Where-Object { $_.id -eq $id } | Select-Object -First 1
        if ($a) {
            $cond = if($a.condition){$a.condition}else{"cash_gap"}
            return ,@(@{ driver_key=$a.driver_key; condition=$cond })
        }
        return @()
    }
    $out = @()
    foreach ($a in $openAlerts) {
        $cond = if($a.condition){$a.condition}else{"cash_gap"}
        $pattern = $TOPIC_PATTERNS[$cond]
        if (-not $pattern.IsMatch($message)) { continue }
        $parts = ($a.driver_name -replace "\s+"," ").ToLower().Split(" ")
        $match = $parts | Where-Object { $_.Length -gt 2 -and $msg.Contains($_) }
        if ($match) { $out += @{ driver_key=$a.driver_key; condition=$cond } }
    }
    return ,$out
}

function ok($label, $cond) {
    if ($cond) { Write-Host "  PASS $label"; $script:pass++ }
    else        { Write-Host "  FAIL $label"; $script:fail++ }
}

Write-Host "`n=== alerting-verify.ps1 (Build-20 + Build-21 + Build-22) ===`n"

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

# T10: buildAlertText — 1 cash_gap alert => individual line
$alerts10 = @(@{ id=1; condition="cash_gap"; driver_key="d1"; driver_name="Ahmad"; state="raised"; severity=2; metric_value=750; raise_value=750; times_raised=1; first_raised_at=(Get-Date).AddDays(-2).ToString("o") })
$text = buildAlertText $alerts10
ok "T10: single alert => contains FLEET ALERT" ($text -match "FLEET ALERT")

# T11: buildAlertText — 3 cash_gap alerts (> BRIEF_CAP=2) => aggregate line
$alerts11 = @(
    @{ id=1; condition="cash_gap"; driver_name="Ahmad"; state="raised"; severity=2; metric_value=800; raise_value=800; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
    @{ id=2; condition="cash_gap"; driver_name="Hassan"; state="raised"; severity=2; metric_value=600; raise_value=600; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
    @{ id=3; condition="cash_gap"; driver_name="Tariq"; state="raised"; severity=2; metric_value=550; raise_value=550; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
)
$text = buildAlertText $alerts11
ok "T11: 3 alerts => aggregate 'collectively owe'" ($text -match "collectively owe")

# T12: detectAlertAck — UI chip ack:<id>
$alerts12 = @(@{ id=7; condition="cash_gap"; driver_key="d7"; driver_name="Ahmad" })
$keys = detectAlertAck "ack:7" $alerts12
ok "T12: UI chip ack:7 => returns driver_key d7" (($keys.Count -gt 0) -and ($keys[0].driver_key -eq "d7"))

# T13: detectAlertAck — chat naming driver + cash topic
$alerts13 = @(@{ id=9; condition="cash_gap"; driver_key="d9"; driver_name="Hassan Ali" })
$keys = detectAlertAck "did Hassan pay his cash balance?" $alerts13
ok "T13: cash topic + driver name => ack detected" (($keys.Count -gt 0) -and ($keys[0].driver_key -eq "d9"))

# T14: detectAlertAck — no cash topic => no ack
$keys = detectAlertAck "how is Hassan doing today?" $alerts13
ok "T14: no cash topic => no ack" ($keys.Count -eq 0)

# T15: Snoozed alert within suppression window — skip (isOpen=false)
$futureTime = (Get-Date).AddHours(12).ToString("o")
$row15 = @{ state="snoozed"; metric_value=700; raise_value=700; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$futureTime }
$t = computeTransition $row15 800 700 $nowMs
ok "T15: snoozed within window => skip with isOpen=false" ($t.action -eq "skip" -and -not $t.isOpen)

# ══ Build-21: tier_slip (ground truth) ═══════════════════════════════════════════

# T16: No row, tier dropped 1 level (Gold=2 -> Silver=1) — raise, severity=2
$t = computeTierSlipTransition $null 1 2 $nowMs
ok "T16: 1-level drop => raise" ($t.action -eq "raise")
ok "T16b: severity=2 for 1-level drop" ($t.fields.severity -eq 2)
ok "T16c: raise_value=baseline(2)" ($t.fields.raise_value -eq 2)

# T17: No row, tier dropped 2 levels (Gold=2 -> Bronze=0) — severity=1
$t = computeTierSlipTransition $null 0 2 $nowMs
ok "T17: 2-level drop => severity=1" ($t.fields.severity -eq 1)

# T18: No row, no drop (level unchanged) — none
$t = computeTierSlipTransition $null 2 2 $nowMs
ok "T18: no drop => none" ($t.action -eq "none")

# T19: Open alert (Gold->Silver, raise_value=2), recovers to Gold (2) — 1st clear
$row19 = @{ state="raised"; metric_value=1; raise_value=2; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-3).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTierSlipTransition $row19 2 1 $nowMs
ok "T19: recovered to raise_value => update_clear" ($t.action -eq "update_clear")
ok "T19b: consecutive_clear=1" ($t.fields.consecutive_clear -eq 1)

# T20: Same, 2nd consecutive recovery — resolve
$row20 = @{ state="raised"; metric_value=2; raise_value=2; consecutive_clear=1; times_raised=1; first_raised_at=(Get-Date).AddDays(-3).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTierSlipTransition $row20 2 1 $nowMs
ok "T20: 2nd consecutive recovery => resolve" ($t.action -eq "resolve")
ok "T20b: isOpen=false after resolve" (-not $t.isOpen)

# T21: Resolved (raise_value=2), within recur window, drops again to Silver(1) — re_raise
$row21 = @{ state="resolved"; metric_value=2; raise_value=2; consecutive_clear=2; times_raised=1; first_raised_at=(Get-Date).AddDays(-10).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=(Get-Date).AddDays(-3).ToString("o"); suppression_until=$null }
$t = computeTierSlipTransition $row21 1 2 $nowMs
ok "T21: resolved + recur + drop again => re_raise" ($t.action -eq "re_raise")
ok "T21b: times_raised incremented" ($t.fields.times_raised -eq 2)

# T22: Open alert (metric_value=1), drops ANOTHER full level to Bronze(0) — worsening re_raise
$row22 = @{ state="raised"; metric_value=1; raise_value=2; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTierSlipTransition $row22 0 1 $nowMs
ok "T22: dropped another level => worsening re_raise" ($t.action -eq "re_raise")
ok "T22b: severity escalated to 1" ($t.fields.severity -eq 1)

# T23: DEDUP — checked within 6h — skip
$row23 = @{ state="raised"; metric_value=1; raise_value=2; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-1).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeTierSlipTransition $row23 1 2 $nowMs
ok "T23: checked within 6h => skip (dedup)" ($t.action -eq "skip")

# ══ Build-21: tier_watch (weak-lever leading indicator) ══════════════════════════

# T24: No row, weak today AND weak yesterday (acceptance 60% < 70% floor) — raise
$snap24 = @{ accept=60; finish=85; tier=1 }
$t = computeTierWatchTransition $null $true $true $snap24 $nowMs
ok "T24: 2 consecutive weak days => raise" ($t.action -eq "raise")
ok "T24b: severity=3 (info/watch)" ($t.fields.severity -eq 3)

# T25: No row, weak today but no prior-day data — not consecutive => none
$t = computeTierWatchTransition $null $true $null $snap24 $nowMs
ok "T25: weak today, no prior reading => none" ($t.action -eq "none")

# T26: Open alert, no longer weak (1st clear) — update_clear
$row26 = @{ state="raised"; metric_value=60; raise_value=60; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-3).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$snap26 = @{ accept=75; finish=85; tier=1 }
$t = computeTierWatchTransition $row26 $false $true $snap26 $nowMs
ok "T26: no longer weak (1st clear) => update_clear" ($t.action -eq "update_clear")

# T27: Open alert, acceptance worsens by >=10pts below raise_value — re_raise
$row27 = @{ state="raised"; metric_value=65; raise_value=65; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$snap27 = @{ accept=50; finish=85; tier=1 }
$t = computeTierWatchTransition $row27 $true $true $snap27 $nowMs
ok "T27: acceptance drops >=10pts further => re_raise" ($t.action -eq "re_raise")

# ══ Build-21: mixed brief text + ack routing ═════════════════════════════════════

# T28: buildAlertText — cash_gap + tier_slip together => both blocks present
$alerts28 = @(
    @{ id=1; condition="cash_gap"; driver_name="Ahmad"; state="raised"; severity=2; metric_value=750; raise_value=750; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
    @{ id=2; condition="tier_slip"; driver_name="Hassan"; state="raised"; severity=2; metric_value=1; raise_value=2; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
)
$text = buildAlertText $alerts28
ok "T28: mixed alerts => CASH GAP block present" ($text -match "CASH GAP")
ok "T28b: mixed alerts => TIER SLIP block present" ($text -match "TIER SLIP")

# T29: detectAlertAck — tier topic acks a tier_slip alert, not a cash-only message
$alerts29 = @(@{ id=20; condition="tier_slip"; driver_key="d20"; driver_name="Tariq Noor" })
$keys = detectAlertAck "did Tariq's tier level drop?" $alerts29
ok "T29: tier topic + driver name => acks tier_slip alert" (($keys.Count -gt 0) -and ($keys[0].driver_key -eq "d20") -and ($keys[0].condition -eq "tier_slip"))

$keysNone = detectAlertAck "how's Tariq's mood today?" $alerts29
ok "T29b: no tier topic => no ack" ($keysNone.Count -eq 0)

# ══ Build-22: churn_risk (wraps fleet.js driverChurn composite) ═══════════════════

# T30: No row, flagged with score=2 (meets flag floor) — raise, severity=2
$flagged30 = @{ score=2; reasons=@("2 straight active day(s) under 200 SAR net", "acceptance falling - 80% -> 60%"); activeDays=10; lastActive="6 Jun 2026" }
$t = computeChurnTransition $null $flagged30 $nowMs
ok "T30: flagged score=2 => raise" ($t.action -eq "raise")
ok "T30b: severity=2 at score=2" ($t.fields.severity -eq 2)
ok "T30c: raise_value=score(2)" ($t.fields.raise_value -eq 2)

# T31: No row, flagged with score=3 (multiple compounding signals) — severity=1
$flagged31 = @{ score=3; reasons=@("went dark", "3 straight active day(s) under 200 SAR net"); activeDays=8; lastActive="3 Jun 2026" }
$t = computeChurnTransition $null $flagged31 $nowMs
ok "T31: flagged score=3 => severity=1" ($t.fields.severity -eq 1)

# T32: No row, not flagged — none
$t = computeChurnTransition $null $null $nowMs
ok "T32: not flagged => none" ($t.action -eq "none")

# T33: Open alert (score=2), no longer flagged — 1st clear
$row33 = @{ state="raised"; metric_value=2; raise_value=2; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-3).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeChurnTransition $row33 $null $nowMs
ok "T33: no longer flagged (1st clear) => update_clear" ($t.action -eq "update_clear")
ok "T33b: consecutive_clear=1" ($t.fields.consecutive_clear -eq 1)

# T34: Same, 2nd consecutive not-flagged — resolve
$row34 = @{ state="raised"; metric_value=2; raise_value=2; consecutive_clear=1; times_raised=1; first_raised_at=(Get-Date).AddDays(-3).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$t = computeChurnTransition $row34 $null $nowMs
ok "T34: 2nd consecutive not-flagged => resolve" ($t.action -eq "resolve")
ok "T34b: isOpen=false after resolve" (-not $t.isOpen)

# T35: Resolved, within recur window, flagged again — re_raise
$row35 = @{ state="resolved"; metric_value=0; raise_value=2; consecutive_clear=2; times_raised=1; first_raised_at=(Get-Date).AddDays(-10).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=(Get-Date).AddDays(-3).ToString("o"); suppression_until=$null }
$flagged35 = @{ score=2; reasons=@("went dark"); activeDays=5; lastActive="1 Jun 2026" }
$t = computeChurnTransition $row35 $flagged35 $nowMs
ok "T35: resolved + recur + flagged again => re_raise" ($t.action -eq "re_raise")
ok "T35b: times_raised incremented" ($t.fields.times_raised -eq 2)

# T36: Open alert (raise_value=2), composite score rises to 3 — worsening re_raise
$row36 = @{ state="raised"; metric_value=2; raise_value=2; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-10).ToString("o"); resolved_at=$null; suppression_until=$null }
$flagged36 = @{ score=3; reasons=@("went dark", "acceptance falling - 75% -> 55%"); activeDays=6; lastActive="6 Jun 2026" }
$t = computeChurnTransition $row36 $flagged36 $nowMs
ok "T36: score rises >= CHURN_WORSEN_DELTA => re_raise" ($t.action -eq "re_raise")
ok "T36b: severity escalated to 1" ($t.fields.severity -eq 1)

# T37: DEDUP — checked within 6h — skip
$row37 = @{ state="raised"; metric_value=2; raise_value=2; consecutive_clear=0; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); last_checked_at=(Get-Date).AddHours(-1).ToString("o"); resolved_at=$null; suppression_until=$null }
$flagged37 = @{ score=2; reasons=@("went dark"); activeDays=6; lastActive="6 Jun 2026" }
$t = computeChurnTransition $row37 $flagged37 $nowMs
ok "T37: checked within 6h => skip (dedup)" ($t.action -eq "skip")

# T38: buildAlertText — churn_risk block present alongside cash_gap
$alerts38 = @(
    @{ id=1; condition="cash_gap"; driver_name="Ahmad"; state="raised"; severity=2; metric_value=750; raise_value=750; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o") }
    @{ id=2; condition="churn_risk"; driver_name="Hassan"; state="raised"; severity=2; metric_value=2; raise_value=2; times_raised=1; first_raised_at=(Get-Date).AddDays(-1).ToString("o"); metadata=@{ reasons=@("went dark") } }
)
$text = buildAlertText $alerts38
ok "T38: mixed alerts => CASH GAP block present" ($text -match "CASH GAP")
ok "T38b: mixed alerts => CHURN RISK block present" ($text -match "CHURN RISK")

# T39: detectAlertAck — churn topic acks a churn_risk alert, not an unrelated message
$alerts39 = @(@{ id=30; condition="churn_risk"; driver_key="d30"; driver_name="Yousef Al" })
$keys = detectAlertAck "is Yousef at risk of churning?" $alerts39
ok "T39: churn topic + driver name => acks churn_risk alert" (($keys.Count -gt 0) -and ($keys[0].driver_key -eq "d30") -and ($keys[0].condition -eq "churn_risk"))

$keysNone = detectAlertAck "what's Yousef's net today?" $alerts39
ok "T39b: no churn topic => no ack" ($keysNone.Count -eq 0)

$total = $pass + $fail
Write-Host "`n=== $pass/$total PASS ===" -ForegroundColor $(if($fail -eq 0){"Green"}else{"Red"})
if ($fail -gt 0) { exit 1 }
