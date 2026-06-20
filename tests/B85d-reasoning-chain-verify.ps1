# ============================================================================
# Build-85d: Multi-hop Reasoning Chain — offline verifier (PS 5.1, no Node).
#   powershell -File tests/B85d-reasoning-chain-verify.ps1
#
# Two parts:
#   1) A PowerShell MIRROR of isComplex() (lib/reasoning-chain.js) run over a
#      labeled corpus — the gate must fire on complex why/how/compare questions
#      and stay SILENT on short turns + fleet/finance/compute queries.
#   2) Structural assertions: the module exports the right surface, the model /
#      budget constants are correct, the orchestrator is wired BEFORE the main
#      answer call with the hard gates, and the migration exists.
# Keep the mirror in lockstep with the JS (pure regex; ASCII corpus).
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

$root    = Split-Path -Parent $PSScriptRoot
$libFile = Join-Path $root 'lib\reasoning-chain.js'
$orch    = Join-Path $root 'lib\orchestrator.js'
$mig     = Join-Path $root 'migrations\B85d_reasoning_chains.sql'

# ---- MIRROR of isComplex() -------------------------------------------------
$COMPLEX_RE        = '\b(why|how|compare|difference|explain|between|relationship|cause|result|impact)\b'
$FLEET_FINANCE_RE  = '\b(sar|sr|riyals?|driver|drivers|fleet|courier|ambassador|captain|p&l|pnl|salary|salaries|payout|bonus|profit|revenue|net\s+earnings|rental|rent)\b'
function Test-IsComplex([string]$m) {
  if ($null -eq $m) { return $false }
  if ($m.Length -le 80) { return $false }
  if ($m -imatch $FLEET_FINANCE_RE) { return $false }
  return ($m -imatch $COMPLEX_RE)
}

Write-Host "`n-- isComplex() gate: SHOULD trigger (complex, long, non-fleet) --" -ForegroundColor Cyan
$shouldTrigger = @(
  'Why does compound interest grow so much faster than simple interest over a long period of time?',
  'How do electric vehicle batteries degrade over time, and what factors actually accelerate that wear?',
  'Compare nuclear fission and fusion in terms of fuel, safety, waste, and how close each is to being practical.',
  'Explain the relationship between inflation and unemployment and why economists call it a tradeoff historically.',
  'What is the difference between machine learning and deep learning, and how do they relate to AI more broadly?',
  'How does photosynthesis convert sunlight into chemical energy at the molecular level inside a plant cell?',
  'Why did the Roman Empire decline, and how did internal and external causes combine to produce that result?',
  'Explain how vaccines train the immune system and why some require boosters to stay effective over the years.'
)
foreach ($q in $shouldTrigger) { Ok (Test-IsComplex $q) ("triggers: " + $q.Substring(0, [Math]::Min(48,$q.Length)) + "...") }

Write-Host "`n-- isComplex() gate: should NOT trigger --" -ForegroundColor Cyan
# Short (<= 80 chars) even if it has a trigger word:
Ok (-not (Test-IsComplex 'Why?'))                                         'silent: too short ("Why?")'
Ok (-not (Test-IsComplex 'How are you today my friend?'))                 'silent: short greeting'
Ok (-not (Test-IsComplex 'Compare these two quickly please'))             'silent: 30 chars, has "compare"'
Ok (-not (Test-IsComplex ('x' * 80)))                                     'silent: exactly 80 chars, no trigger'
# Long but no trigger word:
Ok (-not (Test-IsComplex 'Give me a long winded restatement of the same simple greeting again and again here.')) 'silent: long but no trigger word'
# Fleet / finance / compute hard exclusions (long + trigger word, but fleet/finance):
Ok (-not (Test-IsComplex 'Why is driver Ahmed behind his pace this month and how do we get him back on track?')) 'silent: fleet (driver) excluded'
Ok (-not (Test-IsComplex 'Explain how the fleet net profit is computed and why this month differs from last month.')) 'silent: fleet/profit excluded'
Ok (-not (Test-IsComplex 'Compare the SAR payout between the 4000 and 5000 bonus tiers and explain the difference.')) 'silent: SAR/payout/bonus excluded'
Ok (-not (Test-IsComplex 'How much salary impact does adding a new courier have on our revenue and net earnings here?')) 'silent: salary/courier/revenue excluded'
Ok (-not (Test-IsComplex 'Why did the ambassador referral bonus change and how does it compare to the captain rate now?')) 'silent: ambassador/captain/bonus excluded'

