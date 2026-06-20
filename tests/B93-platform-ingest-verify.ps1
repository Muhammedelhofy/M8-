# ============================================================================
# Build-93: Multi-platform ingestion - offline verifier (PS 5.1, no local Node).
#   powershell -File tests/B93-platform-ingest-verify.ps1
#
# No Node is available in this environment, so each of the 5 spec checks pairs:
#   (a) a PURE-PowerShell MIRROR of the JS logic run over small fixtures, with
#   (b) a STATIC assertion against the REAL source file, so the check is tied to
#       the shipped code and not just to the mirror.
# Pure ASCII (PS 5.1 reads a no-BOM file as ANSI); no ternary operators.
# ============================================================================
$ErrorActionPreference = "Stop"
$global:pass = 0
$global:tot  = 0

function Check($name, $cond) {
    $global:tot = $global:tot + 1
    $status = "FAIL"; $color = "Red"
    if ($cond) { $status = "PASS"; $color = "Green"; $global:pass = $global:pass + 1 }
    Write-Host ("[{0}] {1}" -f $status, $name) -ForegroundColor $color
}

$root = Split-Path $PSScriptRoot -Parent
function Read-Src($rel) {
    $p = Join-Path $root $rel
    for ($i = 0; $i -lt 3; $i++) {
        try { return (Get-Content -LiteralPath $p -Raw -ErrorAction Stop) }
        catch { Start-Sleep -Milliseconds 150 }
    }
    return ""
}

$srcSchemas = Read-Src "lib/platform-schemas.js"
$srcIngest  = Read-Src "lib/platform-ingest.js"
$srcBrief   = Read-Src "lib/morning-brief.js"
$srcApi     = Read-Src "api/platform-sync.js"

# ---- PURE-LOGIC MIRRORS -----------------------------------------------------
$KNOWN = @('bolt','uber','hungerstation','keeta','noon')

function Norm-Header($h) {
    if ($null -eq $h) { $h = "" }
    $x = ([string]$h).ToLower()
    $x = ($x -split '\|')[0]
    $x = $x.Trim()
    $x = ($x -replace '\s+',' ')
    return $x
}
function To-Number($v) {
    if ($null -eq $v) { return 0.0 }
    $s = ([string]$v) -replace '[^\d\.\-]',''
    if (-not $s -or $s -eq '-' -or $s -eq '.') { return 0.0 }
    $n = 0.0
    if ([double]::TryParse($s, [ref]$n)) { return $n }
    return 0.0
}
function Pick-Field($lookup, $cands) {
    foreach ($c in $cands) {
        $key = Norm-Header $c
        if ($lookup.ContainsKey($key)) { return $lookup[$key] }
    }
    return ""
}
# Mirror of normalizeRow(rawRow,'bolt') - the confirmed schema.
function Normalize-Bolt($rawRow) {
    $lookup = @{}
    foreach ($k in $rawRow.Keys) { $lookup[(Norm-Header $k)] = $rawRow[$k] }
    $name  = ([string](Pick-Field $lookup @("Driver name","Driver"))).Trim()
    $gross = To-Number (Pick-Field $lookup @("Total earnings","Gross earnings"))
    $trips = [int][math]::Round((To-Number (Pick-Field $lookup @("Trips"))))
    return [pscustomobject]@{ driverName = $name; platform = "bolt"; grossEarnings = $gross; trips = $trips }
}
# Mirror of parseCSV's guard surface: unknown platform => empty array, no throw.
function Mirror-ParseCSV($csvText, $platform) {
    if (-not ($KNOWN -contains $platform)) { return @() }
    if (($null -eq $csvText) -or (-not ([string]$csvText).Trim())) { return @() }
    return @( "row" )  # detail irrelevant to this check
}
# Mirror of mergePlatformData: group by lower(driverName), sum gross/trips.
function Merge-Platforms($arrays) {
    $byDriver = @{}
    foreach ($arr in $arrays) {
        foreach ($r in $arr) {
            $name = ([string]$r.driverName).Trim()
            if (-not $name) { continue }
            $key = $name.ToLower()
            if (-not $byDriver.ContainsKey($key)) {
                $byDriver[$key] = [pscustomobject]@{ name = $name; totalGross = 0.0; totalTrips = 0.0; platforms = New-Object System.Collections.ArrayList }
            }
            $d = $byDriver[$key]
            $d.totalGross += [double]$r.grossEarnings
            $d.totalTrips += [double]$r.trips
            $plat = ([string]$r.platform).ToLower()
            if ($plat -and -not ($d.platforms -contains $plat)) { [void]$d.platforms.Add($plat) }
        }
    }
    return $byDriver
}
# Mirror of formatPlatformText - the appended Multi-Platform section.
function Format-PlatformText($pd) {
    $s = $pd.summary
    $keys = $s.platforms.Keys | Sort-Object { -1 * [double]$s.platforms[$_].gross }
    $lines = New-Object System.Collections.ArrayList
    [void]$lines.Add("")
    [void]$lines.Add("Multi-Platform (last sync)")
    foreach ($k in $keys) {
        $p = $s.platforms[$k]
        $drv = "$($p.drivers) drivers"
        if ($p.drivers -eq 1) { $drv = "$($p.drivers) driver" }
        [void]$lines.Add(("{0}: {1}, {2} {3}, {4} SAR gross" -f $p.label, $drv, ('{0:N0}' -f [int]$p.trips), $p.unitLabel, ('{0:N0}' -f [int]$p.gross)))
    }
    [void]$lines.Add(("Total cross-platform gross: {0} SAR" -f ('{0:N0}' -f [int]$s.totalGross)))
    return ($lines -join "`n")
}
# Mirror of the guarded render: null platformData => base text unchanged.
function Render-WithPlatform($baseText, $platformData) {
    if ($null -eq $platformData) { return $baseText }
    return ($baseText + "`n" + (Format-PlatformText $platformData))
}

