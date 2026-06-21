# BRAINCPR-verify.ps1 - Build-110 "Brain CPR" PS-mirror / static-review test
#
# The host has NO Node - so this is a STATIC assertion suite over the changed
# source files. It proves the wiring is in place; the REAL proof (rows landing)
# comes from BRAINCPR_LIVE_TEST.md after Muhammad deploys.
#
# Asserts:
#   1. lib/persistence.js exists, exports safePersist, requires @vercel/functions,
#      wraps with waitUntil, has an await fallback, never throws, logs "+1".
#   2. Each of the 4 dead writers now routes through safePersist / await - and no
#      bare fire-and-forget write remains at any of the 4 sites.
#   3. @vercel/functions is declared in package.json.
#   4. The reflector scope guard (orchestrator) still excludes compute/lean/fleet.
#
# NOTE (PS 5.1): all needles are SINGLE-quoted (fully literal) and the file is
# ASCII-only, so braces/parens inside needles are never mis-parsed as blocks.
#
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\BRAINCPR-verify.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # ...\M8

$script:pass = 0
$script:fail = 0
$script:fails = @()

function Check([string]$name, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host ("  [PASS] " + $name) -ForegroundColor Green }
  else       { $script:fail++; $script:fails += $name; Write-Host ("  [FAIL] " + $name) -ForegroundColor Red }
}

# OneDrive can intermittently fail a read - retry a few times (ps-test-mirror-gotchas).
function Read-Text([string]$rel) {
  $p = Join-Path $root $rel
  for ($i = 0; $i -lt 5; $i++) {
    try { return [System.IO.File]::ReadAllText($p) } catch { Start-Sleep -Milliseconds 150 }
  }
  throw "could not read $rel"
}

# Count case-sensitive literal occurrences of $needle in $text.
function CountOf([string]$text, [string]$needle) {
  return [regex]::Matches($text, [regex]::Escape($needle)).Count
}
function Has([string]$text, [string]$needle)   { return $text.Contains($needle) }
function Lacks([string]$text, [string]$needle) { return -not $text.Contains($needle) }

Write-Host "`n=== Build-110 Brain CPR - static mirror ===`n"

# -- 1. lib/persistence.js ----------------------------------------------------
Write-Host "lib/persistence.js"
Check "persistence.js exists" (Test-Path (Join-Path $root 'lib\persistence.js'))
$persist = Read-Text 'lib\persistence.js'
Check "exports safePersist"                   (Has $persist 'module.exports = { safePersist')
Check "defines safePersist(promise, label)"   (Has $persist 'function safePersist(promise, label)')
Check "requires @vercel/functions"            (Has $persist 'require("@vercel/functions")')
Check "uses waitUntil"                         (Has $persist 'waitUntil')
Check "calls the resolved waitUntil"           (Has $persist '_waitUntil(wrapped)')
Check "guards require in try/catch x2"         ((CountOf $persist 'try {') -ge 2)
Check "waitUntil call is wrapped (no-ctx safe)" (Has $persist 'if (_waitUntil) {')
Check "await fallback: returns wrapped promise" (Has $persist 'return wrapped')
Check "never throws: wrapped promise has .catch" (Has $persist '.catch((err)')
Check "instrumentation: logs +1 on success"     (Has $persist ' +1')
Check "logs Supabase {error} on failure"        (Has $persist 'res.error')

# -- 2a. Reflector (m8_reflections) -------------------------------------------
Write-Host "`nlib/reflector.js  (m8_reflections)"
$refl = Read-Text 'lib\reflector.js'
Check "requires ./persistence"                 (Has $refl 'require("./persistence")')
Check "logReflection routes through safePersist reflect" `
      (Has $refl 'safePersist(db.from("m8_reflections").insert(row), "reflect")')
Check "logReflection RETURNS the safePersist promise (awaitable)" `
      (Has $refl 'return safePersist(db.from("m8_reflections")')
Check "reflect() AWAITS logReflection (lands before freeze)" `
      (Has $refl 'await logReflection(')
Check "no bare fire-and-forget Promise.resolve insert remains" `
      (Lacks $refl 'Promise.resolve(db.from("m8_reflections").insert(row))')

# -- 2b. Reasoning chains (m8_reasoning_chains) -------------------------------
Write-Host "`nlib/reasoning-chain.js  (m8_reasoning_chains)"
$chain = Read-Text 'lib\reasoning-chain.js'
Check "requires ./persistence"                 (Has $chain 'require("./persistence")')
Check "logChain calls safePersist"             (Has $chain 'safePersist(')
Check "logChain uses the chain label"          (Has $chain '"chain"')
Check "safePersist wraps the m8_reasoning_chains insert" `
      (Has $chain '.from("m8_reasoning_chains")')
Check "logChain RETURNS the safePersist promise (awaitable)" `
      (Has $chain 'return safePersist(')
