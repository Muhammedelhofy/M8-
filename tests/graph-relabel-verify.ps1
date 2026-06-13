# graph-relabel-verify.ps1 -- Build-15 follow-up: relabelNodes() decision mirror.
# The one-time backfill re-derives a node's DISPLAY label from its content via
# smartTruncate, repairing pre-fix dumb-truncated labels ("...10" for "10,000").
# The LOAD-BEARING property tested here is the SCOPE GUARD: it must rewrite ONLY
# nodes whose label is a literal prefix of content (the content.slice(0,160)
# signature) and NEVER touch extraction paraphrases, curated LITERATURE titles,
# entity summaries or thread anchors. Pure ASCII (no-BOM .ps1 -> PS 5.1 ANSI):
# every non-ASCII char is built from [char]0xXXXX at runtime, never a literal.

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}

$ELL = [char]0x2026

# --- PS mirror of smartTruncate (lib/memory-graph.js) ---
function SmartTruncate([string]$s, [int]$max) {
  $str = ("$s").Trim()
  if ($str.Length -le $max) { return $str }
  $cut = $max
  $between = { param($i) ($i -ge 0 -and $i -lt $str.Length -and $str[$i] -match '\S') }
  if ((& $between ($cut - 1)) -and (& $between $cut)) {
    $sp = $str.LastIndexOf(" ", $cut)
    if ($sp -gt [math]::Floor($max * 0.6)) {
      $cut = $sp
    } else {
      while ($cut -gt 0 -and ("$($str[$cut-1])" -match '[\d.,]') -and ("$($str[$cut])" -match '[\d.,]')) { $cut-- }
    }
  }
  return ($str.Substring(0, $cut) -replace '[\s,.;:]+$','') + $ELL
}

# --- PS mirror of normLabel (lib/memory-graph.js). The two char-classes with
#     non-ASCII members are assembled from [char] codes so the SOURCE stays ASCII:
#     quote-strip = ' " ` U+2019 ; keep-range allows Arabic U+0600..U+06FF. ---
$QUOTE_CLS = "[" + [char]0x27 + [char]0x22 + [char]0x60 + [char]0x2019 + "]"
$KEEP_NEG  = "[^a-z0-9" + [char]0x0600 + "-" + [char]0x06FF + "]+"
function NormLabel([string]$s) {
  $x = ("$s").ToLower().Trim()
  $x = $x -replace $QUOTE_CLS, ''
  $x = $x -replace $KEEP_NEG, '-'
  $x = $x -replace '^-+','' -replace '-+$',''
  $x = $x -replace '-{2,}','-'
  if ($x.Length -gt 160) { $x = $x.Substring(0,160) }
  return $x
}

# --- PS mirror of the per-node decision inside relabelNodes (pre-collision) ---
# returns @{ action = 'skip-no-content'|'skip-already-ok'|'skip-not-prefix'|'change'; newLabel = ... }
$BARE_TRAIL = "[" + $ELL + '\s]+$'    # strip a trailing ellipsis or whitespace
function RelabelDecision($label, $content, [int]$max) {
  if ($null -eq $content) { return @{ action = 'skip-no-content' } }
  $ct = ("$content").Trim()
  if ($ct.Length -eq 0) { return @{ action = 'skip-no-content' } }
  $new = SmartTruncate $ct $max
  if ($new -ceq "$label") { return @{ action = 'skip-already-ok' } }
  $bare = ("$label") -replace $BARE_TRAIL, ''
  if ($bare.Length -eq 0 -or $ct.Length -le $bare.Length -or -not $ct.StartsWith($bare)) {
    return @{ action = 'skip-not-prefix' }
  }
  return @{ action = 'change'; newLabel = $new }
}

Write-Host "`n== relabel scope guard: only dumb-truncated prefixes change ==" -ForegroundColor Cyan

# A) THE bug: pre-fix label = content.Substring(0,160) that cut INSIDE "10,000".
#    Construct so index 159 is the first digit -> old label ends on a partial.
$contentA = ("x" * 148) + " 2 <= n <= 10,000 and more trailing text to exceed the cap here"
$oldA = $contentA.Substring(0, 160)
$dA = RelabelDecision $oldA $contentA 160
CheckTrue "bug case: action is change" ($dA.action -eq 'change')
CheckTrue "bug case: the OLD label ended on a partial digit (the bug)" ($oldA -match '\d$')
$nlA = $dA.newLabel.TrimEnd($ELL)
CheckTrue "bug case: the NEW label never ends on a digit" ($nlA -notmatch '\d$')

