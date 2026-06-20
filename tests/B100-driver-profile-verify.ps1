# Build-100: Driver Profile Manager -- offline, pure PS 5.1, ASCII only.
# Mirrors classifyDriverProfile() + the orchestrator's deterministic CRUD output
# (formatDriverProfileTable / upsert confirmation / delete confirmation), then
# static-checks the three source files for the wiring. No Node, no live DB calls.
#
# The curly apostrophe (U+2019) is built via CharStr so this file stays pure ASCII.

$ErrorActionPreference = 'Stop'
$pass = 0
$fail = 0

function Assert-Eq {
  param([string]$label, $got, $exp)
  if ($got -eq $exp) {
    Write-Host ("  PASS  " + $label) -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host ("  FAIL  " + $label + "  got='" + $got + "'  exp='" + $exp + "'") -ForegroundColor Red
    $script:fail++
  }
}

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) {
    Write-Host ("  PASS  " + $label) -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host ("  FAIL  " + $label) -ForegroundColor Red
    $script:fail++
  }
}

# Build a string from Unicode code points so the source stays pure ASCII.
function CharStr([int[]]$points) {
  -join ($points | ForEach-Object { [char]$_ })
}

# ---------------------------------------------------------------------------
# PS mirror of the JS logic (lib/intentClassifier.js + orchestrator helpers)
# ---------------------------------------------------------------------------
$APOS = (CharStr 0x2019)                 # curly apostrophe
$APOS_CLASS = '[' + "'" + $APOS + ']'    # char class: ['<curly>]

function Map-Field([string]$f) {
  switch ($f.ToLower()) {
    'rental' { 'rental_amount'; break }
    'salary' { 'salary_amount'; break }
    'fuel'   { 'fuel_estimate'; break }
    'other'  { 'other_costs';   break }
    default  { '' }
  }
}

function Parse-DriverAmount($raw) {
  if ($null -eq $raw) { return $null }
  $c = ([string]$raw) -replace '(?i)sar', ''
  $c = $c -replace ',', ''
  $c = $c -replace '[^\d.]', ''
  $c = $c.Trim()
  if ($c -eq '') { return $null }
  return [double]$c
}

function Clean-DriverName([string]$nameIn) {
  $n = ($nameIn + '').Trim()
  $n = [regex]::Replace($n, $APOS_CLASS + 's$', '', 'IgnoreCase')
  $n = $n -replace '^["'']+', ''
  $n = $n -replace '["''?.!,]+$', ''
  return $n.Trim()
}

function Classify-DriverProfile([string]$message) {
  $raw = ($message + '').Trim()
  if ($raw -eq '') { return $null }

  # 1) delete / remove driver <name>
  $m = [regex]::Match($raw, '\b(?:delete|remove)\s+driver\s+(.+)$', 'IgnoreCase')
  if ($m.Success) {
    $name = Clean-DriverName $m.Groups[1].Value
    if ($name -ne '' -and $name -notmatch '(?i)^profiles?$') {
      return @{ op = 'delete'; driverName = $name; field = $null; amount = $null }
    }
  }

  # 2) set <name>'s <field> to <amount>
  $setPat = '\bset\s+(.+?)' + $APOS_CLASS + 's\s+(rental|salary|fuel|other)\b\s+to\s+([0-9][\d,]*(?:\.\d+)?)'
  $m = [regex]::Match($raw, $setPat, 'IgnoreCase')
  if ($m.Success) {
    $name = Clean-DriverName $m.Groups[1].Value
    $field = Map-Field $m.Groups[2].Value
    if ($name -ne '' -and $field -ne '') {
      return @{ op = 'upsert'; driverName = $name; field = $field; amount = (Parse-DriverAmount $m.Groups[3].Value) }
    }
  }

  # 3) update <name> <field> <amount>
  $m = [regex]::Match($raw, '\bupdate\s+(.+?)\s+(rental|salary|fuel|other)\b\s+(?:to\s+)?([0-9][\d,]*(?:\.\d+)?)', 'IgnoreCase')
  if ($m.Success) {
    $name = Clean-DriverName $m.Groups[1].Value
    $field = Map-Field $m.Groups[2].Value
    if ($name -ne '' -and $field -ne '') {
      return @{ op = 'upsert'; driverName = $name; field = $field; amount = (Parse-DriverAmount $m.Groups[3].Value) }
    }
  }

  # 4) show / list driver profiles (or a bare "driver profiles")
  if ([regex]::IsMatch($raw, '\bdriver\s+profiles?\b', 'IgnoreCase')) {
    return @{ op = 'list'; driverName = $null; field = $null; amount = $null }
  }

  # 5) add driver <name>
  $m = [regex]::Match($raw, '\badd\s+(?:a\s+|new\s+)*driver\s+(.+)$', 'IgnoreCase')
  if ($m.Success) {
    $name = Clean-DriverName $m.Groups[1].Value
    if ($name -ne '' -and $name -notmatch '(?i)^profiles?$') {
      return @{ op = 'upsert'; driverName = $name; field = $null; amount = $null }
    }
  }

  return $null
}

