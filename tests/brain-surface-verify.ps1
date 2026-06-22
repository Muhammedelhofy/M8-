# brain-surface-verify.ps1 - Session-2 "Surface the live brain in chat" PS-mirror
#
# The host has NO Node, so this is a STATIC assertion suite over the changed
# source files. It proves the wiring is in place; the REAL proof (a known entity
# card + its graph links injected into the LLM context) comes from
# tests/BRAIN-SURFACE_LIVE_TEST.md after Muhammad deploys a preview.
#
# Asserts:
#   1. lib/memory-graph.js  - the ENTITY <-> GRAPH bridge helpers + exports, no
#      embedding on the lookup path, write-back OFF by default, no schema change.
#   2. lib/entity-graph.js  - _matchEntities refactor (recallEntities output
#      UNCHANGED), bridgeEntitiesToGraph (person/company only, kill switch,
#      awaited write-back), exports.
#   3. lib/orchestrator.js  - bridge injected on BOTH the buffered and the stream
#      path, gated to non-deterministic turns, reflector/reasoning-chain/
#      saveMemory/intent-routing left UNTOUCHED.
#
# NOTE (PS 5.1): all needles are SINGLE-quoted (fully literal) and ASCII-only,
# so braces/parens/arrows inside needles are never mis-parsed (ps-test-mirror-gotchas).
#
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\brain-surface-verify.ps1

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

function CountOf([string]$text, [string]$needle) {
  return [regex]::Matches($text, [regex]::Escape($needle)).Count
}
function Has([string]$text, [string]$needle)   { return $text.Contains($needle) }
function Lacks([string]$text, [string]$needle) { return -not $text.Contains($needle) }

Write-Host "`n=== Session-2 brain-surface - static mirror ===`n"

# == 1. lib/memory-graph.js : entity <-> graph bridge helpers =================
Write-Host "lib/memory-graph.js  (entity <-> graph bridge)"
$mg = Read-Text 'lib\memory-graph.js'
Check "defines graphNodeForEntity"            (Has $mg 'async function graphNodeForEntity(name, kinds)')
Check "defines graphRelationsForEntity"       (Has $mg 'async function graphRelationsForEntity(name, entityType)')
Check "defines bridgeEntityNode"              (Has $mg 'async function bridgeEntityNode(name, entityType, content)')
Check "ENTITY_KIND_BRIDGE maps person+legacy" (Has $mg 'person:  ["person", "entity"]')
Check "ENTITY_KIND_BRIDGE maps company+legacy" (Has $mg 'company: ["company", "entity"]')
Check "write-back creates the TYPED kind"     (Has $mg 'kind:     kinds[0]')
Check "lookup is by norm_label (indexed)"     (Has $mg '.eq("norm_label", norm)')
Check "lookup filters by kind list"           (Has $mg '.in("kind", kindList)')
Check "lookup validates kind in NODE_KINDS"   (Has $mg 'NODE_KINDS.has(k)')
Check "relations use fetchNeighbors (1-hop)"  (Has $mg 'fetchNeighbors([node.id]')
Check "relations skip research_thread anchor" (Has $mg 'far.kind === "research_thread"')
Check "write-back is OFF by default (env=1)"  (Has $mg 'process.env.M8_ENTITY_GRAPH_BRIDGE_WRITE !== "1"')
Check "write-back keeps embed off the budget" (Has $mg 'embed:    false')
Check "write-back tags provenance"            (Has $mg 'bridged_from')
Check "write-back reuses upsertNode (dedup)"  (Has $mg 'return await upsertNode({')
Check "exports graphNodeForEntity"            (Has $mg 'graphNodeForEntity, graphRelationsForEntity, bridgeEntityNode')
# No schema change: person/company already in NODE_KINDS (B109), bridge adds none.
Check "no new migration referenced here"      (Lacks $mg 'CREATE TABLE')
Check "graphNodeForEntity fail-safe logs"     (Has $mg 'graphNodeForEntity error (non-fatal):')
Check "graphRelationsForEntity fail-safe logs" (Has $mg 'graphRelationsForEntity error (non-fatal):')
Check "bridgeEntityNode fail-safe logs"       (Has $mg 'bridgeEntityNode error (non-fatal):')

