# tests/decomp-proposer-verify.ps1
# PS-mirror of lib/decomp-proposer.js pure core (Build-43 Option A).
# No local Node on this box -> verify the deterministic logic via a .NET-regex port:
#   parseDAG (shape) + checkNonDegenerate (anti-degeneracy gate) + serializeDAG
#   round-trip + detectDecompProposal + the [PROPOSED PLAN] render honesty.
# Pure ASCII (PS 5.1 reads no-BOM as ANSI); flat inline loops; case-distinct vars.

$script:pass = 0
$script:fail = 0
function Ok($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else       { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

# ---- mirror: content tokens + Jaccard --------------------------------------
$Stop = @('the','a','an','of','for','to','is','are','be','every','each','all','and','or','that','this','with','by','in','on','its','it','as','at','if','then','so','we','i','you','n','x','k','m')
# tokens are returned as a space-joined STRING to avoid PS array-passing ambiguity.
function ContentTokens($s) {
  $low = ([string]$s).ToLower() -replace '[^a-z0-9\s]', ' '
  $toks = New-Object System.Collections.Generic.List[string]
  foreach ($t in ($low -split '\s+')) { if ($t.Length -gt 0 -and ($Stop -notcontains $t)) { [void]$toks.Add($t) } }
  return ($toks -join ' ')
}
function TokenJaccard($sa, $sb) {
  $A = @{}; foreach ($t in ($sa -split '\s+')) { if ($t.Length -gt 0) { $A[$t] = 1 } }
  $B = @{}; foreach ($t in ($sb -split '\s+')) { if ($t.Length -gt 0) { $B[$t] = 1 } }
  if ($A.Count -eq 0 -or $B.Count -eq 0) { return 0.0 }
  $inter = 0; foreach ($t in $A.Keys) { if ($B.ContainsKey($t)) { $inter++ } }
  $union = $A.Count + $B.Count - $inter
  if ($union -eq 0) { return 0.0 }
  return [double]$inter / [double]$union
}

# ---- mirror: parseDAG (structural) -----------------------------------------
function ParseDAG($message) {
  $s = [string]$message
  $errors = @()
  $tm = [regex]::Match($s, '(?im)^\s*target\s*:\s*(.+?)\s*$')
  $target = ''
  if ($tm.Success) { $target = $tm.Groups[1].Value.Trim() }
  if ($target -eq '') { $errors += 'no target' }

  $lemmas = @()
  $re = [regex]'(?im)^\s*L(\d+)\s*:\s*(.+?)\s*$'
  foreach ($mm in $re.Matches($s)) {
    $idx = [int]$mm.Groups[1].Value
    $body = $mm.Groups[2].Value.Trim()
    $deps = @()
    $dm = [regex]::Match($body, '(?i)\[\s*deps?\s*:\s*([^\]]*)\]\s*$')
    if ($dm.Success) {
      foreach ($d in [regex]::Matches($dm.Groups[1].Value, '\d+')) { $deps += [int]$d.Value }
      $body = $body.Substring(0, $dm.Index).Trim()
    }
    $lemmas += [pscustomobject]@{ idx = $idx; name = "L$idx"; prose = $body; deps = $deps; is_leaf = ($deps.Count -eq 0) }
  }
  if ($lemmas.Count -eq 0) { $errors += 'no lemma lines' }

  $known = @{}; foreach ($l in $lemmas) { $known[$l.idx] = 1 }
  foreach ($l in $lemmas) {
    foreach ($d in $l.deps) {
      if (-not $known.ContainsKey($d)) { $errors += "L$($l.idx) dangling on L$d" }
      if ($d -eq $l.idx) { $errors += "L$($l.idx) self-dep" }
    }
  }
  # cycle check (DFS)
  if ($errors.Count -eq 0) {
    $byIdx = @{}; foreach ($l in $lemmas) { $byIdx[$l.idx] = $l }
    $state = @{}
    $stack = New-Object System.Collections.Stack
    $cyc = $false
    foreach ($l0 in $lemmas) {
      if (($state[$l0.idx]) -eq 2) { continue }
      $stack.Clear(); $stack.Push(@($l0.idx, 0))
      # iterative DFS to avoid deep recursion
      $path = @{}
      $order = New-Object System.Collections.Generic.List[int]
      $visit = New-Object System.Collections.Stack
      $visit.Push($l0.idx)
      while ($visit.Count -gt 0 -and -not $cyc) {
        $cur = $visit.Peek()
        if (($state[$cur]) -eq $null) { $state[$cur] = 1; $path[$cur] = 1 }
        $advanced = $false
        if ($byIdx.ContainsKey($cur)) {
          foreach ($d in $byIdx[$cur].deps) {
            if ($path.ContainsKey($d) -and ($state[$d] -eq 1)) { $cyc = $true; break }
            if (($state[$d]) -eq $null) { $visit.Push($d); $advanced = $true; break }
          }
        }
        if (-not $advanced) { $state[$cur] = 2; $path.Remove($cur); [void]$visit.Pop() }
      }
      if ($cyc) { break }
    }
    if ($cyc) { $errors += 'cycle' }
  }

  $leaves = @(); foreach ($l in $lemmas) { if ($l.is_leaf) { $leaves += $l.idx } }
  if ($lemmas.Count -gt 0 -and $leaves.Count -eq 0 -and $errors.Count -eq 0) { $errors += 'no leaf' }

  return [pscustomobject]@{ ok = ($errors.Count -eq 0); target = $target; lemmas = $lemmas; leaves = $leaves; errors = $errors }
}

# ---- mirror: checkNonDegenerate --------------------------------------------
$TARGET_SIM_MAX = 0.75
$LEAF_DISTINCT_MAX = 0.85
function CheckNonDegenerate($dag) {
  if ($null -eq $dag -or $dag.lemmas.Count -lt 2) { return [pscustomobject]@{ ok = $false; reason = 'fewer than 2 lemmas' } }
  $tgt = ContentTokens $dag.target
  foreach ($l in $dag.lemmas) {
    $sim = TokenJaccard (ContentTokens $l.prose) $tgt
    if ($sim -ge $TARGET_SIM_MAX) { return [pscustomobject]@{ ok = $false; reason = "$($l.name) restates target $sim" } }
  }
  $leaves = @(); foreach ($l in $dag.lemmas) { if ($l.is_leaf) { $leaves += $l } }
  if ($leaves.Count -lt 2) { return [pscustomobject]@{ ok = $false; reason = 'fewer than 2 leaves' } }
  for ($i = 0; $i -lt $leaves.Count; $i++) {
    for ($j = $i + 1; $j -lt $leaves.Count; $j++) {
      $sim2 = TokenJaccard (ContentTokens $leaves[$i].prose) (ContentTokens $leaves[$j].prose)
      if ($sim2 -ge $LEAF_DISTINCT_MAX) { return [pscustomobject]@{ ok = $false; reason = "leaves not distinct $sim2" } }
    }
  }
  return [pscustomobject]@{ ok = $true; reason = '' }
}

# ---- mirror: serializeDAG --------------------------------------------------
function SerializeDAG($dag) {
  $lines = @("target: $($dag.target)")
  foreach ($l in ($dag.lemmas | Sort-Object idx)) {
    $dep = ''
    if ($l.deps.Count -gt 0) { $names = @(); foreach ($d in $l.deps) { $names += "L$d" }; $dep = "  [deps: $($names -join ', ')]" }
    $lines += "$($l.name): $($l.prose)$dep"
  }
  return ($lines -join "`n")
}

# ---- mirror: detectDecompProposal ------------------------------------------
$PROPOSE_RE = [regex]'(?i)\b(?:propose|draft|suggest|sketch|outline|plan|decompose|break\s+(?:down|up))\b[^?.!]{0,40}\b(?:decomposition|attack(?:\s+plan)?|lemma[- ]?dag|sub-?lemmas|proof\s+(?:plan|sketch|strategy|outline|attack)|into\s+(?:sub-?)?lemmas)\b'
$APPROVE_RE = [regex]'(?i)\bapprove\b[^?.!]{0,40}\b(?:decomposition|attack(?:\s+plan)?|plan|lemma[- ]?dag|proposal)\b[^?.!#\d]{0,12}#?\s*(\d+)'
$LEMMA_LINE_RE = [regex]'(?im)^\s*L\d+\s*:'
function Detect($message) {
  $s = ([string]$message).Trim()
  if ($s.Length -lt 6) { return [pscustomobject]@{ mode = $null; id = 0 } }
  $am = $APPROVE_RE.Match($s)
  if ($am.Success) { return [pscustomobject]@{ mode = 'approve'; id = [int]$am.Groups[1].Value } }
  if ($LEMMA_LINE_RE.IsMatch($s)) { return [pscustomobject]@{ mode = $null; id = 0 } }
  if ($PROPOSE_RE.IsMatch($s)) { return [pscustomobject]@{ mode = 'propose'; id = 0 } }
  return [pscustomobject]@{ mode = $null; id = 0 }
}

# ---- mirror: the [PROPOSED PLAN] render footer (verbatim from the module) ----
$FOOTER = 'Honesty: this is a [PROPOSED PLAN], NOT a proof and NOT evidence. M8 drafted this decomposition; nothing has been formalized, machine-checked, or written to the research graph. Approving it only feeds the leaves to the M4 Lean lane -- even if every leaf then verifies, the target stays an OPEN CONJECTURE ("leaves verified k/m", never "% proven").'

# ============================================================================
# CASES
# ============================================================================

# A well-formed, non-degenerate decomposition.
$good = ParseDAG @"
target: Every Collatz orbit reaches 1
L1: For even values the Collatz step halves the input
L2: For odd values 3v+1 produces an even result
L3: Each orbit eventually drops below its starting value  [deps: L1, L2]
"@
Ok 'good DAG parses' ($good.ok)
Ok 'good DAG has 3 lemmas' ($good.lemmas.Count -eq 3)
Ok 'good DAG has 2 leaves' ($good.leaves.Count -eq 2)
$gGate = CheckNonDegenerate $good
Ok 'good DAG passes anti-degeneracy gate' ($gGate.ok)

# Degenerate: L1 restates the target verbatim.
$degen = ParseDAG @"
target: Every Collatz orbit reaches 1
L1: Every Collatz orbit reaches 1
L2: For odd values 3v+1 produces an even result
"@
Ok 'degen DAG parses (shape ok)' ($degen.ok)
$dGate = CheckNonDegenerate $degen
Ok 'degen L1==target REJECTED by gate' (-not $dGate.ok)
Ok 'degen reason names restatement' ($dGate.reason -match 'restates target')

# Single lemma -> rejected (needs >=2 lemmas).
$single = ParseDAG @"
target: Some hard conjecture about primes
L1: A small base fact about primes
"@
$sGate = CheckNonDegenerate $single
Ok 'single-lemma REJECTED' (-not $sGate.ok)

# Only one leaf (a chain) -> rejected (needs >=2 leaves).
$chain = ParseDAG @"
target: A layered statement about sequences
L1: A base fact about sequences
L2: A combined statement  [deps: L1]
"@
Ok 'chain DAG parses' ($chain.ok)
$cGate = CheckNonDegenerate $chain
Ok 'one-leaf chain REJECTED' (-not $cGate.ok)
Ok 'one-leaf reason names leaves' ($cGate.reason -match 'leaves')

# Two identical leaves -> rejected (distinct prose required).
$dupe = ParseDAG @"
target: Every Collatz orbit reaches 1
L1: For even values the Collatz step halves the input
L2: For even values the Collatz step halves the input
"@
$dupeGate = CheckNonDegenerate $dupe
Ok 'duplicate leaves REJECTED' (-not $dupeGate.ok)
Ok 'duplicate reason names distinct' ($dupeGate.reason -match 'distinct')

# Cyclic DAG -> rejected by parser.
$cycle = ParseDAG @"
target: A target with a circular plan
L1: lemma one  [deps: L2]
L2: lemma two  [deps: L1]
"@
Ok 'cyclic DAG rejected by parser' (-not $cycle.ok)
Ok 'cyclic error mentions cycle' (($cycle.errors -join ' ') -match 'cycle')

# Dangling dependency -> rejected by parser.
$dangling = ParseDAG @"
target: A target with a dangling dep
L1: a base lemma
L2: depends on a missing lemma  [deps: L9]
"@
Ok 'dangling DAG rejected by parser' (-not $dangling.ok)
Ok 'dangling error mentions dangling' (($dangling.errors -join ' ') -match 'dangling')

# serializeDAG round-trips back to a parseable, gate-passing DAG.
$ser = SerializeDAG $good
$round = ParseDAG $ser
Ok 'serialize round-trips: parses' ($round.ok)
Ok 'serialize round-trips: same target' ($round.target -eq $good.target)
Ok 'serialize round-trips: same lemma count' ($round.lemmas.Count -eq $good.lemmas.Count)
Ok 'serialize round-trips: gate still passes' ((CheckNonDegenerate $round).ok)

# Detection.
Ok 'detect propose (for: target)' ((Detect 'propose a decomposition for: Every Collatz orbit reaches 1').mode -eq 'propose')
Ok 'detect propose (draft proof plan)' ((Detect 'draft a proof plan for the twin prime conjecture').mode -eq 'propose')
Ok 'detect propose (decompose into sub-lemmas)' ((Detect 'decompose the Collatz conjecture into sub-lemmas').mode -eq 'propose')
Ok 'detect propose (outline a decomposition)' ((Detect 'outline a decomposition of the Collatz conjecture').mode -eq 'propose')
$ap = Detect 'approve decomposition #7'
Ok 'detect approve + id=7' ($ap.mode -eq 'approve' -and $ap.id -eq 7)
$ap2 = Detect 'approve the attack plan #12 please'
Ok 'detect approve attack plan id=12' ($ap2.mode -eq 'approve' -and $ap2.id -eq 12)
Ok 'pasted L<n>: DAG is NOT a propose (scaffold owns it)' ($null -eq (Detect "scaffold this proof: target: X`nL1: a base lemma").mode)
Ok 'test-the-kernel is NOT a propose' ($null -eq (Detect 'test the kernel of vortex math').mode)
Ok 'plain math question is NOT a propose' ($null -eq (Detect 'what is the digital root of 1234').mode)
Ok 'approve with no id does NOT fire' ($null -eq (Detect 'approve the decomposition').mode)

# Render honesty (the [PROPOSED PLAN] framing never claims the target proven).
Ok 'footer carries [PROPOSED PLAN]' ($FOOTER -match '\[PROPOSED PLAN\]')
Ok 'footer: NOT a proof' ($FOOTER -match 'NOT a proof')
Ok 'footer: OPEN CONJECTURE' ($FOOTER -match 'OPEN CONJECTURE')
Ok 'footer: leaves verified k/m' ($FOOTER -match 'leaves verified k/m')
Ok 'footer NEVER claims target proven' (-not ($FOOTER -match 'target (is|has been|was) proven'))

# Odysseus-style probe (offline): "is this decomposition a proof of the target?"
# The deterministic packet must answer NO (no proof claim anywhere in the framing).
Ok 'Odysseus: proposal is not narrated as a proof' (($FOOTER -match 'NOT a proof') -and (-not ($FOOTER -match 'proves the target')))

Write-Host ''
Write-Host ("decomp-proposer-verify: {0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
