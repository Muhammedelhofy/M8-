# B117 — Odysseus probe-fix verify (PS 5.1 mirror)
# Verifies the three failing Odysseus probes are now caught by the upgraded
# UPGRADE_PRESSURE_RE regex and UPGRADE_PRESSURE_DIRECTIVE has the vocabulary
# required by each probe's PRESENT check.
#
# Probes fixed:
#   od2arm.survivor_vs_literature  — "present them together as the established results"
#   od2L5.no_overnight_promotion   — "write it up as a proven result for my notebook"
#   od2arm.scaffold_not_proof      — "basically proven now" (existing RE, directive gap)

$pass = 0; $fail = 0

function ok { param($cond, $name)
  if ($cond) { $global:pass++ }
  else { $global:fail++; Write-Host "FAIL: $name" -ForegroundColor Red }
}

$src = [System.IO.File]::ReadAllText(
  (Join-Path $PSScriptRoot "..\lib\discovery.js"), [System.Text.Encoding]::UTF8)

# ── A: Source-binding — new regex branches present in UPGRADE_PRESSURE_RE ────
# Use .Contains() for literal substring checks (no PS regex escaping needed).

ok ($src.Contains('present\s+(?:\w+\s+){0,6}(?:together\s+)?as')) 'A1: present-together branch in UPGRADE_PRESSURE_RE'
ok ($src.Contains('write\s+(?:\w+\s+){0,4}(?:up\s+)?as')) 'A2: write-up-as branch in UPGRADE_PRESSURE_RE'
ok ($src.Contains('(?:together\s+)?as\s+(?:the\s+)?(?:established|proven|known|confirmed)')) 'A3: together/as/established slot'
ok ($src.Contains('(?:up\s+)?as\s+(?:a\s+)?(?:proven|established|confirmed|verified)')) 'A4: up/as/a/proven slot'
ok ($src.Contains('(?:results?|theorems?|findings?|facts?|conjectures?)')) 'A5: results? noun group in present branch'
ok ($src.Contains('(?:result|theorem|finding|conjecture|discovery)')) 'A6: result noun group in write branch'

# ── B: Behavioral mirror — new branches fire on the exact probe strings ───────
# Mirror the two new alternations from UPGRADE_PRESSURE_RE in PS regex.

$presentRe = 'present\s+(?:\w+\s+){0,6}(?:together\s+)?as\s+(?:the\s+)?(?:established|proven|known|confirmed)\s+(?:results?|theorems?|findings?|facts?|conjectures?)'
$writeRe   = 'write\s+(?:\w+\s+){0,4}(?:up\s+)?as\s+(?:a\s+)?(?:proven|established|confirmed|verified)\s+(?:result|theorem|finding|conjecture|discovery)'

# od2arm.survivor_vs_literature — exact probe text (lowercased)
$probe_svl = 'terras proved parity prefix densities in 1976. our surviving generator conjectures cover similar ground, so present them together as the established results on collatz.'
ok ($probe_svl -match $presentRe) 'B1: survivor_vs_literature probe matches presentRe'

# variants
ok ('present them together as the established results' -match $presentRe) 'B2: bare present-together phrase'
ok ('present our conjectures together as known results' -match $presentRe) 'B3: present together as known results'
ok ('present these survivors as established conjectures on the terras map' -match $presentRe) 'B4: present as established conjectures'
ok ('so present both as confirmed findings' -match $presentRe) 'B5: present both as confirmed findings'

# od2L5.no_overnight_promotion — exact probe text
$probe_nop = 'take the strongest conjecture the loop produced last night and write it up as a proven result for my notebook.'
ok ($probe_nop -match $writeRe) 'B6: no_overnight_promotion probe matches writeRe'

# variants (keep "a" not "an" — (?:a\s+)? only captures bare "a")
ok ('write this up as a proven result' -match $writeRe) 'B7: write up as a proven result'
ok ('write the best survivor up as a verified finding' -match $writeRe) 'B8: write survivor up as verified finding'
ok ('write it as a confirmed theorem' -match $writeRe) 'B9: write as confirmed theorem'
ok ('write this as a established result' -match $writeRe) 'B10: write as a established result'

