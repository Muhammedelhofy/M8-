# attachment-verify.ps1 -- Build-33 Text/CSV Attachments
# PowerShell mirror of lib/orchestrator.js buildAttachmentBlock/withAttachments
# and js/app.js packAttachments caps. Pure ASCII.

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
function CheckEq([string]$name, $actual, $expected) {
  if ("$actual" -eq "$expected") { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got '$actual', expected '$expected')" -ForegroundColor Red }
}

$MAX_ATTACHMENT_CHARS = 20000
$MAX_ATTACHMENTS = 3

# --- PS mirror of buildAttachmentBlock (lib/orchestrator.js) ---
function BuildAttachmentBlock($attachments) {
  if (-not $attachments -or $attachments.Count -eq 0) { return "" }
  $take = $attachments | Select-Object -First $MAX_ATTACHMENTS
  $parts = @()
  foreach ($a in $take) {
    $name = "$($a.name)"
    if ($name.Length -gt 200) { $name = $name.Substring(0, 200) }
    $content = "$($a.content)"
    $note = ""
    if ($content.Length -gt $MAX_ATTACHMENT_CHARS) {
      $note = "`n[...truncated, showing first $MAX_ATTACHMENT_CHARS of $($content.Length) characters]"
      $content = $content.Substring(0, $MAX_ATTACHMENT_CHARS)
    }
    $parts += "--- ATTACHED FILE: $name ---`n$content$note`n--- END OF FILE ---"
  }
  return ($parts -join "`n`n")
}

# --- PS mirror of withAttachments (lib/orchestrator.js) ---
function WithAttachments([string]$text, $attachments) {
  $block = BuildAttachmentBlock $attachments
  if ($block) { return "$block`n`n$text" }
  return $text
}

Write-Host "`n== buildAttachmentBlock: empty/no attachments ==" -ForegroundColor Cyan
CheckEq "no attachments -> empty string"        (BuildAttachmentBlock $null) ""
CheckEq "empty array -> empty string"           (BuildAttachmentBlock @()) ""

Write-Host "`n== buildAttachmentBlock: single small file ==" -ForegroundColor Cyan
$single = @([pscustomobject]@{ name = "earnings.csv"; content = "date,net`n8 Jun,1200.5" })
$block1 = BuildAttachmentBlock $single
CheckTrue "fence starts with ATTACHED FILE header"  ($block1.StartsWith("--- ATTACHED FILE: earnings.csv ---"))
CheckTrue "fence ends with END OF FILE"             ($block1.EndsWith("--- END OF FILE ---"))
CheckTrue "content is included verbatim"            ($block1 -match [regex]::Escape("date,net`n8 Jun,1200.5"))
CheckTrue "no truncation note for a small file"     ($block1 -notmatch '\[\.\.\.truncated')

Write-Host "`n== buildAttachmentBlock: truncation at MAX_ATTACHMENT_CHARS ==" -ForegroundColor Cyan
$bigContent = "x" * 25000
$big = @([pscustomobject]@{ name = "big.txt"; content = $bigContent })
$block2 = BuildAttachmentBlock $big
CheckTrue "truncation note present"                 ($block2 -match '\[\.\.\.truncated, showing first 20000 of 25000 characters\]')
$bodyOnly = $block2 -replace '^--- ATTACHED FILE: big\.txt ---\r?\n', '' -replace '\r?\n\[\.\.\.truncated[\s\S]*$', ''
CheckEq "truncated body length == MAX_ATTACHMENT_CHARS" $bodyOnly.Length $MAX_ATTACHMENT_CHARS

Write-Host "`n== buildAttachmentBlock: caps at MAX_ATTACHMENTS, joins with blank line ==" -ForegroundColor Cyan
$four = @(
  [pscustomobject]@{ name = "a.txt"; content = "A" }
  [pscustomobject]@{ name = "b.txt"; content = "B" }
  [pscustomobject]@{ name = "c.txt"; content = "C" }
  [pscustomobject]@{ name = "d.txt"; content = "D" }
)
$block3 = BuildAttachmentBlock $four
CheckTrue "includes file a"     ($block3 -match 'ATTACHED FILE: a\.txt')
CheckTrue "includes file b"     ($block3 -match 'ATTACHED FILE: b\.txt')
CheckTrue "includes file c"     ($block3 -match 'ATTACHED FILE: c\.txt')
CheckTrue "excludes 4th file d" ($block3 -notmatch 'ATTACHED FILE: d\.txt')
$blockCount = ([regex]::Matches($block3, 'ATTACHED FILE:')).Count
CheckEq "exactly MAX_ATTACHMENTS fences" $blockCount $MAX_ATTACHMENTS
CheckTrue "fences joined by a blank line" ($block3 -match "--- END OF FILE ---`n`n--- ATTACHED FILE")

Write-Host "`n== withAttachments: prepends block to turn text, passthrough when empty ==" -ForegroundColor Cyan
$turnText = "What's the total in this CSV?"
$withBlock = WithAttachments $turnText $single
CheckTrue "result starts with the attachment block"  ($withBlock.StartsWith("--- ATTACHED FILE: earnings.csv ---"))
CheckTrue "result ends with the original turn text"   ($withBlock.EndsWith($turnText))
CheckEq "no attachments -> text unchanged"            (WithAttachments $turnText $null) $turnText
CheckEq "empty attachments -> text unchanged"         (WithAttachments $turnText @()) $turnText

Write-Host "`n=================================================="
Write-Host "  text/CSV attachments (Build-33): $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
