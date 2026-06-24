# Build-133 - "this week" -> weekly rollup (not the month-to-date intelligence report).
# PS 5.1 mirror of isWeekRangeQuery() (lib/fleet.js) + the SLOT 3e gate decision
# (detectFleetReportQuery && !isWeekRangeQuery) in lib/orchestrator.js. Node is absent;
# the real test is live on m8-alpha. Asserts the routing DECISION, not the rollup output.
$ErrorActionPreference = 'Stop'
$opt = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
function RX([string]$s, [string]$p) { return [regex]::IsMatch($s, $p, $opt) }

# isWeekRangeQuery() mirror (WEEK_RANGE_RE). "this month" is deliberately EXCLUDED.
$WEEK = '\b(this|last|past|current)\s+week\b|\blast\s+\d{1,2}\s+days?\b|\bweekly\b'
function Test-Week([string]$m) { return RX $m $WEEK }

# detectFleetReportQuery() mirror (FLEET_REPORT_RE, lib/fleet-report.js).
$REPORT = 'how.*(fleet|drivers?)|who.*(top|bottom|perform|behind|ahead|attention)|fleet.*(report|health|status)'
function Test-Report([string]$m) { return RX $m $REPORT }

# The MTD intelligence report fires only when it matches AND it is NOT an explicit week
# range. reportFires=$false => the deterministic weekly rollup is preserved (the fix).
function Report-Fires([string]$m) { return (Test-Report $m) -and (-not (Test-Week $m)) }

$weekCases = @(
  @{ m = 'this week';                     want = $true  }
  @{ m = 'last week';                     want = $true  }
  @{ m = 'last 7 days';                   want = $true  }
  @{ m = 'last 10 days';                  want = $true  }
  @{ m = 'weekly';                        want = $true  }
  @{ m = 'this month';                    want = $false }
  @{ m = "show me this month's rankings"; want = $false }
  @{ m = 'how is my fleet doing';         want = $false }
  @{ m = 'what was net yesterday';        want = $false }
)

$reportCases = @(
  @{ m = 'how did the fleet do this week';      want = $false }  # the bug: was firing the MTD report
  @{ m = 'how do the fleet do this week';       want = $false }
  @{ m = 'how did the fleet do last week';      want = $false }
  @{ m = 'fleet earnings last 7 days';          want = $false }  # week range -> rollup
  @{ m = 'how is my fleet doing';               want = $true  }  # no range -> MTD report (unchanged)
  @{ m = 'how are my drivers doing this month'; want = $true  }  # month -> MTD report (unchanged)
  @{ m = 'fleet health';                        want = $true  }  # report (unchanged)
  @{ m = 'who needs attention';                 want = $true  }  # report (unchanged)
  @{ m = "show me this month's rankings";       want = $false }  # report regex doesn't match -> rankings path
  @{ m = 'what was net yesterday';              want = $false }  # not a report query
)

$fail = 0
Write-Host '== Part 1: isWeekRangeQuery =='
foreach ($c in $weekCases) {
  $got = Test-Week $c.m
  if ($got -eq $c.want) { Write-Host ("PASS [week={0,-5}] {1}" -f $got, $c.m) }
  else { $fail++; Write-Host ("FAIL want={0} got={1} :: {2}" -f $c.want, $got, $c.m) }
}
Write-Host ''
Write-Host '== Part 2: MTD report fires? (false = weekly rollup preserved) =='
foreach ($c in $reportCases) {
  $got = Report-Fires $c.m
  if ($got -eq $c.want) { Write-Host ("PASS [reportFires={0,-5}] {1}" -f $got, $c.m) }
  else { $fail++; Write-Host ("FAIL want={0} got={1} :: {2}" -f $c.want, $got, $c.m) }
}

$total = $weekCases.Count + $reportCases.Count
Write-Host ''
if ($fail -eq 0) { Write-Host ("ALL {0} CASES PASSED" -f $total) }
else { Write-Host ("{0} FAILURE(S) of {1}" -f $fail, $total); exit 1 }
