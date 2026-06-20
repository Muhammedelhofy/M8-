# Build-83c: Entity Graph -- offline, pure PS 5.1 ASCII.
# Verifies:
#   1. entity-graph.js exists with correct exports
#   2. ENTITY_SYSTEM prompt has required type list
#   3. upsertEntity handles merge of attributes + mention_count
#   4. recallEntities filters by name substring match
#   5. _maybeExtractEntities wired into memory.js
#   6. recallEntities wired into orchestrator.js system instruction
#   7. Migration file exists with correct tables + indexes

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$egPath  = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\entity-graph.js"))
$memPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\memory.js"))
$orchPath= [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\orchestrator.js"))
$migPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\migrations\B83c_entity_graph.sql"))

$eg  = [IO.File]::ReadAllText($egPath,  [Text.Encoding]::UTF8)
$mem = [IO.File]::ReadAllText($memPath, [Text.Encoding]::UTF8)
$orch= [IO.File]::ReadAllText($orchPath,[Text.Encoding]::UTF8)
$mig = [IO.File]::ReadAllText($migPath, [Text.Encoding]::UTF8)

Write-Host "Build-83c entity graph verify`n"

# 1. File structure
Write-Host "-- 1. entity-graph.js structure --"
Assert-True "file exists"                        ([IO.File]::Exists($egPath))
Assert-True "_maybeExtractEntities exported"     ($eg -match "_maybeExtractEntities")
Assert-True "recallEntities exported"            ($eg -match "recallEntities")
Assert-True "upsertEntity defined"               ($eg -match "async function upsertEntity")
Assert-True "callExtractor defined"              ($eg -match "async function callExtractor")

# 2. Extraction prompt
Write-Host "`n-- 2. extraction prompt --"
Assert-True "prompt has person type"             ($eg -match "person")
Assert-True "prompt has book type"               ($eg -match "book")
Assert-True "prompt has problem type"            ($eg -match "problem")
Assert-True "prompt has company type"            ($eg -match "company")
Assert-True "prompt uses lightweight model"      ($eg -match "gemini-2.0-flash-lite|gemini-2.5-flash|gemini-2.0-flash")
Assert-True "caps input text length"             ($eg -match "\.slice\(0, 1[0-9]{3}\)")

# 3. upsertEntity logic
Write-Host "`n-- 3. upsertEntity --"
Assert-True "merges attributes on update"        ($eg -match "merged|\.\.\.existing\.attributes")
Assert-True "increments mention_count"           ($eg -match "mention_count")
Assert-True "updates last_seen"                  ($eg -match "last_seen")
Assert-True "inserts mention row"                ($eg -match "m8_entity_mentions")
Assert-True "non-fatal on error"                 ($eg -match "catch.*\(\)" -or $eg -match "catch \(_\)")

# 4. recallEntities logic
Write-Host "`n-- 4. recallEntities --"
Assert-True "queries m8_entities"                ($eg -match "m8_entities")
Assert-True "filters by name substring"          ($eg -match "includes\(|ilike")
Assert-True "orders by mention_count"            ($eg -match "mention_count.*ascending.*false")
Assert-True "returns null when no hits"          ($eg -match "return null")
Assert-True "formats type + name + attrs"        ($eg -match "entity_type.*name|name.*entity_type")

# 5. Wired into memory.js
Write-Host "`n-- 5. memory.js wiring --"
Assert-True "entity-graph required in memory"    ($mem -match "entity-graph")
Assert-True "fire-and-forget extraction"         ($mem -match "_maybeExtractEntities.*catch|catch.*_maybeExtractEntities")
Assert-True "Build-83c comment present"          ($mem -match "Build-83c")

# 6. Wired into orchestrator.js
Write-Host "`n-- 6. orchestrator.js wiring --"
Assert-True "entity-graph required in orch"      ($orch -match "entity-graph")
Assert-True "recallEntities called"              ($orch -match "recallEntities\(effectiveMessage")
Assert-True "KNOWN ENTITIES block injected"      ($orch -match "KNOWN ENTITIES")
Assert-True "Build-83c comment in orch"          ($orch -match "Build-83c")

# 7. Migration
Write-Host "`n-- 7. migration SQL --"
Assert-True "migration file exists"              ([IO.File]::Exists($migPath))
Assert-True "m8_entities table created"          ($mig -match "CREATE TABLE.*m8_entities")
Assert-True "m8_entity_mentions table created"   ($mig -match "CREATE TABLE.*m8_entity_mentions")
Assert-True "name + entity_type unique"          ($mig -match "UNIQUE.*name.*entity_type|UNIQUE.*entity_type.*name")
Assert-True "attributes jsonb column"            ($mig -match "attributes.*jsonb")
Assert-True "mention_count column"               ($mig -match "mention_count")
Assert-True "indexes created"                    ($mig -match "CREATE INDEX")
Assert-True "foreign key to m8_entities"         ($mig -match "REFERENCES.*m8_entities")

# Summary
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Build-83c entity graph verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
