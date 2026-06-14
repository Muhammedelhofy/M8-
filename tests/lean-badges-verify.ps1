# tests/lean-badges-verify.ps1
# Build-23: Lean / M4 lemma-DAG status badges (js/chat.js appendWithLeanBadges).
# PS mirror of the JS regex + segmentation logic (node is not available in this
# shell) -- verifies the pattern set matches the EXACT literal strings emitted
# by lib/lemma-dag.js renderScaffoldPacket() and lib/lean.js narrate()/
# narrateBanned(), with correct per-group CSS class + dedupe behaviour.
#
# ASCII-only file (Write-tool .ps1 = no-BOM UTF-8 -> PS 5.1 reads ANSI): all
# non-ASCII glyphs (checkmark/x-mark/em-dash/half-circle) are built via [char]
# codepoints, and regex patterns use \uXXXX escapes (interpreted by the .NET
# regex engine -- never typed as literal glyphs in this file).

$ErrorActionPreference = "Stop"
$pass = 0
$fail = 0

function Test-True($name, $cond) {
  if ($cond) { $script:pass++; Write-Host "PASS: $name" }
  else       { $script:fail++; Write-Host "FAIL: $name" -ForegroundColor Red }
}

# -- Unicode glyphs used by lib/lemma-dag.js / lib/lean.js, by codepoint ----
$CHK   = [char]0x2713   # checkmark   (U+2713)
$XMARK = [char]0x2717   # ballot X    (U+2717)
$EM    = [char]0x2014   # em dash     (U+2014)
$CIRC  = [char]0x25D1   # half circle (U+25D1)

# -- Pattern table (mirrors LEAN_BADGE_RE / LEAN_BADGE_META in js/chat.js) --
# Regex sources use \uXXXX escapes for the unicode glyphs (interpreted by the
# .NET regex engine; the file itself stays pure ASCII).
$patterns = @(
  @{ re = 'LEAF \u2014 \u2713 Lean-verified \(this leaf only\)';                            cls = 'verified';       label = $null; dedupe = $false }
  @{ re = 'LEAF \u2014 statement type-checks, proof admitted \(sorry\) \u2014 NOT proven';  cls = 'stated';         label = $null; dedupe = $false }
  @{ re = 'LEAF \u2014 \u2717 Lean rejected';                                               cls = 'rejected';       label = $null; dedupe = $false }
  @{ re = 'LEAF \u2014 could not be faithfully formalized \(nothing submitted\)';          cls = 'unformalizable'; label = $null; dedupe = $false }
  @{ re = 'LEAF \u2014 checker cold/slow, not confirmed this turn';                        cls = 'pending';        label = $null; dedupe = $false }
  @{ re = 'PARENT \u2014 scaffolded \(sorry, NOT proven\)';                                cls = 'scaffolded';     label = $null; dedupe = $false }
  @{ re = '\*\*verified\*\*';                                                              cls = 'verified';       label = "$CHK lean_verified";   dedupe = $true }
  @{ re = '\*\*rejected\*\*';                                                              cls = 'rejected';       label = "$XMARK lean_rejected"; dedupe = $true }
  @{ re = '\*\*statement type-checks\*\*';                                                 cls = 'stated';         label = "$CIRC lean_stated";    dedupe = $true }
  @{ re = '`lean_rejected`';                                                               cls = 'rejected';       label = "$XMARK lean_rejected"; dedupe = $true }
)

# Build one combined regex with a capture group per pattern, like the JS source.
$combined = [regex]::new(($patterns | ForEach-Object { "($($_.re))" }) -join '|')

