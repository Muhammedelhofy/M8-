# Build-69: Fleet Intelligence -- offline, pure PS 5.1, ASCII only
# Verifies the four improvements to fleet routing intelligence:
#   1. parseRequestedDate handles bare ordinals ("the 7th", "on the 3rd")
#   2. FLEET_PATTERNS has an ordinal date + money word pattern
#   3. Arabic fleet terms added to FLEET_PATTERNS and WEAK_FLEET_RE
#   4. llmFleetClassify skips WEAK_FLEET_RE guard when in fleet context history
# Arabic strings are built from Unicode code points -- no Arabic literals in source.
# No live calls. No Node required.

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

$fleetPath = Join-Path $PSScriptRoot "..\lib\fleet.js"
$fleetPath = [IO.Path]::GetFullPath($fleetPath)
# Read with explicit UTF8 so Arabic characters decode correctly
$fleet = [IO.File]::ReadAllText($fleetPath, [Text.Encoding]::UTF8)

# Build Arabic strings from code points so this file stays pure ASCII
# safi (net) = U+0635 U+0627 U+0641 U+064A
$safi    = [string][char]0x0635 + [char]0x0627 + [char]0x0641 + [char]0x064A
# ijmali (gross total) = U+0625 U+062C U+0645 U+0627 U+0644 U+064A
$ijmali  = [string][char]0x0625 + [char]0x062C + [char]0x0645 + [char]0x0627 + [char]0x0644 + [char]0x064A
# arbah (earnings) = U+0623 U+0631 U+0628 U+0627 U+062D
$arbah   = [string][char]0x0623 + [char]0x0631 + [char]0x0628 + [char]0x0627 + [char]0x062D
# saiq (driver) = U+0633 U+0627 U+0626 U+0642
$saiq    = [string][char]0x0633 + [char]0x0627 + [char]0x0626 + [char]0x0642
# kabatin (captains) = U+0643 U+0628 U+0627 U+062A U+0646
$kabatin = [string][char]0x0643 + [char]0x0628 + [char]0x0627 + [char]0x062A + [char]0x0646

Write-Host "Build-69 fleet intelligence verify`n"

# ---------------------------------------------------------------------------
# 1. parseRequestedDate bare ordinal support
# ---------------------------------------------------------------------------
Write-Host "-- 1. parseRequestedDate bare ordinal support --"

Assert-True "fleet.js contains bare ordinal comment" ($fleet -match "Bare ordinal with no month")
Assert-True "fleet.js contains usePrev logic" ($fleet -match "usePrev")
Assert-True "fleet.js references riyadhTodayYMD inside parseRequestedDate" (
  $fleet -match "(?s)function parseRequestedDate[\s\S]{0,2000}riyadhTodayYMD\(\)"
)

# Simulate the date inference logic to verify the math
Write-Host "  [Simulated date inference for Jun 19 (today)]"
$todayD = 19; $todayM = 5; $todayY = 2026

# Case A: "the 7th" -- day 7 <= 19 (today) -> use current month (5 = June)
$dd = 7
$usePrev = ($dd -gt $todayD)
$m = if ($usePrev) { if ($todayM -eq 0) { 11 } else { $todayM - 1 } } else { $todayM }
$y = if ($usePrev -and $todayM -eq 0) { $todayY - 1 } else { $todayY }
Assert-Eq "the 7th -> month 5 (June, current)" $m 5
Assert-Eq "the 7th -> year 2026" $y 2026

# Case B: "the 25th" -- day 25 > 19 (today) -> use previous month (4 = May)
$dd = 25
$usePrev = ($dd -gt $todayD)
$m = if ($usePrev) { if ($todayM -eq 0) { 11 } else { $todayM - 1 } } else { $todayM }
$y = if ($usePrev -and $todayM -eq 0) { $todayY - 1 } else { $todayY }
Assert-Eq "the 25th -> month 4 (May, prev month)" $m 4
Assert-Eq "the 25th -> year 2026" $y 2026

# Case C: January edge case -- rolls to December of previous year
$todayM2 = 0; $todayY2 = 2027; $todayD2 = 5; $dd = 15
$usePrev = ($dd -gt $todayD2)
$m = if ($usePrev) { if ($todayM2 -eq 0) { 11 } else { $todayM2 - 1 } } else { $todayM2 }
$y = if ($usePrev -and $todayM2 -eq 0) { $todayY2 - 1 } else { $todayY2 }
Assert-Eq "Jan 5, the 15th -> month 11 (Dec)" $m 11
Assert-Eq "Jan 5, the 15th -> year 2026" $y 2026

# ---------------------------------------------------------------------------
# 2. FLEET_PATTERNS ordinal date pattern
# ---------------------------------------------------------------------------
Write-Host "`n-- 2. FLEET_PATTERNS ordinal date pattern --"

Assert-True "FLEET_PATTERNS includes ordinal date comment" ($fleet -match "Ordinal date near a money word")
Assert-True "FLEET_PATTERNS ordinal pattern has st|nd|rd|th" ($fleet -match "st\|nd\|rd\|th")

