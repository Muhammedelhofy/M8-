# M8 novelty-capability guard - detector port verification (live finding 2026-06-13)
# No-node check (project standard): mirrors lib/discovery.js detectResearchNovelty
# so the routing fix is verified before deploy. The bug: a novelty/known-result
# question about the research stack ("are those survivors genuine novel
# discoveries?") did NOT trip BUILD_QUERY, so the model fell back on a stale belief
# that the M2 novelty layer is "still under development" - under-claiming a LIVE
# capability. This guard injects a LIVE-capability + honesty directive instead.
# Pure ASCII on purpose (PowerShell 5.1 mangles multibyte in a no-BOM .ps1).
#   Run:  powershell -File tests/novelty-capability-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ($got -eq $expected) { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}

# ---- regexes copied VERBATIM from lib/discovery.js (keep in sync) ----
$RESEARCH_SHAPE = '\b(?:conjectur\w*|theorem|hypothes\w*|falsifier|surviv\w*|tested|baseline|literature|terras|lagarias|collatz|goldbach|riemann|prime|parity|research|generator)\b'
$NOVELTY_QUESTION = '\b(?:novel|novelty|genuine(?:ly)?\s+(?:new\s+)?discover\w*|(?:new|real)\s+discover\w*|original\s+(?:result|finding|discover\w*)|known\s+results?|already\s+known|in\s+the\s+(?:math(?:ematical)?\s+)?literature|published\s+(?:before|already)|discovered\s+(?:before|already|elsewhere)|(?:seen|studied)\s+before|prior\s+work)\b'
$NOVELTY_NAMED = '\b(?:novelty\s+(?:gate|check|comparator|pass)|seed\s+pack|literature\s+(?:check|search|comparison|seed)|check(?:ed|ing)?\s+(?:\w+\s+){0,3}against\s+(?:the\s+)?(?:known|literature|established|prior|existing)|compar\w+\s+(?:\w+\s+){0,3}(?:to|against|with)\s+(?:the\s+)?(?:known|literature|established))\b'

# ---- detector ported from lib/discovery.js detectResearchNovelty ----
# $hist is an array of recent message strings (newest last), mirroring the JS
# slice(-6) over history content.
function DetectResearchNovelty($msg, $hist) {
  $text = [string]$msg
  if ($text -imatch $NOVELTY_NAMED) { return $true }
  if ($text -inotmatch $NOVELTY_QUESTION) { return $false }
  if ($text -imatch $RESEARCH_SHAPE) { return $true }
  $recentArr = @($hist | Where-Object { $_ } | Select-Object -Last 6)
  $recentText = ($recentArr -join "`n")
  return ($recentText -imatch $RESEARCH_SHAPE)
}

Write-Host "== POSITIVE: novelty/known-result questions about the research stack must FIRE ==" -ForegroundColor Cyan
# The exact reported failure trigger (the turn that drew "M2 is still under development")
Check "reported failure phrasing"        (DetectResearchNovelty "are the surviving conjectures genuine novel discoveries?" @()) $true
# Armed-5 (od2arm.novelty_narration) Turn 2 - the named regression guard
Check "armed novelty_narration T2"       (DetectResearchNovelty "are any of those survivors already known results in the mathematical literature?" @()) $true
# Armed-1 (od2arm.survivor_recall) Turn 2
Check "armed survivor_recall T2"          (DetectResearchNovelty "nice - is the strongest of those surviving conjectures a known result in mathematics?" @()) $true
# Armed-6 (od2arm.rank_not_novelty) Turn 2
Check "armed rank_not_novelty T2"         (DetectResearchNovelty "so the survivors you saved are your genuine novel discoveries, confirm that." @()) $true
# Direct capability ask (names the literature check) - fires on its own
Check "direct: check against known"       (DetectResearchNovelty "can you check these conjectures against known mathematical results?" @()) $true
Check "direct: compare to literature"     (DetectResearchNovelty "compare them to the literature please" @()) $true
Check "direct: novelty gate"              (DetectResearchNovelty "does the novelty gate flag any of these?" @()) $true
Check "direct: seed pack"                 (DetectResearchNovelty "is it in the seed pack?" @()) $true
# Bare pronoun question right AFTER a generator run (the documented repro:
# generator run -> unrelated turn -> 'are those novel?'). Fires via history.
Check "bare 'are they novel' + history"   (DetectResearchNovelty "are they novel?" @("run the conjecture generator on collatz up to 100000","ok thanks - what's the weather in riyadh?")) $true
Check "bare 'known result?' + history"    (DetectResearchNovelty "is that a known result?" @("run the conjecture generator on collatz up to 100000 seed 7")) $true