# Mirror of orchestrator num(): JS Math.round (half-up for non-negative SAR).
function NumStr($n) {
  if ($null -eq $n) { return '0' }
  $d = 0.0
  if (-not [double]::TryParse([string]$n, [ref]$d)) { return '0' }
  return [string][long][math]::Floor($d + 0.5)
}

function Pad-Cell($s, [int]$w) {
  $s = [string]$s
  if ($s.Length -ge $w) { return $s }
  return $s + (' ' * ($w - $s.Length))
}

function Format-DriverProfileTable($profiles) {
  $arr = @($profiles)
  if ($arr.Count -eq 0) {
    return "No driver cost profiles on file yet. Add one with: set <driver>'s rental to <amount>."
  }
  $wn = 12; $wr = 6; $ws = 6; $wf = 4; $wo = 5
  $row = {
    param($name, $r, $s, $f, $o)
    (Pad-Cell $name $wn) + " | " + (Pad-Cell $r $wr) + " | " + (Pad-Cell $s $ws) + " | " + (Pad-Cell $f $wf) + " | " + (Pad-Cell $o $wo)
  }
  $sep = ('-' * $wn) + "-|-" + ('-' * $wr) + "-|-" + ('-' * $ws) + "-|-" + ('-' * $wf) + "-|-" + ('-' * $wo)
  $lines = @()
  $lines += ("Driver cost profiles (" + $arr.Count + " on file) -- all amounts SAR/month:")
  $lines += ""
  $lines += (& $row "Driver" "Rental" "Salary" "Fuel" "Other")
  $lines += $sep
  foreach ($p in $arr) {
    $lines += (& $row $p.driver_name (NumStr $p.rental_amount) (NumStr $p.salary_amount) (NumStr $p.fuel_estimate) (NumStr $p.other_costs))
  }
  return ($lines -join "`n")
}

function Format-UpsertConfirmation($name, $action, $rental, $salary, $fuel, $other, $notes) {
  $line = $name + "'s profile " + $action + ": " +
    "rental = " + (NumStr $rental) + " SAR/month, " +
    "salary = " + (NumStr $salary) + " SAR/month, " +
    "fuel = " + (NumStr $fuel) + " SAR/month, " +
    "other = " + (NumStr $other) + " SAR/month"
  if ($notes) { $line += " (note: " + $notes + ")" }
  return $line
}

function Format-DeleteConfirmation($name, [int]$n) {
  if ($n -gt 0) {
    $plural = ''
    if ($n -ne 1) { $plural = 's' }
    return 'Deleted ' + $n + ' driver profile' + $plural + ' matching "' + $name + '".'
  }
  return 'No driver profile found for "' + $name + '" -- nothing to delete.'
}