# B) extraction PARAPHRASE: label is a restatement, NOT a prefix of content.
$contentB = "We observed that the total stopping time appears to stay finite for every starting value sampled in this run."
$labelB = "Total stopping time stays finite for all sampled starts"
$dB = RelabelDecision $labelB $contentB 160
CheckTrue "paraphrase label is left untouched (skip-not-prefix)" ($dB.action -eq 'skip-not-prefix')

# C) curated LITERATURE node: title "Author Year: ..."; content starts "[LITERATURE...]".
$contentC = "[LITERATURE -- curated external seed, pack collatz-v1] Terras proved the set of integers with finite total stopping time has natural density one. Source: Terras 1976. Tested bound: n/a."
$labelC = "Terras 1976: almost every integer has finite total stopping time"
$dC = RelabelDecision $labelC $contentC 160
CheckTrue "literature title is left untouched (skip-not-prefix)" ($dC.action -eq 'skip-not-prefix')

# D) thread anchor: content is "Research thread: <slug>"; label is the bare slug.
$contentD = "Research thread: collatz literature"
$labelD = "collatz literature"
$dD = RelabelDecision $labelD $contentD 160
CheckTrue "thread anchor is left untouched (skip-not-prefix)" ($dD.action -eq 'skip-not-prefix')

# E) post-fix node (label already == smartTruncate(content)) -> no-op.
$contentE = ("y" * 200) + " trailing words here"
$correctE = SmartTruncate $contentE 160
$dE = RelabelDecision $correctE $contentE 160
CheckTrue "already-smartTruncated label is a no-op (skip-already-ok)" ($dE.action -eq 'skip-already-ok')

# F) short content, label == content (never truncated) -> no-op.
$contentF = "short conjecture statement"
$dF = RelabelDecision $contentF $contentF 160
CheckTrue "untruncated label equals content (skip-already-ok)" ($dF.action -eq 'skip-already-ok')

# G) missing / blank content -> skip (nothing better to derive from).
$dG1 = RelabelDecision "some label" $null 160
CheckTrue "null content (skip-no-content)" ($dG1.action -eq 'skip-no-content')
$dG2 = RelabelDecision "some label" "   " 160
CheckTrue "blank content (skip-no-content)" ($dG2.action -eq 'skip-no-content')

# H) realistic M1 census: figure is EARLY -> preserved; cut happens later, safely.
$contentH = "Collatz stopping-time census over 2 <= n <= 10,000: max sigma observed, residue-class counts, record-setters table with full detail and extended commentary appended here to exceed the cap"
$oldH = $contentH.Substring(0, 160)
$dH = RelabelDecision $oldH $contentH 160
CheckTrue "M1 census: action is change" ($dH.action -eq 'change')
$nlH = $dH.newLabel.TrimEnd($ELL)
CheckTrue "M1 census: new label keeps the full '10,000' (early figure)" ($nlH -match '10,000')
CheckTrue "M1 census: new label does not end mid-number" ($nlH -notmatch '\d$')

# I) idempotent: feeding the new label back in is a no-op the second time.
$second = RelabelDecision $dA.newLabel $contentA 160
CheckTrue "idempotent: second pass over a fixed label (skip-already-ok)" ($second.action -eq 'skip-already-ok')

# J) the new norm_label is well-formed (lowercase, trimmed of edge dashes, <=160).
$normA = NormLabel $dA.newLabel
CheckTrue "new norm is non-empty" ($normA.Length -gt 0)
CheckTrue "new norm has no leading/trailing dash" (($normA -notmatch '^-') -and ($normA -notmatch '-$'))
CheckTrue "new norm is lowercase" ($normA -ceq $normA.ToLower())
CheckTrue "new norm is <= 160 chars" ($normA.Length -le 160)

Write-Host "`n=================================================="
Write-Host ("  graph-relabel decision guard: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