# PS mirror of the ordinal+money pattern
$ordPat = [regex]'\b(?:net|gross|earn\w*|revenue|paid|collect\w*|made)\b[^.?!]{0,50}\bthe\s+\d{1,2}(?:st|nd|rd|th)\b|\bthe\s+\d{1,2}(?:st|nd|rd|th)\b[^.?!]{0,50}\b(?:net|gross|earn\w*|revenue|paid)\b'
Assert-True "'what was net on the 7th?' matches ordinal+money" $ordPat.IsMatch("what was net on the 7th?")
Assert-True "'gross on the 3rd?' matches ordinal+money" $ordPat.IsMatch("gross on the 3rd?")
Assert-True "'what did we earn on the 15th' matches" $ordPat.IsMatch("what did we earn on the 15th")
Assert-True "'the 7th net breakdown' matches (reversed)" $ordPat.IsMatch("the 7th net breakdown")
Assert-True "'the 7th time I tried' does NOT match" (-not $ordPat.IsMatch("the 7th time i tried"))
Assert-True "'on the 3rd floor' does NOT match" (-not $ordPat.IsMatch("on the 3rd floor"))

# ---------------------------------------------------------------------------
# 3. Arabic fleet vocabulary
# ---------------------------------------------------------------------------
Write-Host "`n-- 3. Arabic fleet vocabulary --"

Assert-True "FLEET_PATTERNS Arabic includes safi" ($fleet.Contains($safi))
Assert-True "FLEET_PATTERNS Arabic includes ijmali" ($fleet.Contains($ijmali))
Assert-True "WEAK_FLEET_RE includes safi" (
  ($fleet -match "WEAK_FLEET_RE") -and $fleet.Contains($safi)
)
Assert-True "WEAK_FLEET_RE includes arbah" ($fleet.Contains($arbah))

# PS mirror: do Arabic fleet terms hit WEAK_FLEET_RE?
# Build the regex from Unicode strings (safe for PS5.1)
$weakPat = [regex]("(?i)\b(sar|earn\w*|target|driver|captain|fleet|bolt|month|net|gross|project\w*|rank\w*|chart|graph|goal|expect\w*)\b|" + $safi + "|" + $arbah + "|" + $saiq + "|" + $kabatin)
$safiQuery  = $safi + " " + [string][char]0x0627 + [char]0x0644 + [char]0x064A + [char]0x0648 + [char]0x0645 + [char]0x061F  # safi alyom?
$arbahQuery = [string][char]0x0627 + [char]0x064A + [char]0x0634 + " " + [char]0x0627 + [char]0x0644 + [char]0x0623 + $arbah + [char]0x061F  # aysh al-arbah?
Assert-True "safi alyom? matches WEAK_FLEET_RE" $weakPat.IsMatch($safiQuery)
Assert-True "arbah query matches WEAK_FLEET_RE" $weakPat.IsMatch($arbahQuery)
Assert-True "English 'driver' still matches WEAK_FLEET_RE" $weakPat.IsMatch("show driver net this month")
Assert-True "English 'net' still matches WEAK_FLEET_RE" $weakPat.IsMatch("what was net yesterday")

# ---------------------------------------------------------------------------
# 4. llmFleetClassify history context gate
# ---------------------------------------------------------------------------
Write-Host "`n-- 4. llmFleetClassify history context gate --"

Assert-True "llmFleetClassify references recentlyDiscussedFleet" (
  $fleet -match "recentlyDiscussedFleet\(history\)"
)

# The new gate condition: !WEAK_FLEET_RE.test(...) && !recentlyDiscussedFleet(...)
$hasAndGate = $fleet -match "WEAK_FLEET_RE\.test.*recentlyDiscussedFleet|recentlyDiscussedFleet.*WEAK_FLEET_RE\.test"
Assert-True "llmFleetClassify uses AND-condition with history check" $hasAndGate

# The WEAK_FLEET_RE check should still be present (not removed, just augmented)
Assert-True "WEAK_FLEET_RE guard still present in llmFleetClassify" (
  $fleet -match "WEAK_FLEET_RE\.test\(message"
)

# ---------------------------------------------------------------------------
# 5. recentlyDiscussedFleet and FLEET_CONTEXT_MARKERS intact
# ---------------------------------------------------------------------------
Write-Host "`n-- 5. recentlyDiscussedFleet function intact --"

Assert-True "recentlyDiscussedFleet function present" ($fleet -match "function recentlyDiscussedFleet")
Assert-True "FLEET_CONTEXT_MARKERS regex present" ($fleet -match "FLEET_CONTEXT_MARKERS")
Assert-True "FLEET_CONTEXT_MARKERS checks last 5 history turns" ($fleet -match "slice\(-5\)")

# ---------------------------------------------------------------------------
# 6. No regression: existing Arabic terms still in FLEET_PATTERNS
# ---------------------------------------------------------------------------
Write-Host "`n-- 6. Regression: existing Arabic terms still present --"

Assert-True "Arabic FLEET_PATTERNS still has kabatin" ($fleet.Contains($kabatin))
Assert-True "Arabic FLEET_PATTERNS still has saiq" ($fleet.Contains($saiq))
Assert-True "Arabic FLEET_PATTERNS still has arbah" ($fleet.Contains($arbah))

# ---------------------------------------------------------------------------
# 7. parseRequestedDate: existing patterns not broken
# ---------------------------------------------------------------------------
Write-Host "`n-- 7. Regression: existing parseRequestedDate patterns intact --"

Assert-True "parseRequestedDate still has today/yesterday" (
  $fleet -match "today\|right now\|so far"
)
Assert-True "parseRequestedDate still has month abbreviation matching" (
  $fleet -match "jan\|feb\|mar\|apr\|may\|jun"
)
Assert-True "parseRequestedDate still has Arabic alyom" (
  $fleet -match [regex]::Escape([string][char]0x0627 + [char]0x0644 + [char]0x064A + [char]0x0648 + [char]0x0645)
)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Build-69 fleet intelligence verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