Check "runChain() AWAITS logChain (lands before freeze)" `
      (Has $chain 'await logChain(')
Check "no bare un-awaited .then write remains" `
      (Lacks $chain '.then(({ error }) => { if (error) console.error("[M8] logChain insert error')

# -- 2c. Entity store (m8_entities / m8_entity_mentions) — MOVED to nightly cron ---
Write-Host "`nlib/memory.js + api/cron-summarize.js  (entity store, cron-extracted)"
$mem = Read-Text 'lib\memory.js'
Check "entity extractor routed through llm.js generate (not dead direct Gemini)" `
      (Has (Read-Text 'lib\entity-graph.js') 'providerOrder: ENTITY_ORDER')
Check "saveMemory NO LONGER extracts entities inline (zero per-turn latency)" `
      (Lacks $mem 'safePersist(require("./entity-graph")._maybeExtractEntities')
Check "sweepEntityExtraction() defined" `
      (Has $mem 'async function sweepEntityExtraction')
Check "sweepEntityExtraction uses a watermark (m8_entity_cron_state)" `
      (Has $mem 'm8_entity_cron_state')
Check "sweep AWAITS the per-message extraction (cron handler is awaited)" `
      (Has $mem 'await _maybeExtractEntities(m.session_id')
Check "sweepEntityExtraction exported" `
      (Has $mem 'sweepEntityExtraction,')
$cron = Read-Text 'api\cron-summarize.js'
Check "cron-summarize calls the entity sweep" `
      (Has $cron 'await sweepEntityExtraction()')
Check "entity sweep is fail-safe + kill-switchable (ENTITY_SWEEP_DISABLED)" `
      (Has $cron 'ENTITY_SWEEP_DISABLED')

# -- 2d. Conjecture loop (m8_conjecture_outcomes) -----------------------------
Write-Host "`nlib/conjecture-memory.js + lib/loop.js  (m8_conjecture_outcomes)"
$cmem = Read-Text 'lib\conjecture-memory.js'
Check "recordOutcome returns awaitable promise (success path)" (Has $cmem 'return p')
Check "recordOutcome returns Promise.resolve() fallback"       (Has $cmem 'return Promise.resolve();')
Check "recordOutcome logs +1 on success"                       (Has $cmem '[persist:conjecture-outcome] +1')
Check "recordOutcome still never rejects (.catch on chain)"    (Has $cmem '.catch((e) => console.error')

$loop = Read-Text 'lib\loop.js'
$awaited = CountOf $loop 'await recordOutcome(getClient()'
$total   = CountOf $loop 'recordOutcome(getClient()'
# >=2 (Brain CPR added 2; a parallel Build-B repair path may add more) — the
# load-bearing invariant is that EVERY recordOutcome cron write is awaited.
Check "loop.js: recordOutcome cron writes are awaited (>=2)"      ($awaited -ge 2)
Check "loop.js: NO un-awaited recordOutcome(getClient() remains"  ($total -eq $awaited)
Check "loop.js: comment notes outcomes stay near-0 until leaves"  (Has $loop 'stays near-0 until')

# -- 3. package.json dependency -----------------------------------------------
Write-Host "`npackage.json"
$pkg = Read-Text 'package.json'
Check "declares @vercel/functions dependency" (Has $pkg '"@vercel/functions"')

# -- 4. Reflector scope guard (orchestrator) ----------------------------------
Write-Host "`nlib/orchestrator.js  (reflector scope guard - must NOT touch engine/compute/fleet)"
$orch = Read-Text 'lib\orchestrator.js'
Check "reflectEligible gate exists"                        (Has $orch 'reflectEligible')
Check "scope guard excludes compute turns"                 (Has $orch '!computeMode')
Check "scope guard excludes lean (math) turns"             (Has $orch '!leanMode')
Check "scope guard excludes fleet turns"                   (Has $orch '!fleetCtx.text')
Check "scope guard excludes finance turns"                 (Has $orch '!financeCtx.text')
Check "reflect() only called when reflectEligible is true" (Has $orch 'if (reflectEligible) {')

# -- Summary ------------------------------------------------------------------
Write-Host "`n=== RESULT ==="
Write-Host ("PASS: " + $script:pass)
Write-Host ("FAIL: " + $script:fail)
if ($script:fail -gt 0) {
  Write-Host "`nFailures:" -ForegroundColor Red
  $script:fails | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  exit 1
}
Write-Host "`nALL GREEN - Brain CPR wiring verified (static). Live proof = rows post-deploy." -ForegroundColor Green
exit 0
