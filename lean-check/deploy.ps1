# m8-lean-check: build + deploy to Cloud Run (see SETUP_GCP.md for one-time setup).
# Usage:  ./deploy.ps1                      (reuses existing LEAN_CHECK_TOKEN on the service)
#         ./deploy.ps1 -RotateToken         (mints a new token; update Vercel after)
param(
  [string]$Project = "m8-lean",
  [string]$Region  = "us-east1",
  [switch]$RotateToken
)
$ErrorActionPreference = 'Stop'
$image = "$Region-docker.pkg.dev/$Project/m8/lean-check"

Write-Host "== Cloud Build ($image) — ~20-30 min on first build =="
gcloud builds submit --project $Project --timeout=3600s --machine-type=e2-highcpu-8 --tag $image .
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$envArgs = @()
if ($RotateToken) {
  $token = -join ((48..57)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
  $envArgs = @("--set-env-vars", "LEAN_CHECK_TOKEN=$token")
}

Write-Host "== Deploy m8-lean-check =="
gcloud run deploy m8-lean-check --project $Project --image $image --region $Region `
  --cpu 2 --memory 4Gi --concurrency 1 --timeout 300 `
  --min-instances 0 --max-instances 1 --allow-unauthenticated @envArgs
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }

$url = gcloud run services describe m8-lean-check --project $Project --region $Region --format "value(status.url)"
Write-Host "service: $url"
if ($RotateToken) { Write-Host "NEW LEAN_CHECK_TOKEN=$token   <- update Vercel env" }
Write-Host "healthz:"; Invoke-RestMethod "$url/healthz" | ConvertTo-Json -Compress
