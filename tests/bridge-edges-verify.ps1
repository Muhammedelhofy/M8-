# bridge-edges-verify.ps1 - Session-2 follow-up "light up the bridge" PS-mirror
#
# Host has NO Node -> static assertion suite. Proves: a bridged entity node is no
# longer left ISOLATED — it gets `related_to` edges to the research nodes it's
# closest to, so the ENTITY <-> GRAPH LINKS block actually appears in chat.
# Live proof: BRIDGE-EDGES_LIVE_TEST.md after deploy.
#
# PS 5.1: needles SINGLE-quoted + ASCII-only (ps-test-mirror-gotchas).
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\bridge-edges-verify.ps1

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
function Has([string]$text, [string]$needle)   { return $text.Contains($needle) }
function Lacks([string]$text, [string]$needle) { return -not $text.Contains($needle) }

Write-Host "`n=== Session-2 follow-up: light up the bridge - static mirror ===`n"

# == lib/memory-graph.js : node ensure + edge anchoring =======================
Write-Host "lib/memory-graph.js"
$mg = Read-Text 'lib\memory-graph.js'
Check "ensureEntityGraphNode defined"          (Has $mg 'async function ensureEntityGraphNode(name, entityType, summary)')
Check "ensureEntityGraphNode reads first"      (Has $mg 'const existing = await graphNodeForEntity(name, ENTITY_KIND_BRIDGE[entityType])')
Check "ensureEntityGraphNode seeds if absent"  (Has $mg 'return await bridgeEntityNode(name, entityType, summary)')
Check "anchorEntityNode defined"               (Has $mg 'async function anchorEntityNode(node, queryText)')
Check "anchor gated on write flag (opt-in)"    (Has $mg 'if (process.env.M8_ENTITY_GRAPH_BRIDGE_WRITE !== "1") return 0;')
Check "anchor SKIPS once node has edges"       (Has $mg '>= ANCHOR_SKIP_EDGES) return 0;')
Check "anchor checks edges via fetchNeighbors" (Has $mg 'const existing = await fetchNeighbors([node.id]')
Check "anchor finds matches via graphMatch"    (Has $mg 'matches = await graphMatch(queryText, { k: 6, minSimilarity: ANCHOR_MIN_SIM })')
Check "anchor links with related_to (non-evidence)" (Has $mg 'rel: "related_to",')
Check "anchor uses addEdge"                    (Has $mg 'const ok = await addEdge({')
Check "anchor caps edges per call"             (Has $mg 'if (added >= ANCHOR_MAX_EDGES) break;')
Check "anchor skips research_thread targets"   (Has $mg 'if (m.kind === "research_thread") continue;')
Check "anchor skips self-link"                 (Has $mg 'm.id === node.id')
Check "edges tagged bridged_anchor"            (Has $mg 'bridged_anchor: true')
Check "anchor never throws (catch -> 0)"       (Has $mg 'console.error("[M8] anchorEntityNode error (non-fatal):"')
Check "anchor never mints evidence edges"      (Lacks $mg 'rel: "supports"')
Check "exports ensureEntityGraphNode+anchor"   (Has $mg 'ensureEntityGraphNode, anchorEntityNode,')

# == lib/entity-graph.js : bridge now ensures + anchors + displays ============
Write-Host "`nlib/entity-graph.js"
$eg = Read-Text 'lib\entity-graph.js'
Check "bridge requires the 3 graph helpers"    (Has $eg 'const { graphRelationsForEntity, ensureEntityGraphNode, anchorEntityNode } = require("./memory-graph");')
Check "step 1: ensure (find-or-seed) the node" (Has $eg 'await ensureEntityGraphNode(e.name, e.entity_type, e.summary)')
Check "step 2: anchor the node (light it up)"  (Has $eg 'await anchorEntityNode(node,')
Check "anchor query = name + summary"          (Has $eg '`${e.name}. ${e.summary || ""}`.trim()')
Check "step 3: read relations for display"     (Has $eg 'await graphRelationsForEntity(e.name, e.entity_type)')
Check "still injects per-entity link line"     (Has $eg 'lines.push(`[${e.entity_type}] ${e.name}: ${rel.line}`)')
Check "bridge no longer calls bridgeEntityNode directly" (Lacks $eg 'bridgeEntityNode')
Check "kill switch intact"                     (Has $eg 'ENTITY_GRAPH_BRIDGE_DISABLED')

Write-Host ""
Write-Host ("PASS=" + $script:pass + "  FAIL=" + $script:fail)
if ($script:fail -gt 0) {
  Write-Host "FAILURES:" -ForegroundColor Red
  $script:fails | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  exit 1
}
Write-Host "ALL GREEN" -ForegroundColor Green
exit 0