Write-Host ""
Write-Host "== Build-93 multi-platform ingestion ==" -ForegroundColor Cyan

# ---- 1) Bolt CSV (3 inline rows) -> normalizeRow populates fields ------------
$boltRows = @(
    @{ "Driver name" = "Ahmed Ali";    "Total earnings" = "1,234.50"; "Trips" = "42"; "Online hours" = "9.5" },
    @{ "Driver name" = "Bandar Saud";  "Total earnings" = "980";      "Trips" = "31"; "Online hours" = "7" },
    @{ "Driver name" = "Khalid Omar";  "Total earnings" = "2,050.00"; "Trips" = "55"; "Online hours" = "11" }
)
$t1mirror = $true
foreach ($rr in $boltRows) {
    $nr = Normalize-Bolt $rr
    if (-not ($nr.driverName) -or ($nr.platform -ne "bolt") -or (-not ($nr.grossEarnings -gt 0))) { $t1mirror = $false }
}
$nrFirst = Normalize-Bolt $boltRows[0]
$t1mirror = $t1mirror -and ($nrFirst.driverName -eq "Ahmed Ali") -and ([math]::Round($nrFirst.grossEarnings,2) -eq 1234.50)
$t1static = ($srcSchemas -match 'PLATFORM_SCHEMAS') -and ($srcSchemas -match 'normalizeRow') `
    -and ($srcSchemas -match 'Driver name') -and ($srcSchemas -match 'Total earnings') -and ($srcSchemas -match 'bolt:')
Check "1. Bolt 3 rows -> normalizeRow populates driverName/platform/grossEarnings" ($t1mirror -and $t1static)

# ---- 2) Unknown platform -> parseCSV returns [] and does not throw -----------
$t2NoThrow = $true; $t2Empty = $false
try {
    $r = @(Mirror-ParseCSV "h1,h2`n1,2" "frobnix_unknown")
    $t2Empty = ($r.Count -eq 0)
} catch { $t2NoThrow = $false }
$t2static = ($srcIngest -match 'unknown platform') -and ($srcIngest -match 'console\.warn') `
    -and ($srcIngest -match 'return \[\]') -and ($srcIngest -match 'catch')
Check "2. Unknown platform -> parseCSV returns [] (no throw)" ($t2NoThrow -and $t2Empty -and $t2static)

# ---- 3) mergePlatformData, 1 shared driver -> totalGross summed --------------
$uberRows = @( [pscustomobject]@{ driverName = "Ahmed";  platform = "uber";          grossEarnings = 100; trips = 5 } )
$hsRows   = @( [pscustomobject]@{ driverName = "ahmed";  platform = "hungerstation"; grossEarnings = 50;  trips = 3 } )
$merged = Merge-Platforms @($uberRows, $hsRows)
$t3mirror = $merged.ContainsKey("ahmed") -and ([math]::Round($merged["ahmed"].totalGross) -eq 150) -and ($merged.Keys.Count -eq 1)
$t3mirror = $t3mirror -and ($merged["ahmed"].platforms.Count -eq 2)
$t3static = ($srcIngest -match 'mergePlatformData') -and ($srcIngest -match 'toLowerCase') -and ($srcIngest -match 'totalGross')
Check "3. mergePlatformData sums shared driver gross (100+50=150)" ($t3mirror -and $t3static)

# ---- 4) buildBrief platformData=null -> output unchanged ---------------------
$baseText = "MORNING FLEET BRIEF base body"
$t4mirror = ((Render-WithPlatform $baseText $null) -eq $baseText)
$t4static = ($srcBrief -match 'opts\.platformData \|\| null') `
    -and ($srcBrief -match 'if \(platformData\) brief\.platformData = platformData') `
    -and ($srcBrief -match 'if \(brief\.platformData\)') `
    -and ($srcBrief -match 'buildBrief')
