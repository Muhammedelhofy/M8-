# ============================================================================
# Build-97: Uber CSV integration -- offline verifier (PS 5.1, no local Node).
#   powershell -File tests/B97-uber-csv-verify.ps1
#
# No Node on the box, so each behavioural check pairs a PURE-PowerShell MIRROR of
# the JS logic (run over small fixtures) with a STATIC assertion against the REAL
# source file, so the check is tied to the shipped code and not just the mirror.
#
# Pure ASCII (PS 5.1 reads a no-BOM file as ANSI). No ternary, no em-dash, no
# Arabic literals, no function named CP (Copy-Item alias). All file reads use
# [IO.File]::ReadAllText(path, UTF8) to dodge OneDrive's flaky Get-Content.
# ============================================================================
$ErrorActionPreference = "Stop"
$script:pass = 0
$script:tot  = 0

function Check($name, $cond) {
    $script:tot = $script:tot + 1
    $status = "FAIL"; $color = "Red"
    if ($cond) { $status = "PASS"; $color = "Green"; $script:pass = $script:pass + 1 }
    Write-Host ("[{0}] {1}" -f $status, $name) -ForegroundColor $color
}

$root = Split-Path $PSScriptRoot -Parent
function Read-Src($rel) {
    $p = Join-Path $root $rel
    if (-not [IO.File]::Exists($p)) { return "" }
    return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
}

# ---- PURE-LOGIC MIRRORS -----------------------------------------------------
# Mirror of normHeader: lowercase, drop the |unit suffix, trim, collapse spaces.
function Norm-Header($h) {
    if ($null -eq $h) { $h = "" }
    $x = ([string]$h).ToLower()
    $x = ($x -split '\|')[0]
    $x = $x.Trim()
    $x = ($x -replace '\s+', ' ')
    return $x
}
# Mirror of toNumber: strip currency text / commas, parse with invariant culture.
function To-Number($v) {
    if ($null -eq $v) { return 0.0 }
    $s = ([string]$v) -replace '[^\d\.\-]', ''
    if ((-not $s) -or ($s -eq '-') -or ($s -eq '.')) { return 0.0 }
    $num = 0.0
    $okParse = [double]::TryParse($s, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$num)
    if ($okParse) { return $num }
    return 0.0
}
function Pick-Field($lookup, $cands) {
    foreach ($c in $cands) {
        $key = Norm-Header $c
        if ($lookup.ContainsKey($key)) { return $lookup[$key] }
    }
    return ""
}
function Present-Field($lookup, $cands) {
    foreach ($c in $cands) {
        if ($lookup.ContainsKey((Norm-Header $c))) { return $true }
    }
    return $false
}

# Uber alias lists -- mirror of the uber schema columns in lib/platform-schemas.js
$UBER_DRIVER = @("Driver Name", "Partner Name", "Driver", "Courier Name", "Delivery Partner", "Name", "driver_name", "partner_name")
$UBER_EARN   = @("Net Earnings", "Net Pay", "Net Payout", "Net Fare", "Total Earnings", "Your Earnings", "Total Payout", "Payout", "Earnings", "Total Fares", "Gross Fares", "net_earnings", "total_earnings")
$UBER_TRIPS  = @("Trips", "Completed Trips", "Trips Completed", "Deliveries", "Deliveries Completed", "Completed Deliveries", "Total Trips", "Orders", "trips")
$UBER_HOURS  = @("Online Hours", "Hours Online", "Time Online", "Active Hours", "Hours", "online_hours")

# Mirror of normalizeRow(rawRow,'uber') including the Build-97 null guard.
function Normalize-Uber($rawRow) {
    $lookup = @{}
    foreach ($k in $rawRow.Keys) { $lookup[(Norm-Header $k)] = $rawRow[$k] }
    $nm = ([string](Pick-Field $lookup $UBER_DRIVER)).Trim()
    $hasEarn = Present-Field $lookup $UBER_EARN
    if ((-not $nm) -or (-not $hasEarn)) { return $null }
    $earn = To-Number (Pick-Field $lookup $UBER_EARN)
    $trp  = [int][math]::Round((To-Number (Pick-Field $lookup $UBER_TRIPS)))
    $hrs  = To-Number (Pick-Field $lookup $UBER_HOURS)
    return [pscustomobject]@{ driverName = $nm; platform = "uber"; grossEarnings = $earn; trips = $trp; hoursOnline = $hrs }
}

