# Build-81: Semantic Recall via pgvector -- offline, pure PS 5.1.
# Verifies:
#   1. GoogleGenAI imported in memory.js
#   2. generateEmbedding function: model, dims, null-safety, text cap
#   3. upsertFact stores embedding
#   4. summarizeSession stores embedding on summary row
#   5. semanticRecall: real implementation (no longer a stub)
#   6. recallMemory Tier 2: semantic-first with keyword fallback
#   7. Migration file exists and has correct SQL

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$memPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\memory.js"))
$migPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\migrations\B81_semantic_recall.sql"))
$mem = [IO.File]::ReadAllText($memPath, [Text.Encoding]::UTF8)
$mig = [IO.File]::ReadAllText($migPath, [Text.Encoding]::UTF8)

Write-Host "Build-81 semantic recall verify`n"

# 1. GoogleGenAI import
Write-Host "-- 1. GoogleGenAI import --"
Assert-True "GoogleGenAI required"           ($mem -match "require\(`"@google/genai`"\)")
Assert-True "GoogleGenAI destructured"       ($mem -match "\{ GoogleGenAI \}")

# 2. generateEmbedding function
Write-Host "`n-- 2. generateEmbedding --"
Assert-True "function defined"               ($mem -match "async function generateEmbedding")
Assert-True "uses text-embedding-004 model"  ($mem -match "text-embedding-004")
Assert-True "dims constant is 768"           ($mem -match "EMBEDDING_DIMS\s*=\s*768")
Assert-True "null if no apiKey"              ($mem -match "if \(!apiKey")
Assert-True "caps text at 2000 chars"        ($mem -match "\.slice\(0, 2000\)")
Assert-True "validates 768 dims on response" ($mem -match "values\.length !== EMBEDDING_DIMS")
Assert-True "returns null on failure"        ($mem -match "catch \(_\) \{ return null; \}")

# 3. upsertFact stores embedding
Write-Host "`n-- 3. upsertFact embeds facts --"
Assert-True "generateEmbedding called before insert" (
  ($mem -split "async function upsertFact")[1] -match "generateEmbedding\(statement\)"
)
Assert-True "embedding field in insert"      (
  ($mem -split "async function upsertFact")[1] -match "embedding,"
)

# 4. summarizeSession stores embedding
Write-Host "`n-- 4. summarizeSession embeds summary --"
Assert-True "generateEmbedding called for summary" (
  ($mem -split "async function summarizeSession")[1] -match "generateEmbedding\(summaryText\)"
)
Assert-True "embedding in summary insert" (
  ($mem -split "async function summarizeSession")[1] -match "embedding,"
)

# 5. semanticRecall — real implementation
Write-Host "`n-- 5. semanticRecall implemented --"
Assert-True "no longer a stub (no TODO comment)"     (-not ($mem -match "TODO Milestone 4"))
Assert-True "calls supabase.rpc match_memories"      ($mem -match '\.rpc\("match_memories"')
Assert-True "passes query_embedding"                 ($mem -match "query_embedding: queryEmbedding")
Assert-True "passes current_session"                 ($mem -match "current_session: currentSessionId")
Assert-True "SEMANTIC_THRESHOLD env override"        ($mem -match "SEMANTIC_THRESHOLD")
Assert-True "non-fatal error handling"               ($mem -match "semanticRecall error \(non-fatal\)")

# 6. recallMemory Tier 2 semantic-first
Write-Host "`n-- 6. recallMemory Tier 2 --"
# Check the whole file — these patterns only appear in the recallMemory Tier 2 block
Assert-True "generates queryEmbedding in recall"     ($mem -match "generateEmbedding\(currentMessage\)")
Assert-True "calls semanticRecall in recall"         ($mem -match "semanticRecall\(currentSessionId")
Assert-True "uses semantic when >= 2 results"        ($mem -match "filtered\.length >= 2")
Assert-True "keyword fallback when < 2 hits"         ($mem -match "scoredPool\.length < 2")
Assert-True "keyword pool still has neq session"     ($mem -match '\.neq\("session_id", currentSessionId\)')

# 7. Migration file
Write-Host "`n-- 7. migration SQL --"
Assert-True "migration file exists"                  ([IO.File]::Exists($migPath))
Assert-True "enables pgvector extension"             ($mig -match "CREATE EXTENSION IF NOT EXISTS vector")
Assert-True "adds embedding vector(768) column"      ($mig -match "embedding vector\(768\)")
Assert-True "creates HNSW index"                     ($mig -match "USING hnsw")
Assert-True "creates match_memories function"        ($mig -match "CREATE OR REPLACE FUNCTION match_memories")
Assert-True "function uses cosine distance"          ($mig -match "embedding <=> query_embedding")
Assert-True "function excludes raw turns of current session" ($mig -match "current_session")
Assert-True "returns similarity score"               ($mig -match "1 - \(embedding <=> query_embedding\) AS similarity")

# Summary
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Build-81 semantic recall verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