function Get-LeanBadgeSegments([string]$text) {
  $segments = @()
  $lastIndex = 0
  $dedupeSeen = @{}
  foreach ($m in $combined.Matches($text)) {
    $gi = -1
    for ($i = 0; $i -lt $patterns.Count; $i++) {
      if ($m.Groups[$i + 1].Success) { $gi = $i; break }
    }
    if ($gi -eq -1) { continue }
    $meta = $patterns[$gi]
    if ($meta.dedupe -and $dedupeSeen.ContainsKey($meta.label)) { continue }
    if ($m.Index -gt $lastIndex) {
      $segments += [pscustomobject]@{ type = 'text'; value = $text.Substring($lastIndex, $m.Index - $lastIndex) }
    }
    $label = if ($meta.label) { $meta.label } else { $m.Value }
    $segments += [pscustomobject]@{ type = 'badge'; cls = $meta.cls; value = $label }
    if ($meta.dedupe) { $dedupeSeen[$meta.label] = $true }
    $lastIndex = $m.Index + $m.Length
  }
  if ($lastIndex -lt $text.Length) {
    $segments += [pscustomobject]@{ type = 'text'; value = $text.Substring($lastIndex) }
  }
  return $segments
}

# -- T1: M4 scaffold leaf line -- verified leaf badged, class=verified -----
$t1 = @(Get-LeanBadgeSegments "  #L1 LEAF $EM $CHK Lean-verified (this leaf only) [deps: ]: foo")
$b1 = @($t1 | Where-Object { $_.type -eq 'badge' })
Test-True "T1 one badge on verified LEAF line" ($b1.Count -eq 1)
Test-True "T1 badge class=verified" ($b1[0].cls -eq 'verified')
Test-True "T1 badge label preserves original text" ($b1[0].value -eq "LEAF $EM $CHK Lean-verified (this leaf only)")

# -- T2: rejected leaf line --------------------------------------------------
$t2 = @(Get-LeanBadgeSegments "  #L2 LEAF $EM $XMARK Lean rejected [deps: L1]: bar")
$b2 = @($t2 | Where-Object { $_.type -eq 'badge' })
Test-True "T2 one badge on rejected LEAF line" ($b2.Count -eq 1)
Test-True "T2 badge class=rejected" ($b2[0].cls -eq 'rejected')

# -- T3: stated (sorry) leaf line --------------------------------------------
$t3 = @(Get-LeanBadgeSegments "  #L3 LEAF $EM statement type-checks, proof admitted (sorry) $EM NOT proven: baz")
$b3 = @($t3 | Where-Object { $_.type -eq 'badge' })
Test-True "T3 badge class=stated" ($b3[0].cls -eq 'stated')

# -- T4: pending / unformalizable leaf lines ---------------------------------
$t4 = @(Get-LeanBadgeSegments "  #L4 LEAF $EM checker cold/slow, not confirmed this turn: qux")
Test-True "T4 badge class=pending" (@($t4 | Where-Object {$_.type -eq 'badge'})[0].cls -eq 'pending')

$t4b = @(Get-LeanBadgeSegments "  #L5 LEAF $EM could not be faithfully formalized (nothing submitted): quux")
Test-True "T4b badge class=unformalizable" (@($t4b | Where-Object {$_.type -eq 'badge'})[0].cls -eq 'unformalizable')

# -- T5: PARENT scaffolded line ----------------------------------------------
$t5 = @(Get-LeanBadgeSegments "  #T PARENT $EM scaffolded (sorry, NOT proven): target conjecture")
Test-True "T5 badge class=scaffolded" (@($t5 | Where-Object {$_.type -eq 'badge'})[0].cls -eq 'scaffolded')

# -- T6: multi-leaf scaffold packet -- one badge per leaf line, in order ----
$packetLines = @(
  'M4 PROOF SCAFFOLD (human-architected lemma DAG). Target conjecture: "n+0=n".'
  'LEMMAS:'
  "  #L1 LEAF $EM $CHK Lean-verified (this leaf only) {Mathlib: Finset}: base case"
  "  #L2 LEAF $EM $XMARK Lean rejected [deps: L1]: failed step"
  "  #T PARENT $EM scaffolded (sorry, NOT proven) [deps: L1, L2]: target"
)
$packet = $packetLines -join "`n"
$t6 = @(Get-LeanBadgeSegments $packet)
$b6 = @($t6 | Where-Object { $_.type -eq 'badge' })
Test-True "T6 three badges, one per leaf/parent line" ($b6.Count -eq 3)
Test-True "T6 order verified, rejected, scaffolded" (
  $b6[0].cls -eq 'verified' -and $b6[1].cls -eq 'rejected' -and $b6[2].cls -eq 'scaffolded'
)