# Mirror of toSlug for the LATIN cases this build needs (Mohammed==Muhammad,
# Ahmad==Ahmed). The Arabic->Latin map in lib/entity-slug.js is a no-op for Latin
# input, so the consonant-skeleton steps below match the real slug for these. The
# static check below ties the merge module to the real toSlug for Arabic.
function Get-Slug([string]$name) {
    if ($null -eq $name) { return "" }
    $orig = [string]$name
    $s = $orig.ToLowerInvariant()
    $s = $s.Replace('dh', 'd').Replace('th', 't').Replace('kh', 'k').Replace('sh', 's').Replace('gh', 'g')
    $s = [regex]::Replace($s, '[aeiou]', '')        # consonant skeleton
    $s = [regex]::Replace($s, '(.)\1+', '$1')       # collapse doubled letters
    $s = [regex]::Replace($s, '[^a-z0-9\s-]', '')
    $s = $s.Trim()
    $s = [regex]::Replace($s, '[\s-]+', '-')
    $s = [regex]::Replace($s, '^-+|-+$', '')
    if ($s.Length -gt 80) { $s = $s.Substring(0, 80) }
    if ([string]::IsNullOrEmpty($s)) {
        $s = $orig.ToLowerInvariant()
        $s = [regex]::Replace($s, '[^a-z0-9]+', '-')
        $s = [regex]::Replace($s, '^-+|-+$', '')
    }
    return $s
}

function Plat-Label($p) {
    switch (([string]$p).ToLower()) {
        "bolt"          { return "Bolt" }
        "uber"          { return "Uber" }
        "hungerstation" { return "HungerStation" }
        "keeta"         { return "Keeta" }
        "noon"          { return "Noon" }
        default {
            $x = [string]$p
            if ($x.Length -eq 0) { return "Unknown" }
            return ($x.Substring(0, 1).ToUpper() + $x.Substring(1))
        }
    }
}

# Mirror of mergeDriverProfiles pass 1: slug -> { name, byPlatform }.
function Merge-Profiles($platforms) {
    $acc = @{}
    foreach ($entry in $platforms) {
        $entryPlat = ([string]$entry.platform).ToLower().Trim()
        foreach ($r in $entry.rows) {
            if ($null -eq $r) { continue }
            $nm = ([string]$r.driverName).Trim()
            if (-not $nm) { continue }
            $slug = Get-Slug $nm
            if (-not $slug) { continue }
            $plat = ([string]$r.platform).ToLower().Trim()
            if (-not $plat) { $plat = $entryPlat }
            if (-not $plat) { $plat = "unknown" }
            if (-not $acc.ContainsKey($slug)) {
                $acc[$slug] = [pscustomobject]@{ name = $nm; byPlatform = @{} }
            }
            $bp = $acc[$slug].byPlatform
            if (-not $bp.ContainsKey($plat)) {
                $bp[$plat] = [pscustomobject]@{ platform = $plat; netEarnings = 0.0; trips = 0.0; hoursOnline = 0.0 }
            }
            $rowEarn = [double]$r.grossEarnings
            if ($null -ne $r.netEarnings) { $rowEarn = [double]$r.netEarnings }
            $bp[$plat].netEarnings += $rowEarn
            $bp[$plat].trips       += [double]$r.trips
            $bp[$plat].hoursOnline += [double]$r.hoursOnline
        }
    }
    return $acc
}

# Mirror of mergeDriverProfiles pass 2: finalize the public profile shape.
function Build-Profile($accEntry) {
    $arr = @()
    foreach ($k in $accEntry.byPlatform.Keys) {
        $pf = $accEntry.byPlatform[$k]
        $arr += [pscustomobject]@{
            platform    = $pf.platform
            netEarnings = [int][math]::Round($pf.netEarnings)
            trips       = [int][math]::Round($pf.trips)
            hoursOnline = [math]::Round($pf.hoursOnline, 2)
        }
    }
    $arr = @($arr | Sort-Object @{ Expression = { -1 * $_.netEarnings } }, @{ Expression = { $_.platform } })
    $sumNet = 0
    foreach ($p in $arr) { $sumNet += $p.netEarnings }
    $primary = ""
    if ($arr.Count -gt 0) { $primary = $arr[0].platform }
    return [pscustomobject]@{ canonicalName = $accEntry.name; platforms = $arr; totalNet = [int]$sumNet; primaryPlatform = $primary }
}

