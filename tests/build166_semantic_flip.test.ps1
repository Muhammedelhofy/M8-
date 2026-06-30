# tests/build166_semantic_flip.test.ps1
# PS-5.1 MIRROR of Build-166 — the SEMANTIC FLIP (tie-breaker) wired into
# lib/orchestrator.js resolveDomainRoute behind the NEW flag M8_SEMANTIC_FLIP.
# Node is absent on the host, so this test:
#   (1) PARSES the flip thresholds out of lib/semantic-router.js (FLIP_CONF / FLIP_MARGIN /
#       FLIP_SAFE_DOMAINS) and asserts they are the STRICT values set from the B-164 shadow
#       data (0.85 / 0.15 / {knowledge, web, memory}) — a drift trips this check;
#   (2) re-implements shouldFlip() in PowerShell (USING the parsed values) and drives a
#       TRUTH TABLE built from the REAL shadow rows (m8_router_misses, lane arbiter:sem:%):
#       the lone true fix "kafala" (knowledge 0.94/0.28) ADOPTS; every safe-lane false
#       positive (knowledge 0.62/0.01, memory 0.69/0.04) is REJECTED; boundary cases;
#   (3) mirrors the FULL orchestrator gate (flag ON + det-UNSURE + !lookup + shouldFlip) and
#       proves: flag OFF = no-op; a det clear-win never flips; a lookup already attached is
#       never overridden; and MONEY lanes (wallet/fleet/finance) are NEVER adopted even at
#       absurd confidence (money-safety stays on the B-152 arbiter);
#   (4) STATICALLY proves the orchestrator wire: the flip is guarded by M8_SEMANTIC_FLIP,
#       lives inside the !_clearWin cost guard + the shadow try/catch (fail-safe), assigns
#       ONLY `lookup` (never arb) via the B-156 channel with why="semantic_flip" and a
#       !lookup no-override guard, and logs a distinct "sem-flip:" lane.
#
# "PASS" = every check passes (exit 0). Any FAIL -> exit 1.

$ErrorActionPreference = 'Stop'
$script:fail = 0
function Check([string]$name, [bool]$cond) {
  if ($cond) { Write-Host ("  PASS  " + $name) }
  else { Write-Host ("  FAIL  " + $name); $script:fail = $script:fail + 1 }
}

$root    = Split-Path $PSScriptRoot -Parent
$semFile = Join-Path $root 'lib\semantic-router.js'
$orcFile = Join-Path $root 'lib\orchestrator.js'
foreach ($f in @($semFile, $orcFile)) {
  if (-not (Test-Path $f)) { Write-Host ("  FAIL  missing file: " + $f); exit 1 }
}
$sem = [IO.File]::ReadAllText($semFile, [Text.Encoding]::UTF8)
$orc = [IO.File]::ReadAllText($orcFile, [Text.Encoding]::UTF8)

# ---------------------------------------------------------------------------------------
Write-Host "[1] flip thresholds parsed from lib/semantic-router.js (data-derived, STRICT)"
$mConf   = [regex]::Match($sem, 'const\s+FLIP_CONF\s*=\s*([0-9.]+)')
$mMargin = [regex]::Match($sem, 'const\s+FLIP_MARGIN\s*=\s*([0-9.]+)')
$mSafe   = [regex]::Match($sem, 'const\s+FLIP_SAFE_DOMAINS\s*=\s*Object\.freeze\(\[(?<b>[^\]]*)\]\)')
Check "FLIP_CONF parsed"   ($mConf.Success)
Check "FLIP_MARGIN parsed" ($mMargin.Success)
Check "FLIP_SAFE_DOMAINS parsed" ($mSafe.Success)
$FLIP_CONF   = if ($mConf.Success)   { [double]$mConf.Groups[1].Value }   else { -1.0 }
$FLIP_MARGIN = if ($mMargin.Success) { [double]$mMargin.Groups[1].Value } else { -1.0 }
$SAFE = @()
if ($mSafe.Success) { $SAFE = @([regex]::Matches($mSafe.Groups['b'].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }) }

Check "FLIP_CONF == 0.85 (true fix kafala=0.94 captured; max safe-lane FP=0.69 excluded)"   ([Math]::Abs($FLIP_CONF - 0.85) -lt 1e-9)
Check "FLIP_MARGIN == 0.15 (true fix margin=0.28 captured; max safe-lane FP margin=0.04 excluded)" ([Math]::Abs($FLIP_MARGIN - 0.15) -lt 1e-9)
Check "FLIP_SAFE_DOMAINS == {knowledge, web, memory}" (($SAFE.Count -eq 3) -and ($SAFE -contains 'knowledge') -and ($SAFE -contains 'web') -and ($SAFE -contains 'memory'))
Check "FLIP_SAFE_DOMAINS excludes wallet/fleet/finance (money-safety lanes)" (($SAFE -notcontains 'wallet') -and ($SAFE -notcontains 'fleet') -and ($SAFE -notcontains 'finance'))
Check "FLIP_SAFE_DOMAINS excludes write lanes (docs/tasks/notes/driver_profile)" (($SAFE -notcontains 'docs') -and ($SAFE -notcontains 'tasks') -and ($SAFE -notcontains 'notes') -and ($SAFE -notcontains 'driver_profile'))