# ---------------------------------------------------------------------------
# Read the three source files (UTF8 so any non-ASCII decodes cleanly)
# ---------------------------------------------------------------------------
$root  = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ic = [IO.File]::ReadAllText((Join-Path $root "lib\intentClassifier.js"), [Text.Encoding]::UTF8)
$cp = [IO.File]::ReadAllText((Join-Path $root "lib\cost-profiles.js"),    [Text.Encoding]::UTF8)
$or = [IO.File]::ReadAllText((Join-Path $root "lib\orchestrator.js"),     [Text.Encoding]::UTF8)

Write-Host "B100 Driver Profile Manager verify`n"

# ---------------------------------------------------------------------------
# 1. classifyDriverProfile -- each pattern variant
# ---------------------------------------------------------------------------
Write-Host "-- 1. classifyDriverProfile pattern variants --"

$r1 = Classify-DriverProfile "set Ahmad's rental to 1800"
Assert-Eq "set rental -> op"        $r1.op         "upsert"
Assert-Eq "set rental -> driver"    $r1.driverName "Ahmad"
Assert-Eq "set rental -> field"     $r1.field      "rental_amount"
Assert-Eq "set rental -> amount"    $r1.amount     1800

$r2 = Classify-DriverProfile "set Sara's salary to 2000"
Assert-Eq "set salary -> field"     $r2.field      "salary_amount"
Assert-Eq "set salary -> amount"    $r2.amount     2000

$r3 = Classify-DriverProfile "set Omar's fuel to 300"
Assert-Eq "set fuel -> field"       $r3.field      "fuel_estimate"
Assert-Eq "set fuel -> amount"      $r3.amount     300

$r4 = Classify-DriverProfile "set Ali's other to 150"
Assert-Eq "set other -> field"      $r4.field      "other_costs"
Assert-Eq "set other -> amount"     $r4.amount     150

$r5 = Classify-DriverProfile "update Khalid rental 1500"
Assert-Eq "update form -> op"       $r5.op         "upsert"
Assert-Eq "update form -> driver"   $r5.driverName "Khalid"
Assert-Eq "update form -> field"    $r5.field      "rental_amount"
Assert-Eq "update form -> amount"   $r5.amount     1500

$r5b = Classify-DriverProfile "update Khalid fuel to 250"
Assert-Eq "update+to form -> field"  $r5b.field    "fuel_estimate"
Assert-Eq "update+to form -> amount" $r5b.amount   250

$r6 = Classify-DriverProfile "add driver Yusuf"
Assert-Eq "add driver -> op"        $r6.op         "upsert"
Assert-Eq "add driver -> driver"    $r6.driverName "Yusuf"
Assert-True "add driver -> no field"  ($null -eq $r6.field)
Assert-True "add driver -> no amount" ($null -eq $r6.amount)

$r7 = Classify-DriverProfile "show driver profiles"
Assert-Eq "show driver profiles -> op" $r7.op "list"
$r8 = Classify-DriverProfile "list driver profiles"
Assert-Eq "list driver profiles -> op" $r8.op "list"
$r9 = Classify-DriverProfile "driver profiles"
Assert-Eq "bare driver profiles -> op" $r9.op "list"

$r10 = Classify-DriverProfile "delete driver Ahmad"
Assert-Eq "delete driver -> op"     $r10.op         "delete"
Assert-Eq "delete driver -> driver" $r10.driverName "Ahmad"
$r11 = Classify-DriverProfile "remove driver Sara"
Assert-Eq "remove driver -> op"     $r11.op         "delete"
Assert-Eq "remove driver -> driver" $r11.driverName "Sara"

# ---------------------------------------------------------------------------
# 2. Amount parsing + apostrophe styles + multi-word names + negatives
# ---------------------------------------------------------------------------
Write-Host "`n-- 2. parsing, apostrophes, multi-word, negatives --"

$rc = Classify-DriverProfile "set Ahmad's rental to 1,800 SAR"
Assert-Eq "comma+SAR amount stripped" $rc.amount 1800

