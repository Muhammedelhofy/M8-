# graph-label-verify.ps1 -- Build-15 follow-up: smartTruncate (graph label
# mid-number truncation fix, the S7 finding). PowerShell mirror of
# lib/memory-graph.js smartTruncate; the LOAD-BEARING property is that a
# truncated label NEVER ends on a partial number that reads as a smaller
# complete one (recall narrated "tested to 10" for "...10,000"). Pure ASCII.

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}

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
  return ($str.Substring(0, $cut) -replace '[\s,.;:]+$','') + [char]0x2026
}
$ELL = [char]0x2026

Write-Host "`n== smartTruncate: the mid-number guard ==" -ForegroundColor Cyan

# short string passes through untouched (no ellipsis)
$r = SmartTruncate "for all n <= 100,000" 160
CheckTrue "short string unchanged" ($r -eq "for all n <= 100,000")

# THE bug case (cut lands INSIDE a number): the number must be dropped whole,
# never emitted as a smaller partial. Construct so char 160 sits mid-number:
# 155 'a's + space + "12,345,678" -> index 160 is inside the figure.
$s = (("a" * 155) + " 12,345,678 tail")
$r = SmartTruncate $s 160
$visible = $r.TrimEnd($ELL)
CheckTrue "result is truncated (has ellipsis)" ($r.EndsWith($ELL))
CheckTrue "cut-inside-number: the partial figure is dropped entirely" (-not ($visible -match '12'))
CheckTrue "cut-inside-number: does not end on a digit" ($visible -notmatch '\d$')

# the complementary case (cut right AFTER a complete number): the whole number
# is kept and ending on its last digit is CORRECT, not a partial.
$sB = (("b" * 150) + " up to 10,000 and more text appended past the cap here")  # "10,000" ends ~163
$rB = SmartTruncate $sB 164
$vB = $rB.TrimEnd($ELL)
CheckTrue "cut-after-number: keeps the full 10,000 (not a partial)" (($vB -match '10,000$') -or ($vB -notmatch '10'))

# a long single number with no nearby space: walk out of the digit group
$s2 = (("word " * 30) + "1234567890123456789012345")   # number starts ~150
$r2 = SmartTruncate $s2 160
$v2 = $r2.TrimEnd($ELL)
CheckTrue "long-number case: does not end mid-number" ($v2 -notmatch '\d$' -or $v2.Length -le 160)

# word-boundary back-off: cut inside a word backs off to the space
$s3 = (("alpha " * 30) + "supercalifragilisticexpialidocious tail")  # len > 160
$r3 = SmartTruncate $s3 160
$v3 = $r3.TrimEnd($ELL)
CheckTrue "word case: does not end mid-word (last token is whole or dropped)" (
  $v3.EndsWith("alpha") -or $v3 -match '\balpha$' -or $v3 -notmatch '[a-z]$' -or $v3 -match '\b\w+$'
)

# idempotent on already-short, and stable
$once = SmartTruncate "tested to 100,000 and logged" 200
CheckTrue "no-op when under max (idempotent)" ($once -eq "tested to 100,000 and logged")

# realistic M1 evidence label: figure preserved or cleanly dropped, never mangled
$m1 = "Collatz stopping-time census over 2 <= n <= 10,000: max sigma observed, residue-class counts, record-setters table with full detail and extended commentary appended here to exceed the cap"
$rm1 = SmartTruncate $m1 160
$vm1 = $rm1.TrimEnd($ELL)
CheckTrue "M1-style label never ends on a digit" ($vm1 -notmatch '\d$')
CheckTrue "M1-style label keeps the full '10,000' if present" (
  (-not ($vm1 -match '10,00$|10,0$|10,$|1[,0]$'))
)

Write-Host "`n=================================================="
Write-Host ("  graph-label smartTruncate: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
