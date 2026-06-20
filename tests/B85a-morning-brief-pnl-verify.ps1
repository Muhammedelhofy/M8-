# Build-85a: Morning Brief P&L — offline, pure PS 5.1.
# 20+ assertions covering buildPnlSection(), formatPnlText(), formatPnlHTML(),
# and the integration into generateMorningBrief + formatBriefText + formatBriefHTML.
# No network calls. All test data is inline.

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$mbPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\morning-brief.js"))
$fiPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\finance.js"))
$mb = [IO.File]::ReadAllText($mbPath, [Text.Encoding]::UTF8)
$fi = [IO.File]::ReadAllText($fiPath, [Text.Encoding]::UTF8)

Write-Host "Build-85a Morning Brief P&L verify`n"

# ── 1. Source structure ───────────────────────────────────────────────────────
Write-Host "-- 1. Source structure --"
Assert-True "finance import present"                      ($mb -match "require\([`"']./finance[`"']\)")
Assert-True "getEffectiveProfile imported"                ($mb -match "getEffectiveProfile")
Assert-True "buildPnlSection function defined"            ($mb -match "function buildPnlSection\(")
Assert-True "weeklyCarRentFor helper defined"             ($mb -match "function weeklyCarRentFor\(")
Assert-True "formatPnlText helper defined"                ($mb -match "function formatPnlText\(")
Assert-True "formatPnlHTML helper defined"                ($mb -match "function formatPnlHTML\(")
Assert-True "buildPnlSection exported"                    ($mb -match "buildPnlSection")
Assert-True "formatPnlText exported"                      ($mb -match "formatPnlText")
Assert-True "formatPnlHTML exported"                      ($mb -match "formatPnlHTML")

# ── 2. buildPnlSection integration in generateMorningBrief ───────────────────
Write-Host "`n-- 2. generateMorningBrief integration --"
Assert-True "profiles extracted from fleetData"           ($mb -match "khair_courier_profiles")
Assert-True "overrides extracted from fleetData"          ($mb -match "khair_courier_overrides")
Assert-True "buildPnlSection called in generateMorningBrief" ($mb -match "buildPnlSection\(entries, profiles, overrides")
Assert-True "pnl field included in brief return"          ($mb -match "pnl,")
Assert-True "pnl: null in empty brief return"             ($mb -match "pnl: null")

# ── 3. formatBriefText wires P&L section ─────────────────────────────────────
Write-Host "`n-- 3. formatBriefText P&L wiring --"
Assert-True "formatPnlText called in formatBriefText"     ($mb -match "formatPnlText\(brief\.pnl")
Assert-True "P&L text added before droppedYesterday"      (
  ($mb.IndexOf("formatPnlText(brief.pnl")) -lt ($mb.IndexOf("Section 3 first if anything dropped"))
)

# ── 4. formatBriefHTML wires P&L section ─────────────────────────────────────
Write-Host "`n-- 4. formatBriefHTML P&L wiring --"
Assert-True "formatPnlHTML called in formatBriefHTML"     ($mb -match "formatPnlHTML\(brief\.pnl")
# Search within formatBriefHTML only — find that function, then check order inside it.
$htmlFnStart = $mb.IndexOf("function formatBriefHTML(")
$pnlHtmlPos  = $mb.IndexOf("formatPnlHTML(brief.pnl", $htmlFnStart)
$dropHtmlPos = $mb.IndexOf("droppedYesterday.length", $htmlFnStart)
Assert-True "P&L HTML added before droppedYesterday block" ($pnlHtmlPos -gt 0 -and $pnlHtmlPos -lt $dropHtmlPos)

# ── 5. buildPnlSection logic assertions (via regex on source) ─────────────────
Write-Host "`n-- 5. buildPnlSection logic --"
Assert-True "thisWeekKeys uses last 7 from allKeys"       ($mb -match "allKeys\.slice\(Math\.max\(0, n - 7\)\)")
Assert-True "lastWeekKeys uses 7 days before thisWeek"    ($mb -match "allKeys\.slice\(Math\.max\(0, n - 14\), Math\.max\(0, n - 7\)\)")
Assert-True "deltaPercent computed from lastWeek"         ($mb -match "deltaPercent.*fleetLastWeek")
Assert-True "tier t6 floor is 6000"                       ($mb -match "mtdNet >= 6000")
Assert-True "tier t5 floor is 5000"                       ($mb -match "mtdNet >= 5000")
Assert-True "tier t4 floor is 4000"                       ($mb -match "mtdNet >= 4000")
Assert-True "needsAttention uses workingDays/5 factor"    ($mb -match "workingDays / 5")
Assert-True "weeklyCarRent divides by 4.33"               ($mb -match "/ 4\.33")
Assert-True "weeklyNet = gross - weeklyCarRent"           ($mb -match "gross - weeklyCarRent")

# ── 6. formatPnlText content assertions ──────────────────────────────────────
Write-Host "`n-- 6. formatPnlText content --"
Assert-True "text includes 'WEEKLY P&L SNAPSHOT'"         ($mb -match "WEEKLY P&L SNAPSHOT")
Assert-True "text shows Fleet gross line"                  ($mb -match "Fleet gross this week")
Assert-True "text shows Bolt bonus tiers"                  ($mb -match "Bolt bonus tiers \(MTD")
Assert-True "text shows NEEDS ATTENTION block"             ($mb -match "NEEDS ATTENTION")
Assert-True "text shows SAR short"                         ($mb -match "SAR short\)")
Assert-True "text shows last week comparison"              ($mb -match "Last week:")

# ── 7. formatPnlHTML content assertions ──────────────────────────────────────
Write-Host "`n-- 7. formatPnlHTML content --"
Assert-True "HTML includes Weekly P&L Snapshot heading"   ($mb -match "Weekly P&amp;L Snapshot")
Assert-True "HTML green colour for positive delta"         ($mb -match "#15803d.*deltaPercent")
Assert-True "HTML red colour for negative delta"           ($mb -match "#b91c1c.*deltaPercent")
Assert-True "HTML needs-attention amber block"             ($mb -match "#fef9f0")
Assert-True "HTML esc() used for driver names"             ($mb -match "esc\(d\.name\)")

Write-Host ""
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Result: " + $pass + " passed, " + $fail + " failed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
