# tests/build164_semantic_router.test.ps1
# PS-5.1 MIRROR of Build-164 lib/semantic-router.js (the SHADOW-ONLY semantic router)
# and its orchestrator wire. Node is absent on the host, so this test:
#   (1) re-implements cosine() in PowerShell and asserts the math on known vectors
#       (identical / orthogonal / opposite / 45deg / scale-invariant / bad input);
#   (2) STATICALLY parses lib/semantic-router.js + lib/capability-registry.js to prove
#       the EXEMPLARS map covers EVERY domain with NO empty list;
#   (3) proves the orchestrator wire reads nothing back under M8_SEMANTIC_ROUTER alone:
#       gated on M8_SEMANTIC_ROUTER === "1", logs lane "sem:"+domain, never touches arb/crud,
#       and reassigns lookup ONLY behind the SEPARATE B-166 M8_SEMANTIC_FLIP flag (so the
#       shadow path -> flag-OFF is byte-for-byte pre-164, flag-ON is +1 log row);
#   (4) proves the FAIL-SAFE contract: cosine returns 0 on bad input (logic) and
#       scoreSemantic try/catch-returns null (static).
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
$regFile = Join-Path $root 'lib\capability-registry.js'
$orcFile = Join-Path $root 'lib\orchestrator.js'

foreach ($f in @($semFile, $regFile, $orcFile)) {
  if (-not (Test-Path $f)) { Write-Host ("  FAIL  missing file: " + $f); exit 1 }
}
$sem = [IO.File]::ReadAllText($semFile, [Text.Encoding]::UTF8)
$reg = [IO.File]::ReadAllText($regFile, [Text.Encoding]::UTF8)
$orc = [IO.File]::ReadAllText($orcFile, [Text.Encoding]::UTF8)

# ---------------------------------------------------------------------------------------
Write-Host "[1] cosine math (PS mirror of lib/semantic-router.js cosine)"
function Cosine($a, $b) {
  if (($null -eq $a) -or ($null -eq $b)) { return 0.0 }
  if (($a.Length -eq 0) -or ($a.Length -ne $b.Length)) { return 0.0 }
  $dot = 0.0; $na = 0.0; $nb = 0.0
  for ($i = 0; $i -lt $a.Length; $i++) {
    $x = [double]$a[$i]; $y = [double]$b[$i]
    $dot += $x * $y; $na += $x * $x; $nb += $y * $y
  }
  if (($na -eq 0) -or ($nb -eq 0)) { return 0.0 }
  return [double]($dot / ([Math]::Sqrt($na) * [Math]::Sqrt($nb)))
}
function Near([double]$a, [double]$b) { return ([Math]::Abs($a - $b) -lt 1e-9) }

Check "identical vectors -> 1"        (Near (Cosine @(1.0,0.0,0.0) @(1.0,0.0,0.0)) 1.0)
Check "orthogonal vectors -> 0"       (Near (Cosine @(1.0,0.0)     @(0.0,1.0))     0.0)
Check "opposite vectors -> -1"        (Near (Cosine @(1.0,0.0)     @(-1.0,0.0))   -1.0)
Check "45 degrees -> 1/sqrt(2)"       (Near (Cosine @(1.0,0.0)     @(1.0,1.0))    ([double](1.0/[Math]::Sqrt(2.0))))
Check "scale-invariant (norms divide out)" (Near (Cosine @(2.0,0.0) @(0.5,0.0)) 1.0)
Check "bad input: mismatched length -> 0"  (Near (Cosine @(1.0,2.0) @(1.0))   0.0)
Check "bad input: empty -> 0"              (Near (Cosine @()        @())      0.0)
Check "bad input: null -> 0"               (Near (Cosine $null      $null)    0.0)

