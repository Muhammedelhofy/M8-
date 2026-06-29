# tests/build161_fleet_polish.test.ps1 -- Build-161 fleet polish ship gate.
# Two live bugs (2026-06-29):
#   A) "how many drivers >4000 net" miscounted (15 -> 13) -- LLM hand-counted the list.
#   B) "write me a report on fleet performance" didn't auto-pull fleet data (re-ask needed).
# Fix A: route threshold-COUNT questions to renderPaceToTargetPacket, which now states a
#        DETERMINISTIC above/below COUNT line ("use THESE exact counts; do not recount").
# Fix B: FLEET_REPORT_RE also matches report/summary BEFORE fleet/drivers + "fleet performance".
# PS-5.1: ASCII-only; -match is case-insensitive (mirrors /i). Static checks read the source.

$pass = 0; $fail = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }

$reportSrc = Get-Content -Raw (Join-Path $PSScriptRoot "..\lib\fleet-report.js")
$fleetSrc  = Get-Content -Raw (Join-Path $PSScriptRoot "..\lib\fleet.js")

# ---------------------------------------------------------------------------
# 1. STATIC source guards (regression catch)
# ---------------------------------------------------------------------------
Write-Host "`n-- Static source guards --" -ForegroundColor Cyan
CheckTrue "FLEET_REPORT_RE broadened with 'performance'" ($reportSrc -match "fleet\.\*\(report\|health\|status\|performance")
CheckTrue "FLEET_REPORT_RE has report-before-fleet branch" ($reportSrc.Contains('(report|overview|summary|recap|breakdown|performance)\b.*\b(fleet|drivers?'))
CheckTrue "PACE_TARGET has above-threshold count pattern" ($fleetSrc.Contains('above|over|more\s+than|at\s+least|exceed'))
CheckTrue "PACE_TARGET has below-threshold count pattern" ($fleetSrc.Contains('below|under|less\s+than|fewer\s+than|beneath'))
CheckTrue "PACE_TARGET has 'how many' count pattern" ($fleetSrc.Contains('\bhow\s+many\b'))
CheckTrue "renderPaceToTargetPacket computes 'below'" ($fleetSrc.Contains('const below  = r.rankings.filter((d) => d.net < target)'))
CheckTrue "pace packet has explicit COUNT line" ($fleetSrc.Contains('do not recount the list'))

# ---------------------------------------------------------------------------
# 2. Behavioral mirror -- FLEET_REPORT_RE (Fix B)
# ---------------------------------------------------------------------------
Write-Host "`n-- detectFleetReportQuery mirror (Fix B) --" -ForegroundColor Cyan
$ReportRE = 'how.*(fleet|drivers?)|who.*(top|bottom|perform|behind|ahead|attention)|fleet.*(report|health|status|performance|overview|summary|recap|breakdown)|\b(report|overview|summary|recap|breakdown|performance)\b.*\b(fleet|drivers?|captains?|couriers?|riders?)\b'
function IsReport([string]$m) { return ($m -match $ReportRE) }
CheckTrue  "report on fleet performance"        (IsReport "write me a report on fleet performance")
CheckTrue  "fleet performance report"           (IsReport "give me the fleet performance report")
CheckTrue  "summary of the drivers"             (IsReport "summary of the drivers this month")
CheckTrue  "OLD: how did the fleet do"          (IsReport "how did the fleet do")
CheckTrue  "OLD: who is the top performer"      (IsReport "who is the top performer")
CheckTrue  "OLD: fleet health"                  (IsReport "show me fleet health")
CheckFalse "non-fleet: write me a poem"         (IsReport "write me a poem about the sea")
CheckFalse "non-fleet: summary of the news"     (IsReport "give me a summary of the news")

# ---------------------------------------------------------------------------
# 3. Behavioral mirror -- threshold COUNT routing (Fix A)
# ---------------------------------------------------------------------------
Write-Host "`n-- pace/count routing mirror (Fix A) --" -ForegroundColor Cyan
$AboveRE = '\bdrivers?\b[^.?!]{0,40}\b(above|over|more\s+than|at\s+least|exceed\w*|greater\s+than)\b[^.?!]{0,15}\b\d{3,7}\b'
$BelowRE = '\bdrivers?\b[^.?!]{0,40}\b(below|under|less\s+than|fewer\s+than|beneath)\b[^.?!]{0,15}\b\d{3,7}\b'
$HowManyRE = '\bhow\s+many\b[^.?!]{0,40}\b(above|over|more\s+than|below|under|less\s+than|hit|reach|made|earn\w*)\b[^.?!]{0,15}\b\d{3,7}\b'
function IsCount([string]$m) { return (($m -match $AboveRE) -or ($m -match $BelowRE) -or ($m -match $HowManyRE)) }
CheckTrue  "how many drivers above 4000"        (IsCount "how many drivers above 4000")
CheckTrue  "drivers over 5000 net"              (IsCount "which drivers over 5000 net")
CheckTrue  "how many made more than 4000"       (IsCount "how many drivers made more than 4000")
CheckTrue  "how many drivers below 4000"        (IsCount "how many drivers below 4000")
CheckTrue  "drivers under 3000"                 (IsCount "show drivers under 3000")
CheckFalse "no number -> not a count route"     (IsCount "how many drivers do we have")
CheckFalse "non-fleet count"                    (IsCount "how many days above 30 degrees")

# ---------------------------------------------------------------------------
# 4. Count logic mirror -- deterministic above/below (Fix A core)
# ---------------------------------------------------------------------------
Write-Host "`n-- deterministic count mirror --" -ForegroundColor Cyan
function CountAboveBelow([double[]]$nets, [double]$target) {
  $hit = 0; $below = 0
  foreach ($n in $nets) { if ($n -ge $target) { $hit++ } else { $below++ } }
  return [pscustomobject]@{ hit=$hit; below=$below; total=$nets.Count }
}
$nets = @(4500, 4000, 3999, 6000, 100, 4001, 2000)
$c = CountAboveBelow $nets 4000
CheckTrue "above 4000 count = 4" ($c.hit -eq 4)      # 4500,4000,6000,4001
CheckTrue "below 4000 count = 3" ($c.below -eq 3)     # 3999,100,2000
CheckTrue "total = 7"            ($c.total -eq 7)
CheckTrue "hit+below == total"   (($c.hit + $c.below) -eq $c.total)

Write-Host "`n================ B-161 FLEET-POLISH RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
