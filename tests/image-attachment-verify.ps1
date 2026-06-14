# image-attachment-verify.ps1 -- Build-34 Image / Vision Attachments
# PowerShell mirror of the deterministic image pieces in lib/orchestrator.js
# (VISION_MIME, isImageAttachment, buildImageParts, visionProviderOrder) and
# js/app.js (ATTACHMENT_IMAGE_RE). Pure ASCII. No Node in this shell, so the
# logic is reimplemented in PS exactly as the JS does it.

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}
function CheckEq([string]$name, $actual, $expected) {
  if ("$actual" -eq "$expected") { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got '$actual', expected '$expected')" -ForegroundColor Red }
}

$MAX_ATTACHMENTS = 3
# mirror of VISION_MIME (lib/orchestrator.js) and ATTACHMENT_IMAGE_RE (js/app.js)
$VISION_MIME = '^image/(png|jpe?g|webp|gif)$'

function IsImageAttachment($a) {
  return ($null -ne $a -and "$($a.kind)" -eq "image" -and "$($a.data)".Length -gt 0 `
    -and "$($a.mimeType)".Length -gt 0 -and ("$($a.mimeType)" -match $VISION_MIME))
}
function HasImageAttachments($attachments) {
  if (-not $attachments) { return $false }
  foreach ($a in $attachments) { if (IsImageAttachment $a) { return $true } }
  return $false
}
function BuildImageParts($attachments) {
  if (-not $attachments) { return @() }
  $imgs = @($attachments | Where-Object { IsImageAttachment $_ } | Select-Object -First $MAX_ATTACHMENTS)
  return @($imgs | ForEach-Object { [pscustomobject]@{ mimeType = $_.mimeType; data = $_.data } })
}
function VisionProviderOrder([bool]$hasOpenAIKey) {
  if ($hasOpenAIKey) { return "gemini,gemini2,openai" }
  return "gemini,gemini2"
}

Write-Host "`n== VISION_MIME classification ==" -ForegroundColor Cyan
CheckTrue "image/png  is vision"   ("image/png"   -match $VISION_MIME)
CheckTrue "image/jpeg is vision"   ("image/jpeg"  -match $VISION_MIME)
CheckTrue "image/jpg  is vision"   ("image/jpg"   -match $VISION_MIME)
CheckTrue "image/webp is vision"   ("image/webp"  -match $VISION_MIME)
CheckTrue "image/gif  is vision"   ("image/gif"   -match $VISION_MIME)
CheckTrue "image/svg+xml NOT vision" (-not ("image/svg+xml" -match $VISION_MIME))
CheckTrue "application/pdf NOT vision" (-not ("application/pdf" -match $VISION_MIME))
CheckTrue "text/plain NOT vision"    (-not ("text/plain" -match $VISION_MIME))

Write-Host "`n== isImageAttachment / hasImageAttachments ==" -ForegroundColor Cyan
$img = [pscustomobject]@{ name="r.png"; kind="image"; mimeType="image/png"; data="AAAA" }
$txt = [pscustomobject]@{ name="n.txt"; content="hello" }
$imgNoData = [pscustomobject]@{ name="r.png"; kind="image"; mimeType="image/png"; data="" }
CheckTrue "valid image -> true"            (IsImageAttachment $img)
CheckTrue "text file -> false"             (-not (IsImageAttachment $txt))
CheckTrue "image w/o data -> false"        (-not (IsImageAttachment $imgNoData))
CheckTrue "mixed list has image"           (HasImageAttachments @($txt, $img))
CheckTrue "text-only list has no image"    (-not (HasImageAttachments @($txt)))
CheckTrue "null -> no image"               (-not (HasImageAttachments $null))

Write-Host "`n== buildImageParts: shape, filter, cap ==" -ForegroundColor Cyan
# @(...) forces array context -- PS unwraps a 1-element array on return.
$parts = @(BuildImageParts @($txt, $img))
CheckEq  "filters to 1 image part"         $parts.Count 1
CheckEq  "part has mimeType"               $parts[0].mimeType "image/png"
CheckEq  "part has data"                   $parts[0].data "AAAA"
$fourImgs = @(
  [pscustomobject]@{ name="a.png"; kind="image"; mimeType="image/png"; data="A" }
  [pscustomobject]@{ name="b.png"; kind="image"; mimeType="image/png"; data="B" }
  [pscustomobject]@{ name="c.png"; kind="image"; mimeType="image/png"; data="C" }
  [pscustomobject]@{ name="d.png"; kind="image"; mimeType="image/png"; data="D" }
)
$capped = BuildImageParts $fourImgs
CheckEq  "caps image parts at MAX_ATTACHMENTS" $capped.Count $MAX_ATTACHMENTS
CheckEq  "no images -> empty parts"        (BuildImageParts @($txt)).Count 0

Write-Host "`n== visionProviderOrder: never includes text-only providers ==" -ForegroundColor Cyan
$noKey = VisionProviderOrder $false
$withKey = VisionProviderOrder $true
CheckEq  "no OpenAI key -> gemini,gemini2" $noKey "gemini,gemini2"
CheckEq  "with OpenAI key -> + openai"     $withKey "gemini,gemini2,openai"
CheckTrue "never includes groq"            ($withKey -notmatch 'groq')
CheckTrue "never includes cerebras"        ($withKey -notmatch 'cerebras')
CheckTrue "never includes mistral"         ($withKey -notmatch 'mistral')
CheckTrue "never includes openrouter"      ($withKey -notmatch 'openrouter')

Write-Host "`n=================================================="
Write-Host "  image/vision attachments (Build-34): $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