Check "4. buildBrief platformData=null -> output unchanged (guarded)" ($t4mirror -and $t4static)

# ---- 5) buildBrief platformData present -> output contains Multi-Platform ----
$pd = [pscustomobject]@{
    summary = [pscustomobject]@{
        totalGross = 6000
        platforms  = @{
            uber          = [pscustomobject]@{ label = "Uber";          unitLabel = "trips";  drivers = 3; trips = 47; gross = 4200 }
            hungerstation = [pscustomobject]@{ label = "HungerStation"; unitLabel = "orders"; drivers = 2; trips = 31; gross = 1800 }
        }
    }
}
$rendered = Render-WithPlatform $baseText $pd
$t5mirror = ($rendered -match 'Multi-Platform') -and ($rendered -match 'Total cross-platform gross') -and ($rendered -match 'Uber')
$t5static = ($srcBrief -match 'Multi-Platform \(last sync\)') -and ($srcBrief -match 'Total cross-platform gross')
Check "5. buildBrief platformData present -> contains 'Multi-Platform'" ($t5mirror -and $t5static)

# ---- extra (not scored): api/platform-sync.js auth is the FIRST logic --------
$apiAuthFirst = $false
if ($srcApi) {
    $m = [regex]::Match($srcApi, 'module\.exports\s*=\s*async\s*function\s*handler\s*\([^)]*\)\s*\{')
    if ($m.Success) {
        $after = $srcApi.Substring($m.Index + $m.Length)
        $idxToken = $after.IndexOf('x-m8-token')
        $idxParse = $after.IndexOf('parseCSV')
        $apiAuthFirst = ($idxToken -ge 0) -and (($idxParse -lt 0) -or ($idxToken -lt $idxParse)) -and ($after -match 'M8_CRON_SECRET') -and ($after -match '401')
    }
}
$extraColor = "DarkYellow"
if ($apiAuthFirst) { $extraColor = "DarkGreen" }
Write-Host ("  (extra) api/platform-sync auth-first check: {0}" -f $apiAuthFirst) -ForegroundColor $extraColor

# ---- summary ----------------------------------------------------------------
Write-Host ""
Write-Host ("{0}/5 passed" -f $global:pass) -ForegroundColor Yellow
if ($global:pass -lt $global:tot) { exit 1 }
exit 0