# curly apostrophe (U+2019) must parse the same as ASCII '
$curlyMsg = "set Ahmad" + $APOS + "s rental to 1800"
$rcurl = Classify-DriverProfile $curlyMsg
Assert-Eq "curly apostrophe -> driver" $rcurl.driverName "Ahmad"
Assert-Eq "curly apostrophe -> amount" $rcurl.amount     1800

$rmw = Classify-DriverProfile "set Abu Bakr's rental to 2200"
Assert-Eq "multi-word name parsed"   $rmw.driverName "Abu Bakr"
Assert-Eq "multi-word name -> amount" $rmw.amount    2200

$rz = Classify-DriverProfile "set Ahmad's salary to 0"
Assert-Eq "zero amount preserved"    $rz.amount 0

Assert-Eq "Parse-DriverAmount '1,800 SAR'" (Parse-DriverAmount "1,800 SAR") 1800
Assert-Eq "Parse-DriverAmount '2200.5'"    (Parse-DriverAmount "2200.5")    2200.5
Assert-Eq "Map-Field rental"               (Map-Field "rental")             "rental_amount"
Assert-Eq "Map-Field FUEL (case-insens)"   (Map-Field "FUEL")               "fuel_estimate"

# Non-commands must return null (fall through to normal routing)
Assert-True "'what was net yesterday' -> null"            ($null -eq (Classify-DriverProfile "what was net yesterday"))
Assert-True "'show me driver Ahmad earnings' -> null"     ($null -eq (Classify-DriverProfile "show me driver Ahmad's earnings"))
Assert-True "'list my drivers' -> null (not profiles)"    ($null -eq (Classify-DriverProfile "list my drivers"))
Assert-True "'how is my fleet doing' -> null"             ($null -eq (Classify-DriverProfile "how is my fleet doing"))

# ---------------------------------------------------------------------------
# 3. op='list' output format (formatDriverProfileTable)
# ---------------------------------------------------------------------------
Write-Host "`n-- 3. list output format --"

$empty = Format-DriverProfileTable @()
Assert-True "empty list -> 'No driver cost profiles' message" ($empty -match "No driver cost profiles on file")

$sample = @(
  @{ driver_name = "Ahmad"; rental_amount = 1800; salary_amount = 2000; fuel_estimate = 300; other_costs = 0 },
  @{ driver_name = "Sara";  rental_amount = 1500; salary_amount = 0;    fuel_estimate = 250; other_costs = 100 }
)
$table = Format-DriverProfileTable $sample
Assert-True "table header has Driver column"  ($table -match "Driver")
Assert-True "table header has Rental column"  ($table -match "Rental")
Assert-True "table header has Salary column"  ($table -match "Salary")
Assert-True "table header has Fuel column"    ($table -match "Fuel")
Assert-True "table header has Other column"   ($table -match "Other")
Assert-True "table has a separator row"       ($table -match "-\|-")
Assert-True "table row for Ahmad present"     ($table -match "Ahmad")
Assert-True "table row shows Ahmad rental"    ($table -match "Ahmad\s+\|\s+1800")
Assert-True "table row for Sara present"      ($table -match "Sara")
Assert-True "table uses pipe column separator" ($table.Contains("|"))

# ---------------------------------------------------------------------------
# 4. upsert confirmation format
# ---------------------------------------------------------------------------
Write-Host "`n-- 4. upsert confirmation format --"

$conf = Format-UpsertConfirmation "Ahmad" "updated" 1800 0 0 0 $null
$expConf = "Ahmad's profile updated: rental = 1800 SAR/month, salary = 0 SAR/month, fuel = 0 SAR/month, other = 0 SAR/month"
Assert-Eq "upsert confirmation exact string" $conf $expConf

$confCreated = Format-UpsertConfirmation "Yusuf" "created" 0 0 0 0 $null
Assert-True "created confirmation says created" ($confCreated -match "Yusuf's profile created:")

