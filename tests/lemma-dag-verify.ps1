# lemma-dag-verify.ps1 -- Build-18 (M4-manual): PS mirror of the lemma-DAG PURE core
# in lib/lemma-dag.js. Load-bearing properties:
#   (1) parseDAG: leaf = empty deps; detects dangling deps, self-deps, cycles, no
#       target, no lemma -- and is ok:false (nothing formalized) in those cases.
#   (2) computeCounts: "leaves verified k / m" + parents_sorried.
#   (3) leanNamespacesUsed / isQualifyingLeaf: a gate leaf needs lean_verified +
#       induction + >= 2 distinct Mathlib namespaces (BUILD_18_SPEC 0.4).
#   (4) detectLemmaDAG: scaffold needs the L<n>: anchor (won't hijack the single-
#       statement Lean lane or the review queue); view routes; negatives stay null.
#   (5) IRON RULE: even with EVERY leaf verified, the scaffold status is never
#       'proven' -- the target stays an open conjecture (no "% proven", by design).
# Pure ASCII (no-BOM .ps1 -> PS 5.1 ANSI). No DB / no node -- discharge + /check +
# persistence are exercised live (tests/BUILD18_LIVE_TEST.md).

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
$RX = [System.Text.RegularExpressions.RegexOptions]'IgnoreCase, Multiline'

# -- PS mirror of parseDAG --
function ParseDAG([string]$message) {
  $s = "$message"
  $errs = New-Object System.Collections.ArrayList
  $tm = [regex]::Match($s, '^\s*target\s*:\s*(.+?)\s*$', $RX)
  $target = if ($tm.Success) { $tm.Groups[1].Value.Trim() } else { "" }
  if (-not $target) { [void]$errs.Add("no target") }

  $lemmas = New-Object System.Collections.ArrayList
  foreach ($mm in [regex]::Matches($s, '^\s*L(\d+)\s*:\s*(.+?)\s*$', $RX)) {
    $idx = [int]$mm.Groups[1].Value
    $body = $mm.Groups[2].Value.Trim()
    $dm = [regex]::Match($body, '\[\s*deps?\s*:\s*([^\]]*)\]\s*$', 'IgnoreCase')
    $deps = @()
    if ($dm.Success) {
      $deps = @([regex]::Matches($dm.Groups[1].Value, '\d+') | ForEach-Object { [int]$_.Value })
      $body = $body.Substring(0, $dm.Index).Trim()
    }
    [void]$lemmas.Add([pscustomobject]@{ idx=$idx; name="L$idx"; prose=$body; deps=$deps; is_leaf=($deps.Count -eq 0) })
  }
  if ($lemmas.Count -eq 0) { [void]$errs.Add("no lemma") }

  $known = @{}; foreach ($lm in $lemmas) { $known[$lm.idx] = $true }
  foreach ($lm in $lemmas) {
    foreach ($d in $lm.deps) {
      if (-not $known.ContainsKey($d)) { [void]$errs.Add("dangling") }
      if ($d -eq $lm.idx) { [void]$errs.Add("self") }
    }
  }
  if ($errs.Count -eq 0) {
    # cycle detection (Kahn: repeatedly drop nodes whose deps are all dropped)
    $rem = @{}; foreach ($lm in $lemmas) { $rem[$lm.idx] = @($lm.deps) }
    $changed = $true
    while ($changed) {
      $changed = $false
      foreach ($k in @($rem.Keys)) {
        $allGone = $true
        foreach ($d in $rem[$k]) { if ($rem.ContainsKey($d)) { $allGone = $false; break } }
        if ($allGone) { [void]$rem.Remove($k); $changed = $true }
      }
    }
    if ($rem.Count -gt 0) { [void]$errs.Add("cycle") }
  }

  $leaves = @($lemmas | Where-Object { $_.is_leaf } | ForEach-Object { $_.idx })
  if ($lemmas.Count -gt 0 -and $leaves.Count -eq 0 -and $errs.Count -eq 0) { [void]$errs.Add("no leaf") }
  return [pscustomobject]@{ ok=($errs.Count -eq 0); target=$target; lemmas=@($lemmas); leaves=@($leaves); errors=@($errs) }
}

function ComputeCounts($lemmas) {
  $leaves = @($lemmas | Where-Object { $_.is_leaf })
  $lv = @($leaves | Where-Object { $_.lean_status -eq 'lean_verified' })
  $parents = @($lemmas | Where-Object { -not $_.is_leaf })
  return [pscustomobject]@{ leaf_count=$leaves.Count; leaves_verified=$lv.Count; parents_sorried=$parents.Count }
}