# Mirror of formatCombinedProfile.
function Format-Profile($profile) {
    if ($null -eq $profile) { return "" }
    $nm = ([string]$profile.canonicalName).Trim()
    if (-not $nm) { $nm = "(unknown)" }
    $plats = @($profile.platforms)
    if ($plats.Count -eq 0) { return ($nm + ": no platform earnings") }
    $earnParts = @()
    foreach ($p in $plats) { $earnParts += ((Plat-Label $p.platform) + " " + [string]([int][math]::Round($p.netEarnings))) }
    $earnStr = ($earnParts -join " + ")
    $sumNet = [int][math]::Round($profile.totalNet)
    $tripParts = @()
    foreach ($p in $plats) {
        if (([double]$p.trips) -gt 0) { $tripParts += ([string]([int][math]::Round($p.trips)) + " trips " + (Plat-Label $p.platform)) }
    }
    $tripStr = ""
    if ($tripParts.Count -gt 0) { $tripStr = " (" + ($tripParts -join ", ") + ")" }
    return ($nm + ": " + $earnStr + " = " + [string]$sumNet + " SAR total" + $tripStr)
}

Write-Host ""
Write-Host "== Build-97 Uber CSV integration ==" -ForegroundColor Cyan

# ---- load real sources ------------------------------------------------------
$srcSchemas = Read-Src "lib/platform-schemas.js"
$srcMerge   = Read-Src "lib/platform-merge.js"
$srcApi     = Read-Src "api/platform-sync.js"

# ---- 1) Uber header normalization (case-insensitive) + currency stripping ----
$row1 = @{ "TOTAL EARNINGS|SAR" = "1,100.50 SAR"; "Driver Name" = "Sami"; "Trips" = "7"; "Online Hours" = "5.5" }
$n1 = Normalize-Uber $row1
$t1 = ($null -ne $n1) -and ($n1.driverName -eq "Sami") -and ([math]::Round($n1.grossEarnings, 2) -eq 1100.50) `
    -and ($n1.trips -eq 7) -and ($n1.platform -eq "uber")
Check "1. Uber header norm (TOTAL EARNINGS|SAR) + SAR/comma strip -> 1100.50" $t1

# ---- 2) net-earnings alias + lower-case header + dollar/comma stripping -------
$row2 = @{ "partner name" = "Lee"; "net earnings" = "`$2,000" }
$n2 = Normalize-Uber $row2
$t2 = ($null -ne $n2) -and ($n2.driverName -eq "Lee") -and ([math]::Round($n2.grossEarnings, 2) -eq 2000)
Check "2. Uber 'net earnings' alias + lower header + dollar/comma strip -> 2000" $t2

# ---- 3) null when the earnings column is entirely absent ----------------------
$row3 = @{ "Driver Name" = "Bob"; "Trips" = "3" }
$n3 = Normalize-Uber $row3
Check "3. null row when no earnings column maps (driver present, earnings absent)" ($null -eq $n3)

# ---- 4) null when the driver name is missing ---------------------------------
$row4 = @{ "Total Earnings" = "500" }
$n4 = Normalize-Uber $row4
Check "4. null row when driver name cannot be determined" ($null -eq $n4)

# ---- 5) a present earnings column that is zero is a real value (kept) ---------
$row5 = @{ "Driver Name" = "Zee"; "Total Earnings" = "0" }
$n5 = Normalize-Uber $row5
$t5 = ($null -ne $n5) -and ($n5.driverName -eq "Zee") -and ($n5.grossEarnings -eq 0)
Check "5. present-but-zero earnings kept (not dropped as 'undetermined')" $t5

# ---- 6) mergeDriverProfiles: slug-based dedup (Mohammed == Muhammad) ----------
$boltRows = @( [pscustomobject]@{ driverName = "Mohammed"; platform = "bolt"; grossEarnings = 4000; trips = 50; hoursOnline = 40 } )
$uberRows = @( [pscustomobject]@{ driverName = "Muhammad"; platform = "uber"; grossEarnings = 1500; trips = 20; hoursOnline = 15 } )
$acc = Merge-Profiles @( @{ platform = "bolt"; rows = $boltRows }, @{ platform = "uber"; rows = $uberRows } )
$slugKey = Get-Slug "Mohammed"
$t6 = ($acc.Keys.Count -eq 1) -and ($acc.ContainsKey($slugKey)) -and ($slugKey -eq "mhmd")
Check ("6. slug dedup: Mohammed == Muhammad -> 1 profile (slug '" + $slugKey + "')") $t6

