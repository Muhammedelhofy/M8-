# Build-83b: KG Semantic Search -- offline, pure PS 5.1 ASCII.
# Verifies:
#   1. Migration file exists with correct SQL
#   2. populateGraph still stores embeddings (regression guard)
#   3. searchKnowledgeGraph: semantic-first path (match_kg_nodes RPC call)
#   4. searchKnowledgeGraph: threshold constant is 0.65
#   5. searchKnowledgeGraph: fallback to keyword when < KG_SEM_MIN_HITS
#   6. searchKnowledgeGraph: keyword ilike fallback retained

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$kiPath  = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\knowledge-intake.js"))
$migPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\migrations\B83b_kg_embeddings.sql"))

$ki  = [IO.File]::ReadAllText($kiPath,  [Text.Encoding]::UTF8)
$mig = [IO.File]::ReadAllText($migPath, [Text.Encoding]::UTF8)

# Isolate just the searchKnowledgeGraph function body for targeted checks
$sgIdx = $ki.IndexOf("async function searchKnowledgeGraph")
$sg    = if ($sgIdx -ge 0) { $ki.Substring($sgIdx) } else { "" }

Write-Host "Build-83b KG semantic search verify`n"

# ── 1. Migration SQL ──────────────────────────────────────────────────────────
Write-Host "-- 1. migration SQL --"
Assert-True "migration file exists"                    ([IO.File]::Exists($migPath))
Assert-True "enables pgvector extension"               ($mig -match "CREATE EXTENSION IF NOT EXISTS vector")
Assert-True "HNSW index IF NOT EXISTS"                 ($mig -match "CREATE INDEX IF NOT EXISTS")
Assert-True "HNSW cosine ops on m8_graph_nodes"        ($mig -match "m8_graph_nodes")
Assert-True "USING hnsw"                               ($mig -match "USING hnsw")
Assert-True "creates match_kg_nodes function"          ($mig -match "CREATE OR REPLACE FUNCTION match_kg_nodes")
Assert-True "accepts query_embedding vector(768)"      ($mig -match "query_embedding\s+extensions\.vector\(768\)")
Assert-True "accepts match_threshold param"            ($mig -match "match_threshold")
Assert-True "accepts match_count param"                ($mig -match "match_count")
Assert-True "returns kind column"                      ($mig -match "\bkind\b")
Assert-True "returns label column"                     ($mig -match "\blabel\b")
Assert-True "returns content column"                   ($mig -match "\bcontent\b")
Assert-True "returns similarity column"                ($mig -match "similarity")
Assert-True "cosine distance operator"                 ($mig -match "embedding <=> query_embedding")
Assert-True "1 - cosine for similarity score"          ($mig -match "1 - \(n\.embedding <=> query_embedding\)")
Assert-True "filters embedding IS NOT NULL"            ($mig -match "embedding IS NOT NULL")

# ── 2. populateGraph still embeds nodes (regression guard) ────────────────────
Write-Host "`n-- 2. populateGraph embeds nodes --"
$pgIdx  = $ki.IndexOf("async function populateGraph")
$pgBody = if ($pgIdx -ge 0) { $ki.Substring($pgIdx) } else { "" }
Assert-True "embedText called in populateGraph"        ($pgBody -match "embedText\(")
Assert-True "embedding stored in insert row"           ($pgBody -match "embedding,")
Assert-True "JSON.stringify of vector"                 ($pgBody -match "JSON\.stringify\(vec\)")

# ── 3. Semantic-first path ────────────────────────────────────────────────────
Write-Host "`n-- 3. semantic-first path --"
Assert-True "embedText called for query"               ($sg -match "embedText\(query")
Assert-True "calls match_kg_nodes RPC"                 ($sg -match '\.rpc\("match_kg_nodes"')
Assert-True "passes query_embedding to RPC"            ($sg -match "query_embedding:\s*emb")
Assert-True "passes match_threshold to RPC"            ($sg -match "match_threshold:")
Assert-True "passes match_count to RPC"                ($sg -match "match_count:")
Assert-True "returns semantic hits when enough"        ($sg -match "semData\.length >= KG_SEM_MIN_HITS")

# ── 4. Threshold constant 0.65 ────────────────────────────────────────────────
Write-Host "`n-- 4. threshold constant --"
Assert-True "KG_SEM_THRESHOLD constant defined"        ($ki -match "KG_SEM_THRESHOLD\s*=\s*0\.65")
Assert-True "KG_SEM_MIN_HITS constant defined"         ($ki -match "KG_SEM_MIN_HITS\s*=\s*2")
Assert-True "threshold used in RPC call"               ($sg -match "KG_SEM_THRESHOLD")

# ── 5. Fallback when < 2 hits ─────────────────────────────────────────────────
Write-Host "`n-- 5. fallback trigger --"
Assert-True "falls through when < MIN_HITS"            ($sg -match "semData\.length >= KG_SEM_MIN_HITS")
Assert-True "catch block falls to keyword"             ($sg -match "catch \{.*fall through" -or $sg -match "catch \{ \/\* fall through")

# ── 6. Keyword ilike fallback retained ───────────────────────────────────────
Write-Host "`n-- 6. keyword ilike fallback --"
Assert-True "stopWords set still present"              ($sg -match "stopWords")
Assert-True "ilike filter on content"                  ($sg -match "content\.ilike")
Assert-True "ilike filter on label"                    ($sg -match "label\.ilike")
Assert-True "orders by confidence"                     ($sg -match 'order\("confidence"')
Assert-True "deduplication by label"                   ($sg -match "seen\.has\(key\)")
Assert-True "formats as Claim/Entity lines"            ($sg -match "Claim.*Entity")

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Build-83b KG semantic search verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
