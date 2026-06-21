# B109 — Graph Track-A vocabulary mirror test (PowerShell; Node-free host)
# Statically verifies lib/memory-graph.js and migrations/B109_graph_track_a.sql
# agree on the widened ontology, stay ADDITIVE (old kinds/rels kept), and preserve
# the honesty bans (no extraction-minted 'theorem'; no 'formalizes' edge).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$root\lib\memory-graph.js")) { $root = "C:\Users\m7ofy\OneDrive\Documents\Claude\Projects\Bolt\M8" }

function ReadAll($p) {
  for ($i = 0; $i -lt 6; $i++) { try { return [System.IO.File]::ReadAllText($p) } catch { Start-Sleep -Milliseconds 200 } }
  throw "could not read $p"
}
$js  = ReadAll "$root\lib\memory-graph.js"
$sql = ReadAll "$root\migrations\B109_graph_track_a.sql"

$script:pass = 0; $script:fail = 0; $script:fails = @()
function Check($name, $cond) {
  if ($cond) { $script:pass++ } else { $script:fail++; $script:fails += $name }
}
$SL = [System.Text.RegularExpressions.RegexOptions]::Singleline
function Block($text, $pattern) { return [regex]::Match($text, $pattern, $SL).Groups[1].Value }

$nodeKinds = Block $js 'const NODE_KINDS = new Set\(\[(.*?)\]\)'
$edgeRels  = Block $js 'const EDGE_RELS = new Set\(\[(.*?)\]\)'
$noteKinds = Block $js 'const NOTE_NODE_KINDS = new Set\(\[(.*?)\]\)'
$entKinds  = Block $js 'const ENTITY_KINDS = new Set\(\[(.*?)\]\)'
$sys       = Block $js 'const EXTRACTION_SYSTEM = `(.*?)`;'

$oldKinds = @('conjecture','theorem','evidence','counterexample','failed_attempt','technique','sequence','research_thread','claim','entity','document')
$newKinds = @('fact','concept','project','person','company','decision','question','source')
$oldRels  = @('supports','contradicts','generalizes','depends_on','formalizes','derived_from')
$newRels  = @('related_to','tested_by','belongs_to','caused_by')

# 1) NODE_KINDS — additive (keep old, add new)
foreach ($k in $oldKinds) { Check "NODE_KINDS keeps '$k'" ($nodeKinds.Contains('"' + $k + '"')) }
foreach ($k in $newKinds) { Check "NODE_KINDS adds  '$k'" ($nodeKinds.Contains('"' + $k + '"')) }
# 2) EDGE_RELS — additive
foreach ($r in $oldRels) { Check "EDGE_RELS keeps '$r'" ($edgeRels.Contains('"' + $r + '"')) }
foreach ($r in $newRels) { Check "EDGE_RELS adds  '$r'" ($edgeRels.Contains('"' + $r + '"')) }

# 3) extraction validator — new claim/entity kinds present, 'theorem' BANNED from minting
Check "NOTE_NODE_KINDS bans 'theorem' (mint-ban kept)" (-not $noteKinds.Contains('"theorem"'))
foreach ($k in @('fact','decision','question','project','concept')) { Check "NOTE_NODE_KINDS adds '$k'" ($noteKinds.Contains('"' + $k + '"')) }
foreach ($k in @('person','company','project','concept','source'))  { Check "ENTITY_KINDS adds '$k'"    ($entKinds.Contains('"' + $k + '"')) }

# 4) extraction prompt — covers BOTH tracks, keeps honesty spine
Check "EXTRACTION_SYSTEM covers OPERATIONS" ($sys.Contains('OPERATIONS'))
Check "EXTRACTION_SYSTEM covers RESEARCH"   ($sys.Contains('RESEARCH'))
Check "EXTRACTION_SYSTEM keeps 'extract ONLY what'" ($sys.Contains('extract ONLY what'))
Check "EXTRACTION_SYSTEM keeps theorem ban" ($sys.Contains('NEVER classify as "theorem"'))
Check "EXTRACTION_SYSTEM keeps formalizes ban" ($sys.Contains('NEVER emit "formalizes"'))
# 5) parse-time formalizes ban still enforced in code
Check "parseExtraction enforces formalizes ban" ($js.Contains('ed.rel !== "formalizes"'))

# 6) migration SQL — node CHECK has every kind, edge CHECK has every rel (additive)
foreach ($k in ($oldKinds + $newKinds)) { Check "SQL node CHECK has '$k'" ($sql.Contains("'" + $k + "'")) }
foreach ($r in ($oldRels  + $newRels))  { Check "SQL edge CHECK has '$r'" ($sql.Contains("'" + $r + "'")) }

$total = $script:pass + $script:fail
Write-Output "B109 graph Track-A vocab: $($script:pass)/$total checks passed"
if ($script:fail -gt 0) {
  Write-Output "FAILED:"; $script:fails | ForEach-Object { Write-Output "  - $_" }
  exit 1
}
Write-Output "ALL GREEN"
exit 0