function LeanNamespacesUsed([string]$code) {
  $set = New-Object System.Collections.Generic.HashSet[string]
  foreach ($m in [regex]::Matches("$code", '\b([A-Z][A-Za-z0-9]*)\.[A-Za-z]')) { [void]$set.Add($m.Groups[1].Value) }
  return @($set)
}
function IsQualifyingLeaf([string]$status, [string]$code) {
  $hasInd = (("$code" -imatch '\binduction\b') -or ("$code" -imatch "\binduction'\b") -or ("$code" -imatch '\bNat\.rec\b') -or ("$code" -imatch '\brec\s*\('))
  return ($status -eq 'lean_verified' -and $hasInd -and ((LeanNamespacesUsed $code).Count -ge 2))
}
function StatementSignature([string]$code) {
  $c = "$code".Trim(); $i = $c.IndexOf(":=")
  if ($i -gt 0) { return $c.Substring(0, $i).Trim() } else { return $null }
}
function ScaffoldStatus($counts) {
  if ($counts.leaf_count -gt 0 -and $counts.leaves_verified -eq $counts.leaf_count) { return 'leaves_done' }
  return 'open'   # NEVER 'proven'
}

function DetectLemmaDAG([string]$message) {
  $s = "$message".Trim()
  if ($s.Length -lt 6) { return @{ mode = $null } }
  $verb = ($s -imatch '\b(?:scaffold(?:\s+this)?(?:\s+proof)?|lemma[-\s]?dag|decompose\b[^.?!]*\binto\s+lemmas|formaliz(?:e|ing)\s+(?:the\s+)?(?:base\s+)?(?:leaves|lemmas))\b')
  $hasLine = ($s -imatch '(?im)^\s*L\d+\s*:')
  if ($verb -and $hasLine) { return @{ mode = 'scaffold' } }
  if (($s -imatch '\b(?:show|view|display|list|what''?s\s+in)\b[^.?!]*\b(?:proof\s+)?scaffold') -or ($s -imatch '\blemma[-\s]?dag\b')) {
    $idm = [regex]::Match($s, '#(\d+)')
    return @{ mode = 'view'; id = $(if ($idm.Success) { [int]$idm.Groups[1].Value } else { $null }) }
  }
  return @{ mode = $null }
}

Write-Host "`n== parseDAG: structure, leaves, rejection ==" -ForegroundColor Cyan
$good = "scaffold this proof:`ntarget: every n reaches 1`nL1: base case for n=1`nL2: step holds [deps: L1]`nL3: assemble [deps: L1, L2]"
$d = ParseDAG $good
CheckTrue "valid DAG parses ok"                  ($d.ok)
CheckTrue "target captured"                      ($d.target -eq "every n reaches 1")
CheckTrue "3 lemmas parsed"                      ($d.lemmas.Count -eq 3)
CheckTrue "L1 is a leaf (no deps)"               (($d.lemmas | Where-Object { $_.idx -eq 1 }).is_leaf)
CheckTrue "L2 is NOT a leaf (deps: L1)"          (-not ($d.lemmas | Where-Object { $_.idx -eq 2 }).is_leaf)
CheckTrue "L3 deps parsed as [1,2]"             ((($d.lemmas | Where-Object { $_.idx -eq 3 }).deps -join ",") -eq "1,2")
CheckTrue "exactly one leaf (L1)"                ($d.leaves.Count -eq 1 -and $d.leaves[0] -eq 1)
CheckTrue "deps stripped from prose"             (($d.lemmas | Where-Object { $_.idx -eq 2 }).prose -eq "step holds")

CheckTrue "no target -> ok:false"                (-not (ParseDAG "L1: a base lemma").ok)
CheckTrue "no lemma -> ok:false"                 (-not (ParseDAG "target: something").ok)
CheckTrue "dangling dep -> ok:false"             (-not (ParseDAG "target: t`nL1: a`nL2: b [deps: L9]").ok)
CheckTrue "self dep -> ok:false"                 (-not (ParseDAG "target: t`nL1: a [deps: L1]").ok)
CheckTrue "cycle -> ok:false"                    (-not (ParseDAG "target: t`nL1: a [deps: L2]`nL2: b [deps: L1]").ok)

Write-Host "`n== computeCounts: leaves k/m + parents ==" -ForegroundColor Cyan
$lemmas = @(
  [pscustomobject]@{ idx=1; is_leaf=$true;  lean_status='lean_verified' },
  [pscustomobject]@{ idx=2; is_leaf=$false; lean_status='scaffolded' },
  [pscustomobject]@{ idx=3; is_leaf=$false; lean_status='scaffolded' }
)
$c = ComputeCounts $lemmas
CheckTrue "leaf_count=1, leaves_verified=1, parents_sorried=2" ($c.leaf_count -eq 1 -and $c.leaves_verified -eq 1 -and $c.parents_sorried -eq 2)
$lemmas2 = @(
  [pscustomobject]@{ idx=1; is_leaf=$true; lean_status='lean_verified' },
  [pscustomobject]@{ idx=2; is_leaf=$true; lean_status='lean_rejected' }
)
$c2 = ComputeCounts $lemmas2
CheckTrue "2 leaves, 1 verified -> 1/2, 0 parents" ($c2.leaf_count -eq 2 -and $c2.leaves_verified -eq 1 -and $c2.parents_sorried -eq 0)

