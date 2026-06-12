# m8-lean-check: build + deploy to Cloud Run (see SETUP_GCP.md for one-time setup).
# Usage:  ./deploy.ps1                      (reuses existing LEAN_CHECK_TOKEN on the service)
#         ./deploy.ps1 -RotateToken         (mints a new token; update Vercel after)
param(
  # The REAL project (verified via gcloud 2026-06-12) - the old "m8-lean"
  # default never matched the deployed service.
  [string]$Project = "gen-lang-client-0609389271",
  [string]$Region  = "us-east1",
  [switch]$RotateToken
)
$ErrorActionPreference = 'Stop'
$image = "$Region-docker.pkg.dev/$Project/m8/lean-check"

Write-Host "== Cloud Build ($image) - ~20-30 min on first build =="
gcloud builds submit --project $Project --timeout=3600s --machine-type=e2-highcpu-8 --tag $image .
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$envArgs = @()
if ($RotateToken) {
  # NB --update-env-vars MERGES; --set-env-vars REPLACES the whole set (wipes
  # IMPORT_TIMEOUT_S etc.) - bitten once, never again.
  $token = -join (1..40 | ForEach-Object { [char](Get-Random -InputObject ([int[]](48..57)+(97..122))) })
  $envArgs = @("--update-env-vars", "LEAN_CHECK_TOKEN=$token")
}

Write-Host "== Deploy m8-lean-check =="
# Sizing learned the hard way (Session-9): import Mathlib peaks >4GiB (OOM at
# 4Gi), needs ~9 min even at 4 vCPU, and runs OUTSIDE a request - so the
# service MUST have --no-cpu-throttling or background CPU is ~zero forever.
gcloud run deploy m8-lean-check --project $Project --image $image --region $Region `
  --cpu 4 --memory 8Gi --concurrency 1 --timeout 300 `
  --no-cpu-throttling --cpu-boost `
  --min-instances 0 --max-instances 1 --allow-unauthenticated `
  --update-env-vars "IMPORT_TIMEOUT_S=900" @envArgs
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }

$url = gcloud run services describe m8-lean-check --project $Project --region $Region --format "value(status.url)"
Write-Host "service: $url"
if ($RotateToken) { Write-Host "NEW LEAN_CHECK_TOKEN=$token   <- update Vercel env" }
# /healthz is swallowed by Google's front-end on *.run.app - the route is /health.
Write-Host "health:"; Invoke-RestMethod "$url/health" | ConvertTo-Json -Compress
