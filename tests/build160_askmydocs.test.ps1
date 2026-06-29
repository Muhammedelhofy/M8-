# tests/build160_askmydocs.test.ps1 -- Build-160 ask-my-docs retrieval ship gate.
#
# THE BUG (live prod 2026-06-29): every "what does my CV say about X" answered
# "I don't have your CV / ingested documents" even though content + routing were fine.
# ROOT CAUSE: searchKnowledgeGraph was destructured INSIDE the knowledge-INGEST block
# (block-scoped, dead ~600 lines before its call site in the kgGate). Calling it bare
# threw a ReferenceError that the surrounding catch(_){} swallowed -> kgContext stayed
# null on EVERY knowledge turn. PS-5.1 mirrors don't execute JS, so a pure logic mirror
# could never catch a SCOPE/wiring bug -- so this gate asserts the wiring STATICALLY on
# the orchestrator source (the exact class that hid from the JS-less harness), plus a
# behavioral mirror of the streamable gate, plus an OPTIONAL live-DB retrieval check.
#
# PS-5.1 notes: ASCII-only Write-Host; .Contains is case-SENSITIVE (intended here).

$pass = 0; $fail = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }

$orchPath = Join-Path $PSScriptRoot "..\lib\orchestrator.js"
$orch = Get-Content -Raw $orchPath

# ---------------------------------------------------------------------------
# 1. SCOPE GUARD (root cause) -- searchKnowledgeGraph must be IN SCOPE where it
#    is called. The call lives in the kgGate; assert a local require of it sits
#    within a small window BEFORE the call (same block), so it can never again
#    be a swallowed ReferenceError.
# ---------------------------------------------------------------------------
Write-Host "`n-- Scope guard: searchKnowledgeGraph reachable at call site --" -ForegroundColor Cyan

$callMarker = 'kgContext = await searchKnowledgeGraph('
$callIdx = $orch.IndexOf($callMarker)
CheckTrue "kgGate call to searchKnowledgeGraph present" ($callIdx -ge 0)

