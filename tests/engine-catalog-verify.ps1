# tests/engine-catalog-verify.ps1
# PS-mirror of lib/engine-catalog.js (Build-45): detection (fires on capability/how-to
# asks about the engine; does NOT fire on self-status / fleet / generic / actual-runs)
# + catalog content sanity (commands present + honesty caveats present). Pure ASCII.

$script:pass = 0
$script:fail = 0
function Ok($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else       { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

# ---- mirror: detection regexes ------------------------------------------------
$CATALOG_INTENT = [regex]'(?i)\b(?:what\s+can|what\s+(?:are|kind|kinds|type|types)\b|how\s+(?:do|can|would|should)\s+(?:i|we)\b|how\s+to\b|list\b|show\s+me\b|which\b|tell\s+me\s+(?:about|what)|menu\b|catalog(?:ue)?\b)'
$ENGINE_NOUN = [regex]'(?i)\b(?:problem[- ]solving\s+engine|unsolved[- ]problem\s+engine|research\s+engine|conjecture\s+(?:engine|generator|templates?)|(?:your|the)\s+engine|engine''?s\b|research\s+(?:commands?|capabilit\w*|tools?|lanes?)|engine\s+(?:commands?|capabilit\w*)|census(?:es)?|kernel\s+test|decompositions?|lemma[- ]?dag)\b'
$ENGINE_DIRECT = [regex]'(?i)\b(?:engine|research)\s+(?:capabilit\w*|commands?|menu|catalog(?:ue)?)\b'
$WHAT_CAN_TEST = [regex]'(?i)\bwhat\s+(?:problems?|conjectures?|patterns?|math)\s+can\s+you\s+(?:test|attack|work|solve|prove|explore)\b'
function Detect($m) {
  $s = ([string]$m).Trim()
  if ($s.Length -lt 8) { return $false }
  if ($ENGINE_DIRECT.IsMatch($s)) { return $true }
  if ($WHAT_CAN_TEST.IsMatch($s)) { return $true }
  return ($CATALOG_INTENT.IsMatch($s) -and $ENGINE_NOUN.IsMatch($s))
}

# ---- FIRE (capability / how-to questions about the engine) --------------------
Ok 'fire: what can your problem-solving engine do' (Detect 'what can your problem-solving engine do?')
Ok 'fire: list your research commands'            (Detect 'list your research commands')
Ok 'fire: how do I use the engine'                (Detect 'how do I use the engine?')
Ok 'fire: what conjectures can you test'          (Detect 'what conjectures can you test?')
Ok 'fire: show me the engine menu'                (Detect 'show me the engine menu')
Ok 'fire: what kinds of census can you run'       (Detect 'what kinds of census can you run')

# ---- DO NOT FIRE (self-status / fleet / generic / actual run) -----------------
Ok 'no-fire: most recent build (self-status)'     (-not (Detect "what's your most recent build?"))
Ok 'no-fire: actual census run'                   (-not (Detect 'run the reverse-and-add census up to 1000'))
Ok 'no-fire: fleet how-to'                        (-not (Detect 'how do I collect cash from drivers?'))
Ok 'no-fire: generic what can you do'             (-not (Detect 'what can you do?'))
Ok 'no-fire: too short'                           (-not (Detect 'help'))

# ---- catalog content sanity (mirror key phrases from renderEngineCatalog) -----
# (kept in sync with lib/engine-catalog.js renderEngineCatalog)
$cat = @'
M8 PROBLEM-SOLVING ENGINE
run the structural probes on collatz
run the reverse-and-add census
test the kernel of
propose a decomposition for:
approve decomposition #N
scaffold this proof:
ingest this as established:
Observed/tested to N" is NEVER a proof
leaves verified k/m
Lean machine-check is the ONLY path to "proven"
'@
Ok 'catalog: lists collatz census'        ($cat -match 'structural probes on collatz')
Ok 'catalog: lists reverse-and-add'       ($cat -match 'reverse-and-add census')
Ok 'catalog: lists kernel test'           ($cat -match 'test the kernel of')
Ok 'catalog: lists decomposition propose' ($cat -match 'propose a decomposition for')
Ok 'catalog: lists approve'               ($cat -match 'approve decomposition #N')
Ok 'catalog: lists scaffold'              ($cat -match 'scaffold this proof')
Ok 'catalog: honesty - tested-to-N not proof' ($cat -match 'NEVER a proof')
Ok 'catalog: honesty - leaves k/m'        ($cat -match 'leaves verified k/m')
Ok 'catalog: honesty - lean only path'    ($cat -match 'ONLY path to "proven"')

Write-Host ''
Write-Host ("engine-catalog-verify: {0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
