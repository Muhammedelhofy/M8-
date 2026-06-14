# tests/odysseus/nightly-attest.ps1
# L5 promotion-gate nightly attestation. Invoked by the Windows scheduled task
# M8-L5-Nightly-Attest (daily 05:00 AST = 02:00 UTC, ~1h after the loop cron).
#
# Runs the COMBINED L5 probe set live against the deployed app:
#   * battery-l5.json      under session prefix 'l5'       (autonomy family, od2L5.*)
#   * battery-m3-armed.json under session prefix 'm3armed'  (generation/novelty, od2arm.*)
# accumulates BOTH into one pass-map, diffs it vs baseline-L5.json, and POSTs a
# SINGLE attestation to /api/loop-attest for the current UTC date. That date equals
# the loop's run_date: lib/loop.js records todayUTC(), and this 02:00-UTC run falls
# on the same UTC day as the 01:00-UTC loop cron.
#
# CRON_SECRET is read from the user env var by run-battery.ps1's -Secret default.
#
# WHY A WRAPPER: run-battery.ps1 -AttestTo posts one attestation per invocation, so
# attesting against baseline-L5.json (which spans BOTH corpora) requires a single
# run that covers both -- hence the comma-list -File / -SessionPrefix (Build-35).
# The prior stub called `run-battery.ps1 -AttestTo` with no date (crash) and no
# corpus (would have attested the wrong default battery.json vs baseline-L5.json).
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\m7ofy\OneDrive\Documents\Claude\Projects\Bolt\M8'

$runDate = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
Write-Host "M8 L5 nightly attest -> run_date $runDate (UTC)"

.\tests\odysseus\run-battery.ps1 `
  -File         'battery-l5.json,battery-m3-armed.json' `
  -SessionPrefix 'l5,m3armed' `
  -AttestTo      $runDate