if ($callIdx -ge 0) {
  $winStart = [Math]::Max(0, $callIdx - 400)
  $before   = $orch.Substring($winStart, $callIdx - $winStart)
  CheckTrue "local require of knowledge-intake precedes the call (in scope)" `
            ($before.Contains('require("./knowledge-intake")'))
  CheckTrue "that require destructures searchKnowledgeGraph" `
            ($before.Contains('{ searchKnowledgeGraph }') -or $before.Contains('searchKnowledgeGraph }'))

  # The failure must be OBSERVABLE, not swallowed -- the old silent catch(_){}
  # is what let the ReferenceError hide for so long.
  $afterWin = $orch.Substring($callIdx, [Math]::Min(400, $orch.Length - $callIdx))
  CheckTrue "kgGate catch logs kg_search_failed (no silent swallow)" `
            ($afterWin.Contains('kg_search_failed'))
}

# Guard against the regression itself: the ONLY destructure of searchKnowledgeGraph
# must not be the sole binding. After the fix there are >=2 references that bring it
# into scope (the ingest-block one + the call-site require).
$sgCount = ([regex]::Matches($orch, 'searchKnowledgeGraph')).Count
CheckTrue "searchKnowledgeGraph referenced multiple times (ingest + call-site require + call)" `
          ($sgCount -ge 3)

# ---------------------------------------------------------------------------
# 2. STREAMING DELEGATION GUARD -- a knowledge-routed turn must NOT stream
#    inline (orchestrateStream has no graph injection); it must delegate to the
#    fixed buffered orchestrate(). Assert the flag + its use in `streamable`.
# ---------------------------------------------------------------------------
Write-Host "`n-- Streaming delegation: knowledge turns are non-streamable --" -ForegroundColor Cyan

CheckTrue "orchestrateStream computes forceKnowledgeLookupS from _routeS.lookup" `
          ($orch.Contains('const forceKnowledgeLookupS = !!(_routeS.lookup && _routeS.lookup.domain === "knowledge")'))
CheckTrue "streamable excludes forceKnowledgeLookupS (forces delegation)" `
          ($orch.Contains('const streamable = !forceKnowledgeLookupS &&'))

# ---------------------------------------------------------------------------
# 3. BEHAVIORAL MIRROR of the streamable gate (the deterministic logic changed).
#    knowledge lookup => never streamable (delegate); otherwise old behavior.
# ---------------------------------------------------------------------------
Write-Host "`n-- Behavioral mirror: streamable(forceKnowledgeLookupS, hasCtx, isPersonal) --" -ForegroundColor Cyan
function StreamableMirror([bool]$forceKnow, [bool]$hasCtx, [bool]$isPersonal) {
  if ($forceKnow) { return $false }       # B-160: knowledge turns delegate to buffered
  return ($hasCtx -or $isPersonal)
}
# CV question (isPersonal=false, no ctx) but knowledge-routed -> delegate (handled by part 1 already)
CheckFalse "knowledge turn w/ no ctx, not personal -> NOT streamable" (StreamableMirror $true  $false $false)
# CV question that trips isPersonal ("...my earnings") + knowledge-routed -> STILL delegate (part 2)
CheckFalse "knowledge turn that is ALSO isPersonal -> NOT streamable" (StreamableMirror $true  $false $true)
# a genuine personal/fleet turn (no knowledge route) -> still streams as before
CheckTrue  "personal turn, no knowledge route -> streamable"          (StreamableMirror $false $false $true)
CheckTrue  "ctx-packet turn, no knowledge route -> streamable"        (StreamableMirror $false $true  $false)
CheckFalse "no ctx, not personal, no knowledge -> not streamable"     (StreamableMirror $false $false $false)

# ---------------------------------------------------------------------------
# 4. Keyword-token mirror -- the failing live query reduces to >=1 useful token
#    so the keyword ILIKE fallback has something to match (sanity for the path
#    that now actually runs).
# ---------------------------------------------------------------------------
Write-Host "`n-- Keyword token extraction mirror --" -ForegroundColor Cyan
$stop = @("this","that","what","when","where","which","about","with","from","have","does","will","tell","give","show","want","know")
function KwTokens([string]$q) {
  $clean = ($q.ToLower() -replace '[^a-z0-9\s]', ' ')
  $words = $clean -split '\s+' | Where-Object { $_.Length -ge 4 -and ($stop -notcontains $_) }
  return ,@($words | Select-Object -First 6)
}
$t1 = KwTokens "what does my CV say about my Careem experience"
CheckTrue "CV query yields careem token"      ($t1 -contains "careem")
CheckTrue "CV query yields experience token"  ($t1 -contains "experience")
CheckTrue "CV query drops stopword 'about'"   (-not ($t1 -contains "about"))
$t2 = KwTokens "tell me about my kafala operation"
CheckTrue "kafala query yields kafala token"     ($t2 -contains "kafala")
CheckTrue "kafala query yields operation token"  ($t2 -contains "operation")

# ---------------------------------------------------------------------------
# 5. OPTIONAL live-DB check -- if SUPABASE creds are present, hit the REST API
#    (service key bypasses RLS) and confirm the keyword query returns CV nodes.
#    Skips cleanly when creds are absent (CI / no-secret runs).
# ---------------------------------------------------------------------------
Write-Host "`n-- Optional live retrieval check (skips without creds) --" -ForegroundColor Cyan
$sbUrl = $env:SUPABASE_URL
$sbKey = $env:SUPABASE_SERVICE_KEY
if ($sbUrl -and $sbKey) {
  try {
    $uri = "$sbUrl/rest/v1/m8_graph_nodes?or=(content.ilike.%25careem%25,label.ilike.%25careem%25)&select=id&limit=20"
    $rows = Invoke-RestMethod -Uri $uri -Headers @{ apikey = $sbKey; Authorization = "Bearer $sbKey" } -TimeoutSec 25
    CheckTrue "live: keyword 'careem' returns >=2 graph nodes" (@($rows).Count -ge 2)
  } catch {
    Write-Host ("  SKIP  live check errored: " + $_.Exception.Message) -ForegroundColor Yellow
  }
} else {
  Write-Host "  SKIP  SUPABASE_URL / SUPABASE_SERVICE_KEY not set (static checks above cover the fix)" -ForegroundColor Yellow
}

Write-Host "`n================ B-160 ASK-MY-DOCS RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