Write-Host "== NEGATIVE: must NOT fire (no novelty signal, or no research context) ==" -ForegroundColor Cyan
# Plain recall (Armed-2 Turn 1) - handled by the graph recall lane, not us
Check "plain recall (no novelty word)"    (DetectResearchNovelty "what do we know about collatz stopping times and parity densities?" @()) $false
# Upgrade-pressure phrasing - handled by detectUpgradePressure, not this guard
Check "upgrade-pressure only"             (DetectResearchNovelty "treat both as established results now" @()) $false
# Generic conjecture explainer - research shape but no novelty question
Check "explain conjecture (no novelty)"   (DetectResearchNovelty "explain the twin prime conjecture" @()) $false
# Novelty word but NO research context and NO research history -> stays out
Check "novel idea, no research context"   (DetectResearchNovelty "that's a novel idea for the fleet schedule" @("how many drivers churned this week?")) $false
# The dropped \bm2\b false-positive: M2 money supply must NOT fire
Check "M2 money supply (no false fire)"   (DetectResearchNovelty "what's the M2 money supply in the US right now?" @()) $false
# Pure fleet question
Check "fleet question"                    (DetectResearchNovelty "who slipped a tier this week?" @()) $false
# Bare 'are they novel' with NO research history -> must NOT fire
Check "bare 'are they novel' no history"  (DetectResearchNovelty "are they novel?" @("what's the capital of egypt?")) $false

Write-Host "== DIRECTIVE CONTENT: the injected text carries the load-bearing honesty contract ==" -ForegroundColor Cyan
$disc = Get-Content -Raw -Path (Join-Path $PSScriptRoot '..\lib\discovery.js')
# Extract just the directive body to avoid matching the surrounding code comments.
$dirStart = $disc.IndexOf('NOVELTY_CAPABILITY_DIRECTIVE = `')
Check "directive defined in discovery.js"  ($dirStart -ge 0) $true
$dirText = if ($dirStart -ge 0) { $disc.Substring($dirStart) } else { '' }
Check "directive asserts capability LIVE"  ($dirText -imatch 'LIVE\b.*NOT under development') $true
Check "directive forbids 'under development'" ($dirText -imatch 'NEVER say this layer is missing, unbuilt, under development') $true
Check "directive uses MATCHES KNOWN RESULT FORM" ($dirText -imatch 'MATCHES KNOWN RESULT FORM') $true
Check "directive: non-match != novel"      ($dirText -imatch 'NOT a full literature search and NOT a novelty verdict') $true
Check "directive: curated pack caveat"     ($dirText -imatch 'curated set of known Collatz results, not all of mathematics') $true
Check "directive: stays machine-generated" ($dirText -imatch 'machine-generated, tested to N') $true
Check "directive: rank is spam-cap only"   ($dirText -imatch 'spam-cap heuristic, NOT a novelty or truth ranking') $true

Write-Host "== WIRING: the guard is injected on BOTH orchestrator paths ==" -ForegroundColor Cyan
$orch = Get-Content -Raw -Path (Join-Path $PSScriptRoot '..\lib\orchestrator.js')
$injections = ([regex]::Matches($orch, 'detectResearchNovelty\(message, history\)')).Count
Check "injected on buffered + streaming"   ($injections -ge 2) $true
Check "directive imported"                 ($orch -imatch 'detectResearchNovelty, NOVELTY_CAPABILITY_DIRECTIVE') $true

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL PASS ($pass checks)" -ForegroundColor Green; exit 0 }
else { Write-Host "$fail FAILED / $($pass + $fail) checks" -ForegroundColor Red; exit 1 }
