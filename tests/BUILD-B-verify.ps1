# Build-B (Lean lane) — PowerShell mirror (host has no Node).
# Asserts B1 (warm-checker retry) + B2 (bounded second-chance repair) wiring, the
# safety rails, and that it does NOT collide with the parallel Brain-CPR session.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Ok($cond, $msg) {
  if ($cond) { $script:pass++; Write-Host "  PASS: $msg" -ForegroundColor Green }
  else       { $script:fail++; Write-Host "  FAIL: $msg" -ForegroundColor Red }
}
function Slurp($rel) { [IO.File]::ReadAllText((Join-Path $root $rel)) }

$loop = Slurp 'lib/loop.js'
$dag  = Slurp 'lib/lemma-dag.js'

Write-Host "`n-- B1: warm the Lean checker (loop.js) --" -ForegroundColor Cyan
Ok ($loop.Contains('LEAN_WARM_TRIES'))                  'reads LEAN_WARM_TRIES'
Ok ($loop.Contains('for (let i = 0; i < tries'))        'pings in a bounded retry loop'
Ok ($loop.Contains('health.ready) break'))              'returns the moment it is ready'
Ok ($loop.Contains('LEAN_WARM_WAIT_MS'))                'waits between pings'

Write-Host "`n-- B2: second-chance repair wiring (loop.js) --" -ForegroundColor Cyan
Ok ($loop.Contains('fetchRepairableScaffold'))          'fetches a repairable scaffold'
Ok ($loop.Contains('repairScaffold(rrow'))              'runs repairScaffold on it'
Ok ($loop.Contains('repairCap: 1'))                     'caps at one leaf per run'
Ok ($loop.Contains('M4_REPAIR_BUDGET_MS'))              'time-budgets the repair'
Ok ($loop.Contains('l5_verify_repair'))                 'logs the repair attempt'
Ok ($loop.Contains('l5_repair_outcome_error'))          'records outcome on a newly-verified leaf'

Write-Host "`n-- B2: engine + safety rails (lemma-dag.js) --" -ForegroundColor Cyan
Ok ($dag.Contains('async function fetchRepairableScaffold')) 'defines fetchRepairableScaffold'
Ok ($dag.Contains('async function repairScaffold'))          'defines repairScaffold'
Ok ($dag.Contains('REPAIRABLE = new Set(["lean_rejected"])')) 'only retries genuine lean_rejected'
Ok ($dag.Contains('M4_REPAIR_DISABLED'))                     'has a kill switch'
Ok ($dag.Contains('MAX_SECOND_CHANCES'))                     'bounds retries per leaf'
Ok ($dag.Contains('second_chance: l.second_chance || 0'))    'persists the second-chance counter (upsert)'
Ok ($dag.Contains('l.second_chance = (l.second_chance || 0) + 1')) 'bumps the counter up-front'
Ok ($dag.Contains('Date.now() >= deadlineMs'))               'has a time-budget guard'
Ok ($dag.Contains('=== "lean_verified" || r.lean_status === "lean_stated"')) 'only accepts an improvement (never downgrades)'
Ok ($dag.Contains('fetchRepairableScaffold, repairScaffold'))  'exports the new functions'

Write-Host "`n-- coordination guard (no overlap with Brain-CPR) --" -ForegroundColor Cyan
Ok (-not $loop.Contains('safePersist'))  'loop.js has no safePersist (CPR owns the write path)'
Ok (-not $dag.Contains('safePersist'))   'lemma-dag.js has no safePersist'

$col = 'Green'; if ($script:fail -gt 0) { $col = 'Red' }
Write-Host "`nRESULT: $($script:pass) passed, $($script:fail) failed" -ForegroundColor $col
if ($script:fail -gt 0) { exit 1 }