# ---- 7) merged totals summed across platforms; both platforms retained --------
$prof = Build-Profile $acc[$slugKey]
$t7 = ($prof.totalNet -eq 5500) -and ($prof.platforms.Count -eq 2) -and ($prof.canonicalName -eq "Mohammed")
Check "7. merged totalNet = 4000 + 1500 = 5500, 2 platforms, name kept" $t7

# ---- 8) primaryPlatform = the higher net earner ------------------------------
Check "8. primaryPlatform = bolt (4000 > 1500)" ($prof.primaryPlatform -eq "bolt")

# ---- 9) formatCombinedProfile renders the spec example exactly ----------------
$example = [pscustomobject]@{
    canonicalName   = "Ahmad"
    platforms       = @(
        [pscustomobject]@{ platform = "bolt"; netEarnings = 4200; trips = 0; hoursOnline = 0 },
        [pscustomobject]@{ platform = "uber"; netEarnings = 1100; trips = 3; hoursOnline = 4 }
    )
    totalNet        = 5300
    primaryPlatform = "bolt"
}
$fmt = Format-Profile $example
$want = "Ahmad: Bolt 4200 + Uber 1100 = 5300 SAR total (3 trips Uber)"
Check ("9. formatCombinedProfile exact: '" + $fmt + "'") ($fmt -eq $want)

# ---- STATIC WIRING ASSERTIONS -----------------------------------------------
Write-Host ""
Write-Host "-- static wiring --" -ForegroundColor Cyan

# schemas: uber case + net-first earnings aliases
$t10 = ($srcSchemas -match 'uber\s*:') -and ($srcSchemas -match 'Net Earnings') -and ($srcSchemas -match 'Total Earnings') `
    -and ($srcSchemas -match 'Partner Name')
Check "10. platform-schemas.js: uber case wired with net-first earnings aliases" $t10

# schemas: normalizeRow null guard on absent earnings column
$t11 = ($srcSchemas -match 'present\(cols\.grossEarnings\)') -and ($srcSchemas -match 'return null')
Check "11. platform-schemas.js: normalizeRow null guard (present(cols.grossEarnings))" $t11

# merge module exists + exports + wiring
$t12 = ($srcMerge.Length -gt 0) -and ($srcMerge -match 'function mergeDriverProfiles') `
    -and ($srcMerge -match 'module\.exports') -and ($srcMerge -match 'mergeDriverProfiles')
Check "12. platform-merge.js exports mergeDriverProfiles" $t12

$t13 = ($srcMerge -match 'function formatCombinedProfile') -and ($srcMerge -match 'formatCombinedProfile')
Check "13. platform-merge.js exports formatCombinedProfile" $t13

$t14 = ($srcMerge -match "require\(['""]\./entity-slug") -and ($srcMerge -match 'toSlug\(')
Check "14. platform-merge.js matches by canonical slug (requires entity-slug toSlug)" $t14

$t15 = ($srcMerge -match "require\(['""]\./platform-schemas") -and ($srcMerge -match 'platformLabel')
Check "15. platform-merge.js uses platformLabel from platform-schemas" $t15

# api wiring
$t16 = ($srcApi -match 'mergeDriverProfiles') -and ($srcApi -match "require\(['""]\.\./lib/platform-merge")
Check "16. api/platform-sync.js references mergeDriverProfiles" $t16

$t17 = ($srcApi -match 'combinedFleet')
Check "17. api/platform-sync.js returns a combinedFleet array" $t17

$t18 = ($srcApi -match 'mergedProfiles')
Check "18. api/platform-sync.js returns mergedProfiles" $t18

# ---- summary ----------------------------------------------------------------
Write-Host ""
$color = "Green"
if ($script:pass -lt $script:tot) { $color = "Red" }
Write-Host ("RESULT: {0}/{1} passed" -f $script:pass, $script:tot) -ForegroundColor $color
if ($script:pass -lt $script:tot) { exit 1 }
exit 0