Write-Host "`n-- lib/reasoning-chain.js structure --" -ForegroundColor Cyan
Ok (Test-Path $libFile) 'file lib/reasoning-chain.js exists'
$lib = Get-Content $libFile -Raw
Ok ($lib -match 'function isComplex')                  'exports isComplex (sync function)'
Ok ($lib -match 'async function decompose')            'has async decompose'
Ok ($lib -match 'async function answerSubQuestion')    'has async answerSubQuestion'
Ok ($lib -match 'async function synthesize')           'has async synthesize'
Ok ($lib -match 'function logChain')                   'has logChain'
Ok ($lib -match 'async function runChain')             'has async runChain'
Ok ($lib -match "module\.exports[\s\S]*isComplex[\s\S]*runChain") 'module.exports surface includes isComplex + runChain'
Ok ($lib -match 'gemini-2\.5-flash')                   'uses gemini-2.5-flash model'
Ok ($lib -match 'BUDGET_MS\s*=\s*8000')                '8 second latency budget'
Ok ($lib -match 'MAX_SUBQ\s*=\s*4')                    'caps sub-questions at 4'
Ok ($lib -match 'maxOutputTokens:\s*300')              'decompose max 300 tokens'
Ok ($lib -match 'maxOutputTokens:\s*200')              'sub-answer max 200 tokens'
Ok ($lib -match 'maxOutputTokens:\s*600')              'synthesize max 600 tokens'
Ok ($lib -match 'temperature:\s*0\.2')                 'decompose temp 0.2'
Ok ($lib -match 'm8_reasoning_chains')                 'logChain writes m8_reasoning_chains'
Ok ($lib -match 'Therefore')                           'synthesis shows a "Therefore" conclusion'
Ok ($lib -match 'subs\.length\s*<\s*2[\s\S]*return null') 'single-hop decompose => null (fallback)'
Ok ($lib -match 'Date\.now\(\)\s*-\s*t0\s*>\s*BUDGET_MS') 'enforces the budget against elapsed time'
Ok ($lib -match 'isEphemeralSession')                  'skips persistence for eval sessions'

Write-Host "`n-- lib/orchestrator.js wiring --" -ForegroundColor Cyan
$o = Get-Content $orch -Raw
Ok ($o -match "require\(`"\./reasoning-chain`"\)")     'requires ./reasoning-chain'
Ok ($o -match 'Build-85d START')                        'Build-85d START block present'
Ok ($o -match 'Build-85d END')                          'Build-85d END block present'
Ok ($o -match 'isComplex\(effectiveMessage\)')          'gate calls isComplex(effectiveMessage)'
Ok ($o -match '!fleetLike && !financeLike && !computeMode') 'hard gate: no fleet/finance/compute'
Ok ($o -match 'runChain\(effectiveMessage, kgContext, entityCtxForChain, sessionId\)') 'runChain reuses kg + entity context'
Ok ($o -match 'skipMainCall\s*=\s*true')                'sets skipMainCall on chain success'
Ok ($o -match 'if \(skipMainCall\)')                    'main answer call bypassed when skipMainCall'
Ok ($o -match 'let entityCtxForChain = null')           'entityCtx hoisted for the chain'
# The chain block must sit BEFORE the main generate() call.
$idxChain = $o.IndexOf('Build-85d START')
$idxGen   = $o.IndexOf('response = await generate(')
Ok ($idxChain -gt 0 -and $idxGen -gt 0 -and $idxChain -lt $idxGen) 'chain wired BEFORE the main generate() call'

Write-Host "`n-- migration --" -ForegroundColor Cyan
Ok (Test-Path $mig) 'migrations/B85d_reasoning_chains.sql exists'
$ms = Get-Content $mig -Raw
Ok ($ms -match 'CREATE TABLE m8_reasoning_chains')      'creates m8_reasoning_chains table'
Ok ($ms -match 'steps jsonb')                           'steps column is jsonb'
Ok ($ms -match 'final_answer text')                     'final_answer column'
Ok ($ms -match 'CREATE INDEX ON m8_reasoning_chains\(session_id\)') 'session_id index'

Write-Host ""
$resultColor = 'Green'; if ($script:fail -gt 0) { $resultColor = 'Red' }
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor $resultColor
if ($script:fail -gt 0) { exit 1 }
