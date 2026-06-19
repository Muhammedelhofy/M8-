# Build-80: Recall scope fix + memory-health endpoint — offline, pure PS 5.1.
# Verifies:
#   1. Tier 1 recall no longer excludes currentSessionId
#   2. Build-80 comment present explaining the fix
#   3. Tier 2 recall still excludes currentSessionId (raw turns / summaries)
#   4. memory-health endpoint exists and has correct shape
#   5. endpoint returns facts + summaries + summary block
#   6. endpoint is GET-only, CORS-open, Supabase-gated

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$memPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\lib\memory.js"))
$apiPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\api\memory-health.js"))
$mem = [IO.File]::ReadAllText($memPath, [Text.Encoding]::UTF8)
$api = [IO.File]::ReadAllText($apiPath, [Text.Encoding]::UTF8)

Write-Host "Build-80 memory health verify`n"

# 1. Tier 1 fix: currentSessionId exclusion removed from facts query
Write-Host "-- 1. Tier 1 recall scope fix --"
Assert-True "Build-80 fix comment present"                  ($mem -match "Build-80 fix")
# The profile/operational query must NOT have neq(session_id) immediately before it.
# Check: the two neq(session_id) calls that remain are both in the Tier 2 (pool) query.
$neqMatches = [regex]::Matches($mem, '\.neq\("session_id", currentSessionId\)')
Assert-True "Only 1 neq(session_id) remains (Tier 2 only, not Tier 1)" ($neqMatches.Count -eq 1)
Assert-True "Tier 1 still filters is_current=true"          ($mem -match '\.eq\("is_current", true\)')
Assert-True "Tier 1 still filters memory_type profile/oper" ($mem -match '"profile", "operational"')

# 2. Tier 2 still excludes currentSessionId (raw turns should not bleed in)
Write-Host "`n-- 2. Tier 2 exclusion unchanged --"
# The one remaining neq must come AFTER the Tier 2 marker in the file
$tier2Pos = $mem.IndexOf("Tier 2 ")
$neqPos   = $mem.IndexOf('.neq("session_id", currentSessionId)')
Assert-True "Tier 2 neq comes after Tier 1 section"        ($neqPos -gt $tier2Pos)

# 3. memory-health endpoint
Write-Host "`n-- 3. memory-health endpoint structure --"
Assert-True "endpoint file exists"                          ([IO.File]::Exists($apiPath))
Assert-True "GET-only guard present"                        ($api -match '"GET only"')
Assert-True "OPTIONS preflight handled"                     ($api -match '"OPTIONS"')
Assert-True "CORS header set"                               ($api -match 'Access-Control-Allow-Origin')
Assert-True "Supabase not-configured guard"                 ($api -match 'Supabase not configured')

# 4. Correct data queries
Write-Host "`n-- 4. query correctness --"
Assert-True "queries canonical facts (profile+operational)" ($api -match '"profile", "operational"')
Assert-True "queries session summaries"                     ($api -match '"session"')
Assert-True "filters is_current=true"                       ($api -match '\.eq\("is_current", true\)')
Assert-True "filters trust_level >= RECALL_MIN_TRUST"       ($api -match 'RECALL_MIN_TRUST')
Assert-True "orders facts by importance desc"               ($api -match 'importance.*ascending.*false')

# 5. Response shape
Write-Host "`n-- 5. response shape --"
Assert-True "response has summary block"                    ($api -match 'canonical_facts')
Assert-True "response has facts array"                      ($api -match 'facts:.*facts\.map')
Assert-True "response has summaries array"                  ($api -match 'summaries:.*summaries\.map')
Assert-True "facts include key + statement + type"          ($api -match 'key: f\.memory_key')
Assert-True "summaries include topic + entities"            ($api -match 'entities:.*metadata')
Assert-True "total_turns_stored reported"                   ($api -match 'total_turns_stored')
Assert-True "oldest + newest fact dates reported"           ($api -match 'oldest_fact' -and $api -match 'newest_fact')

# Summary
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Build-80 memory health verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