$confNote = Format-UpsertConfirmation "Sara" "updated" 1500 0 250 100 "company car"
Assert-True "confirmation appends notes" ($confNote -match "\(note: company car\)")

# ---------------------------------------------------------------------------
# 5. delete confirmation format
# ---------------------------------------------------------------------------
Write-Host "`n-- 5. delete confirmation format --"

Assert-Eq "delete n=1 confirmation" (Format-DeleteConfirmation "Ahmad" 1) 'Deleted 1 driver profile matching "Ahmad".'
Assert-Eq "delete n=2 confirmation" (Format-DeleteConfirmation "Ahmad" 2) 'Deleted 2 driver profiles matching "Ahmad".'
Assert-Eq "delete n=0 confirmation" (Format-DeleteConfirmation "Ghost" 0) 'No driver profile found for "Ghost" -- nothing to delete.'

# ---------------------------------------------------------------------------
# 6. Static source wiring checks
# ---------------------------------------------------------------------------
Write-Host "`n-- 6. source wiring (the JS the mirror stands in for) --"

# intentClassifier.js
Assert-True "INTENT enum has DRIVER_PROFILE"          ($ic -match 'DRIVER_PROFILE:\s*"DRIVER_PROFILE"')
Assert-True "classifyDriverProfile function defined"  ($ic -match 'function classifyDriverProfile')
Assert-True "classifyDriverProfile exported"          ($ic -match 'module\.exports\s*=\s*\{[^}]*classifyDriverProfile')
Assert-True "field map maps rental->rental_amount"    ($ic -match 'rental:\s*"rental_amount"')
Assert-True "apostrophe class built via fromCharCode" ($ic -match 'String\.fromCharCode\(0x2019\)')
Assert-True "intentClassifier add covers all 3 ops"   (($ic -match "op:\s*`"upsert`"") -and ($ic -match "op:\s*`"list`"") -and ($ic -match "op:\s*`"delete`""))

# cost-profiles.js
Assert-True "upsertCostProfile defined"               ($cp -match 'async function upsertCostProfile')
Assert-True "upsertCostProfile exported"              ($cp -match 'module\.exports\s*=\s*\{[\s\S]*upsertCostProfile')
Assert-True "upsert does ilike existence check"       ($cp -match 'ilike\("driver_name"')
Assert-True "upsert deletes placeholder 'driver name'" ($cp -match 'delete\(\)\.ilike\("driver_name",\s*"driver name"\)')
Assert-True "upsert returns action created/updated"   (($cp -match 'action\s*=\s*"created"') -and ($cp -match 'action\s*=\s*"updated"'))

# orchestrator.js
Assert-True "orchestrator imports classifyDriverProfile" ($or -match 'classifyDriverProfile\s*\}\s*=\s*require\("\.\/intentClassifier"\)')
Assert-True "handleDriverProfileCommand defined"      ($or -match 'async function handleDriverProfileCommand')
Assert-True "formatDriverProfileTable defined"        ($or -match 'function formatDriverProfileTable')
Assert-True "buffered path calls handler (_dp)"       ($or -match 'const _dp = await handleDriverProfileCommand')
Assert-True "streaming path calls handler (_dpS)"     ($or -match 'const _dpS = await handleDriverProfileCommand')
Assert-True "handler reaches all 3 ops"               (($or -match 'parsed\.op === "list"') -and ($or -match 'parsed\.op === "delete"') -and ($or -match 'op === "upsert"'))
Assert-True "delete uses ilike on driver_name"        ($or -match '\.ilike\("driver_name",\s*parsed\.driverName\)')
Assert-True "confirmation uses SAR/month wording"     ($or -match 'SAR/month')
Assert-True "list empty message in source"            ($or -match 'No driver cost profiles on file')

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
$total = $pass + $fail
$color = "Green"
if ($fail -gt 0) { $color = "Red" }
Write-Host ("B100 Driver Profile Manager - " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
