# chart-verify.ps1 -- Build-31 Fleet Earnings Charts
# PowerShell mirror of lib/fleet.js chartRef/chartMetric/buildChartSpec and the
# lib/orchestrator.js appendChartMarker + js/chat.js M8_CHART_RE strip/parse.
# Pure ASCII.

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
function CheckEq([string]$name, $actual, $expected) {
  if ("$actual" -eq "$expected") { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got '$actual', expected '$expected')" -ForegroundColor Red }
}

# --- PS mirror of chartRef (lib/fleet.js) ---
function ChartRef([string]$message) {
  $s = $message.ToLower()
  if ($s -match '\b(chart|graph|plot|visuali[sz]e)\b') { return $true }
  if ($s -match '\b(bar|line|trend)\s*chart\b') { return $true }
  return $false
}

# --- PS mirror of chartMetric (lib/fleet.js) ---
function ChartMetric([string]$message) {
  $s = $message.ToLower()
  if ($s -match '\borders?\b') { return 'orders' }
  if ($s -match '\b(hours?|online)\b') { return 'hours' }
  if ($s -match '\bactive\b') { return 'active' }
  return 'net'
}

$CHART_METRIC_LABELS = @{
  net = 'Net earnings (SAR)'; orders = 'Orders'; hours = 'Online hours (h)'; active = 'Active drivers'
}

# --- PS mirror of buildChartSpec (lib/fleet.js) ---
function BuildChartSpec($r, [string]$message) {
  if (-not $r -or -not $r.dailyBreakdown -or $r.dailyBreakdown.Count -eq 0) { return $null }
  $metric = ChartMetric $message
  $label = $CHART_METRIC_LABELS[$metric]
  $labels = @($r.dailyBreakdown | ForEach-Object { $_.period -replace '\s20\d\d$', '' })
  $data = @($r.dailyBreakdown | ForEach-Object { $_.$metric })
  return [pscustomobject]@{
    type = 'bar'; title = "$label - $($r.label)"; labels = $labels; data = $data; datasetLabel = $label
  }
}

Write-Host "`n== chartRef: which phrasings trigger a chart ==" -ForegroundColor Cyan
CheckTrue "'show me a chart of earnings this week' -> true"        (ChartRef "show me a chart of earnings this week")
CheckTrue "'graph the fleet's earnings'-> true"                    (ChartRef "graph the fleet's earnings this week")
CheckTrue "'plot net earnings'-> true"                              (ChartRef "can you plot net earnings for the week")
CheckTrue "'visualize this week'-> true"                            (ChartRef "visualize this week's performance")
CheckTrue "'bar chart of orders'-> true"                            (ChartRef "bar chart of orders this week")
CheckTrue "plain rollup question -> false"                          (-not (ChartRef "how did the fleet do this week"))
CheckTrue "pace question -> false"                                  (-not (ChartRef "are we on track to beat last week"))

Write-Host "`n== chartMetric: which field gets charted ==" -ForegroundColor Cyan
CheckEq "default (no metric word) -> net"            (ChartMetric "chart this week")  'net'
CheckEq "'chart of orders' -> orders"                (ChartMetric "chart of orders this week")  'orders'
CheckEq "'chart of hours' -> hours"                  (ChartMetric "graph the online hours")  'hours'
CheckEq "'chart of active drivers' -> active"        (ChartMetric "plot active drivers per day")  'active'
CheckEq "net earnings explicitly -> net"             (ChartMetric "chart net earnings this week")  'net'

Write-Host "`n== buildChartSpec: code-computed spec from a rollup's dailyBreakdown ==" -ForegroundColor Cyan
$rollup = [pscustomobject]@{
  label = "this week"
  dailyBreakdown = @(
    [pscustomobject]@{ period = "8 Jun 2026"; net = 1200.5; orders = 40; active = 6; hours = 48.5 }
    [pscustomobject]@{ period = "9 Jun 2026"; net = 1340.0; orders = 44; active = 7; hours = 52.0 }
    [pscustomobject]@{ period = "10 Jun 2026"; net = 980.25; orders = 35; active = 5; hours = 41.2 }
  )
}
$spec = BuildChartSpec $rollup "show me a chart of earnings this week"
CheckEq "spec.type == bar"                  $spec.type 'bar'
CheckEq "spec.datasetLabel == Net earnings (SAR)" $spec.datasetLabel 'Net earnings (SAR)'
CheckTrue "spec.title includes range label"  ($spec.title -like "*this week*")
CheckEq "spec.labels[0] strips trailing year" $spec.labels[0] '8 Jun'
CheckEq "spec.labels.Count == 3"             $spec.labels.Count 3
CheckEq "spec.data[0] == net of day 1"       $spec.data[0] 1200.5
CheckEq "spec.data[2] == net of day 3"       $spec.data[2] 980.25

$specOrders = BuildChartSpec $rollup "bar chart of orders this week"
CheckEq "orders metric -> spec.datasetLabel == Orders" $specOrders.datasetLabel 'Orders'
CheckEq "orders metric -> spec.data[0] == 40"          $specOrders.data[0] 40

$emptyRollup = [pscustomobject]@{ label = "this month"; dailyBreakdown = $null }
CheckTrue "no dailyBreakdown -> buildChartSpec returns null" ((BuildChartSpec $emptyRollup "chart this month") -eq $null)

Write-Host "`n== appendChartMarker (lib/orchestrator.js): marker only on real chart requests ==" -ForegroundColor Cyan
$FALLBACK = "I'm having trouble connecting right now. Please try again in a moment."
function AppendChartMarker([string]$response, $chart) {
  if ($chart -and $response -ne $FALLBACK) {
    $json = $chart | ConvertTo-Json -Compress
    return "$response`n`n<!--M8-CHART:$json-->"
  }
  return $response
}
$withChart = AppendChartMarker "Net earnings this week: 3,520.75 SAR." $spec
CheckTrue "marker appended when fleetCtx.chart is set"   ($withChart -match '<!--M8-CHART:\{.*\}-->')
$noChart = AppendChartMarker "Net earnings this week: 3,520.75 SAR." $null
CheckTrue "no marker when fleetCtx.chart is null"        ($noChart -notmatch '<!--M8-CHART')
$fallbackWithChart = AppendChartMarker $FALLBACK $spec
CheckTrue "no marker appended to the fallback response"  ($fallbackWithChart -notmatch '<!--M8-CHART')

Write-Host "`n== js/chat.js M8_CHART_RE: strip marker from displayed text + parse JSON ==" -ForegroundColor Cyan
$M8_CHART_RE = '<!--M8-CHART:(\{[\s\S]*?\})-->'
$m = [regex]::Match($withChart, $M8_CHART_RE)
CheckTrue "marker regex matches the appended marker" $m.Success
$cleanText = ($withChart -replace $M8_CHART_RE, '').TrimEnd()
CheckEq "stripped text == original narration" $cleanText "Net earnings this week: 3,520.75 SAR."
$parsed = $m.Groups[1].Value | ConvertFrom-Json
CheckEq "parsed spec.type == bar"          $parsed.type 'bar'
CheckEq "parsed spec.data[0] == 1200.5"    $parsed.data[0] 1200.5
CheckTrue "no marker in plain (non-chart) reply -> regex does not match" (-not ([regex]::Match($noChart, $M8_CHART_RE).Success))

Write-Host "`n=================================================="
Write-Host "  fleet earnings charts (Build-31): $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