# == 2. lib/entity-graph.js : matcher refactor + bridge ======================
Write-Host "`nlib/entity-graph.js  (matcher + bridge)"
$eg = Read-Text 'lib\entity-graph.js'
Check "defines _matchEntities"                (Has $eg 'async function _matchEntities(currentMessage, limit = 5)')
Check "_matchEntities returns [] on miss"     (Has $eg '  if (!db) return [];')
Check "recallEntities now uses _matchEntities" (Has $eg 'const hits = await _matchEntities(currentMessage, limit);')
Check "recallEntities maps empty -> null"     (Has $eg 'if (hits.length === 0) return null;')
# recallEntities output UNCHANGED: arc + seen formatting still present verbatim.
Check "recall output unchanged: Arc label"    (Has $eg ' Arc: ')
Check "recall output unchanged: seen N"       (Has $eg 'seen ')
Check "recall output unchanged: fallback txt" (Has $eg 'tracked entity')
Check "BRIDGE_TYPES = person/company"         (Has $eg 'const BRIDGE_TYPES        = new Set(["person", "company"])')
Check "defines bridgeEntitiesToGraph"         (Has $eg 'async function bridgeEntitiesToGraph(currentMessage, limit = 5)')
Check "bridge filters to BRIDGE_TYPES"        (Has $eg 'BRIDGE_TYPES.has(e.entity_type)')
Check "bridge has a kill switch"              (Has $eg 'ENTITY_GRAPH_BRIDGE_DISABLED')
Check "bridge lazy-requires memory-graph"     (Has $eg 'require("./memory-graph")')
Check "bridge calls graphRelationsForEntity"  (Has $eg 'await graphRelationsForEntity(e.name, e.entity_type)')
# Session-2 follow-up "light up the bridge": write-back now reached via
# ensureEntityGraphNode (find-or-seed); node then gets edges via anchorEntityNode.
Check "bridge ensures graph node (find-or-seed)" (Has $eg 'await ensureEntityGraphNode(e.name, e.entity_type, e.summary)')
Check "exports bridgeEntitiesToGraph"         (Has $eg 'bridgeEntitiesToGraph')
Check "exports _matchEntities"                (Has $eg '_matchEntities,')

# == 3. lib/orchestrator.js : injected on BOTH paths, gated, nothing else ====
Write-Host "`nlib/orchestrator.js  (recall-injection region)"
$or = Read-Text 'lib\orchestrator.js'
Check "buffered+stream: bridge block x2"      ((CountOf $or 'Session-2 "brain-surface" START') -ge 2)
Check "injects ENTITY <-> GRAPH LINKS x2"     ((CountOf $or 'ENTITY <-> GRAPH LINKS (how the people/companies') -ge 2)
Check "buffered requires bridgeEntitiesToGraph" (Has $or 'const { bridgeEntitiesToGraph } = require("./entity-graph");')
Check "buffered logs entity_graph_bridge"     (Has $or 'log("entity_graph_bridge")')
Check "buffered gate mirrors Longitudinal x2" ((CountOf $or '!fleetCtx.text && !financeCtx.text && !computeMode && !imgTurn && !leanMode && !lemmaDagMode') -ge 2)
Check "stream gap-fills entity roster recall" (Has $or 'const { recallEntities, bridgeEntitiesToGraph } = require("./entity-graph");')
Check "stream KNOWN ENTITIES now x2 (buf+strm)" ((CountOf $or 'KNOWN ENTITIES (tracked across sessions') -ge 2)
Check "stream gate excludes deterministic"    (Has $or '!fleetCtx.text && !financeCtx.text && !eosbCtx.text && !companyCtx.text && !stateCtx.text && !notebookCtx.text && !graphCtx.text')
# Ownership guard: forbidden regions left intact (not deleted / not touched).
Check "saveMemory call still present (stream)" (Has $or 'await saveMemory(sessionId, message, response);')
Check "reasoning-chain hook intact (85d)"     (Has $or 'entityCtxForChain')
Check "intent routing intact (classifyIntent)" (Has $or 'classifyIntent(baseMessage)')
Check "existing entity recall still present"  ((CountOf $or 'recallEntities(effectiveMessage, 5)') -ge 2)

# == summary ==================================================================
Write-Host ""
Write-Host ("PASS=" + $script:pass + "  FAIL=" + $script:fail)
if ($script:fail -gt 0) {
  Write-Host "FAILURES:" -ForegroundColor Red
  $script:fails | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  exit 1
}
Write-Host "ALL GREEN" -ForegroundColor Green
exit 0