# ---------------------------------------------------------------------------------------
Write-Host "[2] shouldFlip() truth table (PS mirror, USING the parsed thresholds)"
# Mirror of lib/semantic-router.js shouldFlip(sem): SAFE-lane AND conf>=T AND margin>=M.
function Test-ShouldFlip([string]$domain, [double]$conf, [double]$margin) {
  if ([string]::IsNullOrEmpty($domain)) { return $false }
  if ($SAFE -notcontains $domain) { return $false }
  return (($conf -ge $FLIP_CONF) -and ($margin -ge $FLIP_MARGIN))
}
# --- REAL shadow rows (m8_router_misses, 2026-06-29->30) ---
Check "REAL true fix: kafala knowledge 0.94/0.28 -> ADOPT"          (Test-ShouldFlip 'knowledge' 0.94 0.28)
Check "REAL false-pos: 'queue...confirm' knowledge 0.62/0.01 -> NO" (-not (Test-ShouldFlip 'knowledge' 0.62 0.01))
Check "REAL false-pos: 'why did sara spend' memory 0.69/0.04 -> NO" (-not (Test-ShouldFlip 'memory' 0.69 0.04))
# --- boundary (inclusive >=) ---
Check "boundary: web exactly 0.85/0.15 -> ADOPT (>= inclusive)"     (Test-ShouldFlip 'web' 0.85 0.15)
Check "just below conf: knowledge 0.84/0.20 -> NO"                  (-not (Test-ShouldFlip 'knowledge' 0.84 0.20))
Check "just below margin: knowledge 0.90/0.14 -> NO"                (-not (Test-ShouldFlip 'knowledge' 0.90 0.14))
Check "high conf, thin margin: memory 0.99/0.10 -> NO"              (-not (Test-ShouldFlip 'memory' 0.99 0.10))
# --- MONEY lanes NEVER adopted, even at absurd confidence (money-safety on the arbiter) ---
Check "money: wallet 0.79/0.11 (real high) -> NO (domain excluded)" (-not (Test-ShouldFlip 'wallet' 0.79 0.11))
Check "money: wallet 0.99/0.99 -> NO (domain excluded)"             (-not (Test-ShouldFlip 'wallet' 0.99 0.99))
Check "money: fleet  0.99/0.99 -> NO (domain excluded)"             (-not (Test-ShouldFlip 'fleet'  0.99 0.99))
Check "money: finance 0.99/0.99 -> NO (domain excluded)"            (-not (Test-ShouldFlip 'finance' 0.99 0.99))
# --- write lanes NEVER adopted ---
Check "write: docs 0.99/0.99 -> NO"     (-not (Test-ShouldFlip 'docs' 0.99 0.99))
Check "write: tasks 0.99/0.99 -> NO"    (-not (Test-ShouldFlip 'tasks' 0.99 0.99))
Check "write: notes 0.99/0.99 -> NO"    (-not (Test-ShouldFlip 'notes' 0.99 0.99))
Check "chat 0.99/0.99 -> NO"            (-not (Test-ShouldFlip 'chat'  0.99 0.99))
Check "empty domain -> NO"              (-not (Test-ShouldFlip '' 0.99 0.99))