# ---------------------------------------------------------------------------------------
Write-Host "[2] EXEMPLARS map well-formed (covers every DOMAIN, no empties)"
# DOMAINS from the registry (single source of truth)
$dmBody  = [regex]::Match($reg, 'const DOMAINS\s*=\s*\[(?<b>[^\]]*)\]').Groups['b'].Value
$DOMAINS = @([regex]::Matches($dmBody, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
Check "registry exposes 11 DOMAINS" ($DOMAINS.Count -eq 11)

# EXEMPLARS keys + per-domain exemplar counts from lib/semantic-router.js
$exBody = [regex]::Match($sem, 'const EXEMPLARS\s*=\s*\{(?<body>.*?)\n\};', [Text.RegularExpressions.RegexOptions]::Singleline).Groups['body'].Value
$exemplars = @{}
foreach ($km in [regex]::Matches($exBody, '(?sm)^  (?<k>\w+): \[(?<items>.*?)\]')) {
  $k = $km.Groups['k'].Value
  $cnt = ([regex]::Matches($km.Groups['items'].Value, '"[^"]*"')).Count
  $exemplars[$k] = $cnt
}
Check "EXEMPLARS parsed (>=1 key found)" ($exemplars.Count -ge 1)
foreach ($d in $DOMAINS) {
  $has = $exemplars.ContainsKey($d)
  Check ("domain covered: " + $d) $has
  if ($has) {
    Check ("domain non-empty: " + $d + " (" + $exemplars[$d] + " exemplars)") ($exemplars[$d] -ge 1)
    if (($exemplars[$d] -lt 6) -or ($exemplars[$d] -gt 10)) {
      Write-Host ("  note  " + $d + " has " + $exemplars[$d] + " exemplars (brief suggests 6-10)")
    }
  }
}

# ---------------------------------------------------------------------------------------
Write-Host "[3] orchestrator wire is SHADOW-ONLY (zero behaviour change)"
Check "guarded by M8_SEMANTIC_ROUTER flag" ($orc.Contains('process.env.M8_SEMANTIC_ROUTER === "1"'))
Check "logs sem:* lane"                    ($orc.Contains('"sem:" + _sem.domain'))

$gi = $orc.IndexOf('M8_SEMANTIC_ROUTER === "1"')
$ri = $orc.IndexOf('return { arb, routedMessage: baseMessage, clarified: false, lookup, crud };', [Math]::Max(0,$gi))
Check "flag guard precedes the resolveDomainRoute return" (($gi -ge 0) -and ($ri -gt $gi))
if (($gi -ge 0) -and ($ri -gt $gi)) {
  $block = $orc.Substring($gi, $ri - $gi)
  Check "shadow block calls scoreSemantic" ($block.Contains('scoreSemantic'))
  Check "shadow block calls logRoute"      ($block.Contains('logRoute'))
  Check "shadow block does NOT reassign arb"    (-not [regex]::IsMatch($block, '\barb\s*='))
  Check "shadow block does NOT reassign crud"   (-not [regex]::IsMatch($block, '\bcrud\s*='))
  # B-166: the block MAY now set lookup, but ONLY behind the NEW M8_SEMANTIC_FLIP flag —
  # the M8_SEMANTIC_ROUTER shadow path itself still reads NOTHING back. Prove the flip flag
  # is present and precedes any lookup assignment, so flag-OFF stays byte-for-byte pre-164.
  $lkM = [regex]::Match($block, '\blookup\s*=')
  $flipIdx = $block.IndexOf('M8_SEMANTIC_FLIP')
  Check "lookup reassigned ONLY behind M8_SEMANTIC_FLIP (flag-OFF = pre-164 shadow)" ((-not $lkM.Success) -or (($flipIdx -ge 0) -and ($lkM.Index -gt $flipIdx)))
  Check "shadow block has its own try/catch (never affects the turn)" ($block.Contains('catch'))
}

# ---------------------------------------------------------------------------------------
Write-Host "[4] fail-safe contract (errors -> null, never throw)"
$ss = [regex]::Match($sem, 'async function scoreSemantic[\s\S]*?\n\}').Value
Check "scoreSemantic has try/catch"          ($ss.Contains('catch'))
Check "scoreSemantic returns null on error"  ($ss.Contains('return null'))
$cs = [regex]::Match($sem, 'function cosine[\s\S]*?\n\}').Value
Check "cosine guards bad input (return 0)"   ($cs.Contains('return 0'))
$ee = [regex]::Match($sem, 'async function embedExemplars[\s\S]*?\n\}').Value
Check "embedExemplars is lazy/idempotent (cache + in-flight guard)" (($sem.Contains('_exemplarCache')) -and ($sem.Contains('_warmInFlight')))
Check "reuses the FREE embedText (no paid provider)" (($sem.Contains('require("./memory-graph")')) -and ($sem.Contains('embedText')))

# ---------------------------------------------------------------------------------------
$total = 0  # informational
Write-Host ""
if ($script:fail -gt 0) {
  Write-Host ("build164 semantic-router mirror: FAIL ({0} check(s) failed)" -f $script:fail)
  exit 1
}
Write-Host "build164 semantic-router mirror: OK (all checks passed)"
exit 0
