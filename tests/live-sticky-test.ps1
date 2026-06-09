$ErrorActionPreference = 'Continue'
$base = 'https://m8-alpha.vercel.app/api/chat'
$sid  = 'eval-sticky-' + (Get-Random)  # eval- prefix = hermetic (skips memory read/write)

# Turn 1: explicit tutor: prefix
$b1 = [ordered]@{ message = 'tutor: compound interest'; sessionId = $sid; history = @() }
$r1 = Invoke-RestMethod -Uri $base -Method POST -ContentType 'application/json' -Body ($b1 | ConvertTo-Json -Compress)
Write-Host "=== TURN 1 (tutor: trigger) ===" -ForegroundColor Cyan
Write-Host $r1

# Build history for turn 2
$hist = @(
  @{ role = 'user'; content = 'tutor: compound interest' },
  @{ role = 'assistant'; content = $r1 }
)

# Turn 2: no prefix — sticky should stay Socratic
$b2 = [ordered]@{ message = 'so the principal stays the same right?'; sessionId = $sid; history = $hist }
$r2 = Invoke-RestMethod -Uri $base -Method POST -ContentType 'application/json' -Body ($b2 | ConvertTo-Json -Compress -Depth 5)
Write-Host "=== TURN 2 (no prefix - expect Socratic, not just answer) ===" -ForegroundColor Cyan
Write-Host $r2

# Turn 3: exit signal
$hist2 = $hist + @(@{ role = 'user'; content = 'so the principal stays the same right?' }, @{ role = 'assistant'; content = $r2 })
$b3 = [ordered]@{ message = 'end tutor, just tell me the answer'; sessionId = $sid; history = $hist2 }
$r3 = Invoke-RestMethod -Uri $base -Method POST -ContentType 'application/json' -Body ($b3 | ConvertTo-Json -Compress -Depth 5)
Write-Host "=== TURN 3 (exit + direct question - expect direct answer) ===" -ForegroundColor Cyan
Write-Host $r3