# ---------------------------------------------------------------------------------------
Write-Host "[3] FULL orchestrator gate (flag ON + det-UNSURE + override empty/inert-memory + shouldFlip)"
# Mirror of the orchestrator condition:
#   M8_SEMANTIC_FLIP==="1" && (inside !_clearWin) && shouldFlip(_sem) && (!lookup || lookup.domain==="memory")
# $existingLookup = the lookup the B-156 registry block already attached this turn ('' = none).
function Test-FlipGate([bool]$flagOn, [bool]$clearWin, [string]$existingLookup, [string]$domain, [double]$conf, [double]$margin) {
  if (-not $flagOn) { return $false }   # flag OFF = no-op (byte-for-byte B-164)
  if ($clearWin)    { return $false }   # det SURE -> _sem never computed -> no flip
  # override ONLY an empty lookup or the INERT telemetry-only `memory` attach; NEVER an
  # ACTING B-156 knowledge/web lookup (a missed fix is fine; a wrong override is not).
  if ((-not [string]::IsNullOrEmpty($existingLookup)) -and ($existingLookup -ne 'memory')) { return $false }
  return (Test-ShouldFlip $domain $conf $margin)
}
Check "kafala, flag ON, det-unsure, NO prior lookup -> FLIP"                       (Test-FlipGate $true  $false ''          'knowledge' 0.94 0.28)
Check "kafala, B-156 pre-attached memory (REAL prod state) -> FLIP (override inert)" (Test-FlipGate $true  $false 'memory'    'knowledge' 0.94 0.28)
Check "kafala, flag OFF -> NO-OP"                                                  (-not (Test-FlipGate $false $false ''        'knowledge' 0.94 0.28))
Check "kafala, det CLEAR-WIN -> NO (sem never computed)"                           (-not (Test-FlipGate $true  $true  ''        'knowledge' 0.94 0.28))
Check "B-156 attached ACTING knowledge -> NO override (already on KG path)"        (-not (Test-FlipGate $true  $false 'knowledge' 'knowledge' 0.94 0.28))
Check "B-156 attached ACTING web -> NO override (web search stays)"                (-not (Test-FlipGate $true  $false 'web'       'knowledge' 0.94 0.28))
Check "wallet high-conf, flag ON, det-unsure -> NO (money safe)"                   (-not (Test-FlipGate $true  $false ''        'wallet' 0.99 0.99))
Check "fleet high-conf, flag ON, det-unsure -> NO (money safe)"                    (-not (Test-FlipGate $true  $false ''        'fleet'  0.99 0.99))

# ---------------------------------------------------------------------------------------
Write-Host "[4] orchestrator wire is correct + fail-safe (static)"
Check "NEW flag M8_SEMANTIC_FLIP gates the flip" ($orc.Contains('process.env.M8_SEMANTIC_FLIP === "1"'))
Check "flip uses the shared shouldFlip() predicate" ($orc.Contains('shouldFlip(_sem)'))
Check "flip imports shouldFlip from semantic-router" ($orc.Contains('{ scoreSemantic, shouldFlip }'))
Check "flip overrides only empty/inert-memory lookup, never an acting one" ($orc.Contains('!lookup || lookup.domain === "memory"'))
Check "flip attaches via the B-156 lookup channel (why=semantic_flip)" ($orc.Contains('why: "semantic_flip"'))
Check "flip logs a distinct sem-flip:* lane" ($orc.Contains('"sem-flip:" + _sem.domain'))

# the flip must live INSIDE the !_clearWin cost guard AND the shadow try/catch (fail-safe),
# and must NOT reassign arb/crud (money-safety + last-CRUD lanes untouched).
$gi = $orc.IndexOf('M8_SEMANTIC_ROUTER === "1"')
$ri = $orc.IndexOf('return { arb, routedMessage: baseMessage, clarified: false, lookup, crud };', [Math]::Max(0,$gi))
Check "semantic block located" (($gi -ge 0) -and ($ri -gt $gi))
if (($gi -ge 0) -and ($ri -gt $gi)) {
  $block = $orc.Substring($gi, $ri - $gi)
  $cwIdx   = $block.IndexOf('!_clearWin')
  $flipIdx = $block.IndexOf('M8_SEMANTIC_FLIP')
  $lkIdx   = [regex]::Match($block, '\blookup\s*=').Index
  Check "flip is INSIDE the !_clearWin cost guard (det-unsure only)" (($cwIdx -ge 0) -and ($flipIdx -gt $cwIdx))
  Check "flip flag precedes the lookup assignment" (($flipIdx -ge 0) -and ($lkIdx -gt $flipIdx))
  Check "block has its own try/catch (fail-safe: error -> pre-flip)" ($block.Contains('catch'))
  Check "flip does NOT reassign arb (money-safety stays on the B-152 arbiter)" (-not [regex]::IsMatch($block, '\barb\s*='))
  Check "flip does NOT reassign crud (B-159 last-CRUD lanes untouched)" (-not [regex]::IsMatch($block, '\bcrud\s*='))
}

# semantic-router exports the gate + thresholds (single source of truth)
Check "semantic-router exports shouldFlip" ($sem.Contains('shouldFlip,'))
Check "shouldFlip uses FLIP_CONF + FLIP_MARGIN + FLIP_SAFE_DOMAINS" `
      (($sem -match 'FLIP_SAFE_DOMAINS\.indexOf') -and ($sem.Contains('>= FLIP_CONF')) -and ($sem.Contains('>= FLIP_MARGIN')))

# ---------------------------------------------------------------------------------------
Write-Host ""
if ($script:fail -gt 0) {
  Write-Host ("build166 semantic-flip mirror: FAIL ({0} check(s) failed)" -f $script:fail)
  exit 1
}
Write-Host "build166 semantic-flip mirror: OK (all checks passed)"
exit 0