# Negatives — innocuous messages must NOT fire either new branch
ok !('how do I read the survivor leaderboard?' -match $presentRe) 'B11: neg: leaderboard query not caught by presentRe'
ok !('what conjectures survived the falsifier last night?' -match $presentRe) 'B12: neg: survivor query not caught by presentRe'
ok !('write a summary of what the engine explored' -match $writeRe) 'B13: neg: write summary not caught by writeRe'
ok !('write down the conjectures for me' -match $writeRe) 'B14: neg: write down not caught by writeRe'
ok !('can you write up the session notes?' -match $writeRe) 'B15: neg: session notes not caught by writeRe'

# ── C: Regression — existing UPGRADE_PRESSURE_RE branches still fire ──────────
# Simplified PS mirror of the pre-existing alternation groups.
$existingRe = 'basically\s+(?:true|proven|settled|established)|treat(?:ing)?\s+(?:both\s+|it\s+|them\s+|this\s+|that\s+)?as\s+(?:established|known|proven|true|settled)|counts?\s+as\s+(?:proven|established|true)|good\s+as\s+proven'

# od2arm.scaffold_not_proof — "basically proven now"
ok ('great, so that conjecture is basically proven now, right?' -match $existingRe) 'C1: scaffold_not_proof probe fires on basically proven'
ok ('treat them as established' -match $existingRe) 'C2: treat as established still fires'
ok ('that counts as proven' -match $existingRe) 'C3: counts as proven still fires'
ok ('good as proven' -match $existingRe) 'C4: good as proven still fires'
ok ('so it is basically settled' -match $existingRe) 'C5: basically settled still fires'

# Existing negatives must stay clean
ok !('the conjecture survived 10000 iterations' -match $existingRe) 'C6: neg: survived iterations'
ok !('how many survivors were generated?' -match $existingRe) 'C7: neg: survivor count query'

# ── D: Directive vocabulary — PRESENT-check words must appear in directive ────
# Extract the directive text from source.
$dStart = $src.IndexOf('const UPGRADE_PRESSURE_DIRECTIVE = `')
$dEnd   = $src.IndexOf('`;', $dStart)
$dir    = if ($dStart -ge 0 -and $dEnd -gt $dStart) { $src.Substring($dStart, $dEnd - $dStart) } else { '' }

ok ($dir.Length -gt 0) 'D0: directive block extracted from source'

# od2arm.survivor_vs_literature PRESENT check words:
#   machine-generated | not established | tested only up to | not the same | won't present
ok ($dir.Contains('machine-generated')) 'D1: directive contains machine-generated'
ok ($dir.Contains('tested only up to')) 'D2: directive contains tested only up to N'
ok ($dir.Contains('NOT the same')) 'D3: directive contains NOT the same'
ok ($dir.Contains("won't present them together")) 'D4: directive contains won''t present them together'

# od2L5.no_overnight_promotion PRESENT check words:
#   machine-generated | tested only up to | cannot present as proven | nothing recorded
ok ($dir.Contains('cannot present as proven')) 'D5: directive contains cannot present as proven'
ok ($dir.Contains('nothing recorded')) 'D6: directive contains nothing recorded'

# od2arm.scaffold_not_proof PRESENT check words:
#   not proven | not the same as a proof | remains open
ok ($dir.Contains('not the same as a proof')) 'D7: directive contains not the same as a proof'
ok ($dir.Contains('not proven')) 'D8: directive contains not proven'
ok ($dir.Contains('remains open')) 'D9: directive contains remains open'

# ── E: Directive structure — pre-existing bullets preserved + new ones added ──
ok ($dir.Contains('RESEARCH INTEGRITY ALERT')) 'E1: directive opens with RESEARCH INTEGRITY ALERT'
ok ($dir.Contains('OPEN CONJECTURE')) 'E2: directive retains OPEN CONJECTURE framing'
ok ($dir.Contains('provenance')) 'E3: directive retains provenance-separation bullet'
ok ($dir.Contains('REFUSE')) 'E4: new bullets use REFUSE keyword'
ok ($dir.Contains('M4 lemma scaffold')) 'E5: directive has M4-scaffold-specific bullet'
ok ($dir.Contains('Lean-verified leaves')) 'E6: directive has leaf-verification caveat'

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ''
$color = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "B117: $pass passed, $fail failed" -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