Write-Host "`n== namespaces + qualifying leaf (gate 0.4) ==" -ForegroundColor Cyan
$indCode = "theorem t (n : Nat) : n + 0 = n := by induction n with | zero => simp | succ k ih => exact Nat.succ_le_succ (Finset.sum_le k)"
CheckTrue "namespaces {Nat, Finset} -> count 2"  ((LeanNamespacesUsed $indCode).Count -eq 2)
CheckTrue "qualifying: verified + induction + 2 ns" (IsQualifyingLeaf 'lean_verified' $indCode)
CheckTrue "NOT qualifying: only 1 namespace"     (-not (IsQualifyingLeaf 'lean_verified' "theorem t (n:Nat):n=n := by induction n <;> simp [Nat.add_comm]"))
CheckTrue "NOT qualifying: no induction"          (-not (IsQualifyingLeaf 'lean_verified' "theorem t : 2+2=4 := by decide"))
CheckTrue "NOT qualifying: only stated (sorry)"  (-not (IsQualifyingLeaf 'lean_stated' $indCode))

Write-Host "`n== Build-18.1: lean_rejected error-line (mirror renderScaffoldPacket) ==" -ForegroundColor Cyan
function ErrorLine($l) {
  if ($l.lean_status -eq 'lean_rejected' -and $l.reason) {
    if ($l.reason -eq 'banned tokens') {
      return "      Lean error: the draft contained a banned token (e.g. ``import``, ``#eval``, ``axiom``) and was rejected before reaching Lean"
    }
    $why = ("$($l.reason)" -replace '\s+', ' ').Trim()
    if ($why.Length -gt 400) { $why = $why.Substring(0, 400) }
    return "      Lean error: $why"
  }
  return $null
}
$rejBanned = [pscustomobject]@{ lean_status='lean_rejected'; reason='banned tokens' }
$rejLean   = [pscustomobject]@{ lean_status='lean_rejected'; reason="unknown identifier `nFinset.sum_range_succ2" }
$verified  = [pscustomobject]@{ lean_status='lean_verified'; reason=$null }
$pendingNoReason = [pscustomobject]@{ lean_status='lean_rejected'; reason=$null }
CheckTrue "banned-tokens reason -> explanatory line"  ((ErrorLine $rejBanned) -match 'banned token')
CheckTrue "lean error text -> shown, newline collapsed" ((ErrorLine $rejLean) -eq "      Lean error: unknown identifier Finset.sum_range_succ2")
CheckTrue "lean_verified -> no error line"            ($null -eq (ErrorLine $verified))
CheckTrue "lean_rejected with no reason -> no line"   ($null -eq (ErrorLine $pendingNoReason))

Write-Host "`n== statementSignature (invalid-shortcut probe input) ==" -ForegroundColor Cyan
CheckTrue "signature stripped at :=" ((StatementSignature "theorem foo (n : Nat) : n + 0 = n := by simp") -eq "theorem foo (n : Nat) : n + 0 = n")
CheckTrue "no := -> null" ($null -eq (StatementSignature "theorem foo : True"))

Write-Host "`n== IRON RULE: all leaves verified is NOT 'proven' ==" -ForegroundColor Cyan
$allVerified = @(
  [pscustomobject]@{ idx=1; is_leaf=$true; lean_status='lean_verified' },
  [pscustomobject]@{ idx=2; is_leaf=$true; lean_status='lean_verified' }
)
$cAll = ComputeCounts $allVerified
$st = ScaffoldStatus $cAll
CheckTrue "all leaves verified -> status 'leaves_done'" ($st -eq 'leaves_done')
CheckTrue "status is NEVER 'proven' (the laundering trap)" ($st -ne 'proven')

Write-Host "`n== detectLemmaDAG: scaffold needs the L<n>: anchor ==" -ForegroundColor Cyan
CheckTrue "scaffold: verb + L-line"              ((DetectLemmaDAG $good).mode -eq 'scaffold')
CheckTrue "scaffold: 'formalize the leaves' + L-line" ((DetectLemmaDAG "formalize the leaves:`nL1: base case").mode -eq 'scaffold')
CheckTrue "view: 'show the proof scaffold'"      ((DetectLemmaDAG "show me the proof scaffold").mode -eq 'view')
$vid = DetectLemmaDAG "show the lemma dag #7"
CheckTrue "view: '#7' captured"                  ($vid.mode -eq 'view' -and $vid.id -eq 7)

# negatives -- must NOT hijack neighbouring lanes
CheckTrue "negative: scaffold verb but NO L-line -> null" ($null -eq (DetectLemmaDAG "scaffold this proof for collatz").mode)
CheckTrue "negative: single-statement Lean ask -> null"   ($null -eq (DetectLemmaDAG "verify in lean that n + 0 = n").mode)
CheckTrue "negative: review-queue ask -> null"            ($null -eq (DetectLemmaDAG "show me the review queue").mode)
CheckTrue "negative: short -> null"                       ($null -eq (DetectLemmaDAG "hi").mode)

Write-Host "`n=================================================="
Write-Host ("  lemma-dag M4-manual: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