# -- T7: single-turn lean_verified narration -- one verified badge, ** markers consumed --
$narrVerified = "I formalized this in Lean 4 and submitted it to the checker $EM it **verified** (0 errors, 0 ``sorry``). Logged to the notebook (thread 'lean')."
$t7 = @(Get-LeanBadgeSegments $narrVerified)
$b7 = @($t7 | Where-Object { $_.type -eq 'badge' })
Test-True "T7 one badge for **verified**" ($b7.Count -eq 1 -and $b7[0].cls -eq 'verified')
Test-True "T7 badge label is lean_verified" ($b7[0].value -eq "$CHK lean_verified")
Test-True "T7 surrounding text retained, ** stripped from badge only" (
  (($t7 | Where-Object {$_.type -eq 'text'} | ForEach-Object { $_.value }) -join '') -notmatch '\*\*verified\*\*'
)

# -- T8: single-turn lean_stated narration -----------------------------------
$narrStated = "I formalized this in Lean 4. The **statement type-checks** against Mathlib, but the proof is left as ``sorry``."
$t8 = @(Get-LeanBadgeSegments $narrStated)
$b8 = @($t8 | Where-Object { $_.type -eq 'badge' })
Test-True "T8 one badge for **statement type-checks**" ($b8.Count -eq 1 -and $b8[0].cls -eq 'stated')

# -- T9: rejected narration -- ONE badge despite TWO matching markers (dedupe) --
$narrRejected = "I drafted a Lean 4 statement and submitted it, but Lean **rejected** it after 2 attempts. Logged honestly as ``lean_rejected`` $EM the conjecture remains unformalized."
$t9 = @(Get-LeanBadgeSegments $narrRejected)
$b9 = @($t9 | Where-Object { $_.type -eq 'badge' })
Test-True "T9 dedupe: exactly ONE rejected badge for two markers" ($b9.Count -eq 1 -and $b9[0].cls -eq 'rejected')

# -- T10: banned-token narration -- only the backtick marker present --------
$narrBanned = "The drafted Lean code used a disallowed construct, so I rejected it before submitting. Logged as ``lean_rejected``."
$t10 = @(Get-LeanBadgeSegments $narrBanned)
$b10 = @($t10 | Where-Object { $_.type -eq 'badge' })
Test-True "T10 banned path still gets one rejected badge" ($b10.Count -eq 1 -and $b10[0].cls -eq 'rejected')

# -- T11: plain text with no Lean markers -- zero badges, text unchanged ----
$plain = "Net for the fleet last week was SAR 12,400 across 6 drivers."
$t11 = @(Get-LeanBadgeSegments $plain)
Test-True "T11 no badges on ordinary message" (@($t11 | Where-Object {$_.type -eq 'badge'}).Count -eq 0)
Test-True "T11 single text segment equals original" ($t11.Count -eq 1 -and $t11[0].value -eq $plain)

# -- T12: pending/error single-turn narration -- no false-positive badge ----
$narrPending = "I drafted the Lean statement, but the verification service is cold/slow right now and didn't answer within my budget."
$t12 = @(Get-LeanBadgeSegments $narrPending)
Test-True "T12 cold/slow single-turn narration has no badge (not a LEAF line)" (@($t12 | Where-Object {$_.type -eq 'badge'}).Count -eq 0)

Write-Host ""
Write-Host "=== lean-badges-verify.ps1 (Build-23) ==="
Write-Host "PASS: $pass  FAIL: $fail"
if ($fail -gt 0) { exit 1 }
