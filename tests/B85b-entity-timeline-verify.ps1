# Build-85b: Entity Timeline — offline verification
# Tests: migration SQL, entity-graph.js changes, orchestrator.js Build-85b block
# Run from M8/: pwsh tests/B85b-entity-timeline-verify.ps1

$ErrorActionPreference = "Stop"
$pass = 0; $fail = 0

function Assert-True($label, $cond) {
  if ($cond) { Write-Host "  [PASS] $label" -ForegroundColor Green; $script:pass++ }
  else        { Write-Host "  [FAIL] $label" -ForegroundColor Red;   $script:fail++ }
}

$root    = Split-Path $PSScriptRoot -Parent
$egPath  = [IO.Path]::GetFullPath((Join-Path $root "lib\entity-graph.js"))
$orchPath= [IO.Path]::GetFullPath((Join-Path $root "lib\orchestrator.js"))
$migPath = [IO.Path]::GetFullPath((Join-Path $root "migrations\B85b_entity_timeline.sql"))
$ltPath  = [IO.Path]::GetFullPath((Join-Path $root "tests\B85b_LIVE_TEST.md"))

$eg   = if (Test-Path $egPath)   { [IO.File]::ReadAllText($egPath)   } else { "" }
$orch = if (Test-Path $orchPath) { [IO.File]::ReadAllText($orchPath) } else { "" }
$mig  = if (Test-Path $migPath)  { [IO.File]::ReadAllText($migPath)  } else { "" }
$lt   = if (Test-Path $ltPath)   { [IO.File]::ReadAllText($ltPath)   } else { "" }

# ── 1. Migration ──────────────────────────────────────────────────────────────
Write-Host "`n-- 1. Migration: B85b_entity_timeline.sql --"
Assert-True "migration file exists"                           (Test-Path $migPath)
Assert-True "targets m8_entity_mentions table"                ($mig -match "m8_entity_mentions")
Assert-True "adds summary column"                             ($mig -match "ADD COLUMN IF NOT EXISTS summary")
Assert-True "column is text type"                             ($mig -match "summary\s+text")
Assert-True "idempotent (IF NOT EXISTS)"                      ($mig -match "IF NOT EXISTS")
Assert-True "has COMMENT explaining Build-85b"                ($mig -match "Build-85b")

# ── 2. entity-graph.js — exports ─────────────────────────────────────────────
Write-Host "`n-- 2. entity-graph.js exports --"
Assert-True "entity-graph.js exists"                          (Test-Path $egPath)
Assert-True "_maybeExtractEntities exported"                  ($eg -match "_maybeExtractEntities")
Assert-True "recallEntities exported"                         ($eg -match "recallEntities")
Assert-True "getEntityCard exported (Build-85b)"              ($eg -match "getEntityCard")
Assert-True "module.exports includes getEntityCard"           ($eg -match "module\.exports\s*=\s*\{[^}]*getEntityCard")

# ── 3. summarizeEntityContext — fire-and-forget ───────────────────────────────
Write-Host "`n-- 3. summarizeEntityContext: fire-and-forget summarizer --"
Assert-True "summarizeEntityContext function defined"          ($eg -match "async function summarizeEntityContext")
Assert-True "uses gemini-2.0-flash-lite model"                ($eg -match "gemini-2\.0-flash-lite")
Assert-True "maxOutputTokens capped at 60"                    ($eg -match "maxOutputTokens.*60|60.*maxOutputTokens")
Assert-True "updates m8_entity_mentions with summary"         ($eg -match "m8_entity_mentions.*update.*summary|update.*summary.*m8_entity_mentions")
Assert-True "wrapped in catch so never throws"                ($eg -match "summarizeEntityContext[^}]*\.catch\(\(\)\s*=>\s*\{\}\)")

# ── 4. upsertEntity — captures mention ID ────────────────────────────────────
Write-Host "`n-- 4. upsertEntity: mention ID captured for summarizer --"
Assert-True "insert mention selects id"                       ($eg -match '\.select\("id"\)\.single\(\)')
Assert-True "fires summarizeEntityContext off-thread"         ($eg -match "summarizeEntityContext\(db,\s*mention")
Assert-True "fire-and-forget with .catch"                     ($eg -match "summarizeEntityContext.*\.catch\(\(\)\s*=>\s*\{\}\)")

# ── 5. recallEntities — arc summaries ────────────────────────────────────────
Write-Host "`n-- 5. recallEntities: arc in output --"
Assert-True "selects id from m8_entities"                     ($eg -match "select.*\`"id,.*entity_type|`"id, name")
Assert-True "batch fetches m8_entity_mentions for arc"        ($eg -match "m8_entity_mentions" -and $eg -match "\.in\(`"entity_id`",\s*hitIds\)")
Assert-True "filters non-null summaries"                      ($eg -match "not.*summary.*is.*null")
Assert-True "limits arc to 3 per entity"                      ($eg -match "arcMap\[m\.entity_id\]\.length.*<\s*3")
Assert-True "arc injected into recall output"                 ($eg -match "arcStr.*Arc:|Arc:.*arcStr")

# ── 6. getEntityCard — full timeline ─────────────────────────────────────────
Write-Host "`n-- 6. getEntityCard: full entity card --"
Assert-True "getEntityCard function defined"                   ($eg -match "async function getEntityCard")
Assert-True "queries m8_entities by name (ilike)"             ($eg -match "ilike.*name.*trim|\.ilike\(`"name`"")
Assert-True "fetches all mention summaries (limit 20)"        ($eg -match "limit\(20\)")
Assert-True "formats session arc newest-first"                ($eg -match "ascending.*false")
Assert-True "falls back to recallEntities if no summaries"    ($eg -match "recallEntities.*name.*1|Fallback")
Assert-True "returns null if entity not found"                ($eg -match "if.*!entity.*return null")

# ── 7. orchestrator.js — Build-85b block ─────────────────────────────────────
Write-Host "`n-- 7. orchestrator.js: Build-85b block --"
Assert-True "Build-85b START marker present"                  ($orch -match "Build-85b START")
Assert-True "Build-85b END marker present"                    ($orch -match "Build-85b END")
Assert-True "ENTITY_CARD_QUERY_RE defined"                    ($orch -match "ENTITY_CARD_QUERY_RE")
Assert-True "detects 'tell me about' pattern"                 ($orch -match "tell\\s\+me\\s\+about")
Assert-True "detects 'who is/was' pattern"                    ($orch.Contains('who\s+(?:is|was|are)'))
Assert-True "calls getEntityCard"                             ($orch -match "getEntityCard")
Assert-True "injects ENTITY CARD block into systemInstruction"($orch -match "ENTITY CARD")
Assert-True "uses log\(\) for observability"                  ($orch -match "entity_card_injected")

# ── 8. Live test file ─────────────────────────────────────────────────────────
Write-Host "`n-- 8. Live test file --"
Assert-True "B85b_LIVE_TEST.md exists"                        (Test-Path $ltPath)
Assert-True "contains 'who is' test"                          ($lt -match "who is")
Assert-True "contains 'tell me about' test"                   ($lt -match "tell me about")
Assert-True "mentions arc / timeline / session"               ($lt -match "arc|timeline|session")

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
$color = if ($fail -eq 0) { "Green" } else { "Yellow" }
Write-Host "Result: $pass passed, $fail failed" -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
