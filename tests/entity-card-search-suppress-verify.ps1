# entity-card-search-suppress-verify.ps1 - Session-2 follow-up PS-mirror
#
# Host has NO Node -> static assertion suite over lib/orchestrator.js. Proves the
# wiring: a "who is X / tell me about X" turn for a TRACKED entity suppresses the
# web search and answers from the entity card instead of listing namesakes.
# Live proof: ENTITY-CARD-SUPPRESS_LIVE_TEST.md after deploy.
#
# PS 5.1: needles SINGLE-quoted + ASCII-only (ps-test-mirror-gotchas).
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\entity-card-search-suppress-verify.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # ...\M8

$script:pass = 0
$script:fail = 0
$script:fails = @()

function Check([string]$name, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host ("  [PASS] " + $name) -ForegroundColor Green }
  else       { $script:fail++; $script:fails += $name; Write-Host ("  [FAIL] " + $name) -ForegroundColor Red }
}
function Read-Text([string]$rel) {
  $p = Join-Path $root $rel
  for ($i = 0; $i -lt 5; $i++) {
    try { return [System.IO.File]::ReadAllText($p) } catch { Start-Sleep -Milliseconds 150 }
  }
  throw "could not read $rel"
}
function CountOf([string]$text, [string]$needle) {
  return [regex]::Matches($text, [regex]::Escape($needle)).Count
}
function Has([string]$text, [string]$needle)   { return $text.Contains($needle) }
function Lacks([string]$text, [string]$needle) { return -not $text.Contains($needle) }

Write-Host "`n=== Session-2 follow-up: entity-card search suppression - static mirror ===`n"

$or = Read-Text 'lib\orchestrator.js'

Write-Host "hoist + helper"
# ENTITY_CARD_QUERY_RE now defined EXACTLY ONCE (hoisted to module scope; the old
# duplicate local const in the compose block was removed).
Check "ENTITY_CARD_QUERY_RE defined once (hoisted, no dup)" ((CountOf $or 'const ENTITY_CARD_QUERY_RE =') -eq 1)
Check "entityCardNameFrom helper defined"      (Has $or 'function entityCardNameFrom(message)')
Check "helper trims trailing punctuation"      (Has $or "replace(/[?")
Check "helper requires name length >= 2"       (Has $or 'name.length >= 2 ? name : null')

Write-Host "`nearly fetch + flag"
Check "fetches name from baseMessage early"    (Has $or 'const entityCardName = entityCardNameFrom(baseMessage)')
Check "fetches the card once, up front"        (Has $or 'entityCard = await getEntityCard(entityCardName)')
Check "suppress flag = card exists"            (Has $or 'const entityCardSuppressSearch = !!entityCard')
Check "logs suppression decision"              (Has $or 'log("entity_card_search_suppressed"')
Check "early fetch is fail-safe"               (Has $or 'catch (_) { /* non-fatal */ }')

Write-Host "`nsearch gates (router + clarify + regex-search all guarded)"
# The guard appears in exactly the 3 search-decision gates (router entry,
# clarification gate, regex-search gate). Not in the compound gate (namesake
# query never matches a compound conversion), not as a bare flag elsewhere.
Check "guard added to 3 search gates"          ((CountOf $or '&& !entityCardSuppressSearch') -eq 3)
Check "router gate guarded"                    (Has $or '&& !openProblem && !buildQuery && !entityCardSuppressSearch)')
Check "fleet/finance guards still intact"      (Has $or '!fleetCtx.text && !fleetLike && !financeCtx.text && !financeLike')

Write-Host "`ncompose reuse (no second fetch) + anti-namesake directive"
Check "compose reuses the early-fetched card"  (Has $or 'if (entityCard && entityCardName) {')
Check "no second getEntityCard re-fetch (_ecCard gone)" (Lacks $or '_ecCard')
Check "old local _ecMatch path removed"        (Lacks $or '_ecMatch')
Check "still injects the ENTITY CARD block"    (Has $or 'ENTITY CARD (full cross-session history for')
Check "still logs entity_card_injected"        (Has $or 'log("entity_card_injected"')
Check "anti-namesake directive on suppress"    (Has $or 'Do NOT list unrelated people, companies, or places that merely share the name')
Check "tells model no web search was run"      (Has $or 'NO web search was run for it')

Write-Host "`nhonesty / fail-open"
# Suppression is gated on a REAL tracked card; no card -> flag false -> search
# runs exactly as before (no behavior change for untracked entities).
Check "suppression strictly tied to a real card" (Has $or 'entityCardSuppressSearch = !!entityCard')
Check "empty-search honesty guard untouched"   (Has $or 'else if (trace.searchExecuted)')

Write-Host ""
Write-Host ("PASS=" + $script:pass + "  FAIL=" + $script:fail)
if ($script:fail -gt 0) {
  Write-Host "FAILURES:" -ForegroundColor Red
  $script:fails | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  exit 1
}
Write-Host "ALL GREEN" -ForegroundColor Green
exit 0
