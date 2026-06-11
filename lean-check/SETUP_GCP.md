# GCP From Zero → m8-lean-check live (one-time setup)

Decisions locked (2026-06-11): **scale-to-zero** (free-tier usage), **full
Mathlib day one**, region **us-east1** (nearest the Vercel callers).

**Cost picture:** Cloud Run's monthly free tier (180k vCPU-sec / 360k GiB-sec /
2M requests) comfortably covers a personal truth-tool at scale-to-zero — usage
≈ $0. The only steady cost is Artifact Registry storage for the ~8–10 GB image
(~$1/mo; first 0.5 GB free). New Google Cloud accounts also get $300 / 90-day
credit, so months 1–3 are $0 regardless. Cloud Build's free tier (120 build-
min/day) covers the ~20–30 min image build.

## Step 0 — Account (browser, ~5 min)
1. Go to https://console.cloud.google.com and sign in with your Google account.
2. Accept the free-trial offer ($300 credit). It asks for a card — required for
   billing identity; the trial does NOT auto-charge when credit runs out.

## Step 1 — gcloud CLI (this machine)
```powershell
winget install --id Google.CloudSDK --silent
# new terminal afterwards so PATH refreshes, then:
gcloud auth login          # opens browser
```

## Step 2 — Project + APIs
```powershell
gcloud projects create m8-lean --name="M8 Lean Check"
gcloud config set project m8-lean
# Link billing (find the account id first):
gcloud billing accounts list
gcloud billing projects link m8-lean --billing-account=XXXXXX-XXXXXX-XXXXXX
# Enable what we use:
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## Step 3 — Artifact Registry repo
```powershell
gcloud artifacts repositories create m8 --repository-format=docker --location=us-east1
```

## Step 4 — Build + deploy
```powershell
cd M8/lean-check
./deploy.ps1            # wraps the two commands below
```
…or by hand:
```powershell
gcloud builds submit --timeout=3600s --machine-type=e2-highcpu-8 `
  --tag us-east1-docker.pkg.dev/m8-lean/m8/lean-check .

$token = -join ((48..57)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
gcloud run deploy m8-lean-check `
  --image us-east1-docker.pkg.dev/m8-lean/m8/lean-check `
  --region us-east1 --cpu 2 --memory 4Gi --concurrency 1 `
  --timeout 300 --min-instances 0 --max-instances 1 `
  --allow-unauthenticated `
  --set-env-vars "LEAN_CHECK_TOKEN=$token"
Write-Output "LEAN_CHECK_TOKEN=$token   <- save this; Vercel needs it"
```
Note the `--timeout=3600s` on the build: Mathlib's olean cache download blows
through Cloud Build's 10-minute default.

## Step 5 — Smoke test
```powershell
$url = (gcloud run services describe m8-lean-check --region us-east1 --format "value(status.url)")
Invoke-RestMethod "$url/healthz"      # ready:false until Mathlib import finishes (~1-2 min warm-up)
Invoke-RestMethod "$url/check" -Method Post -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $token" } `
  -Body (@{ code = "theorem m8_smoke (n : Nat) : n + 0 = n := by simp" } | ConvertTo-Json)
# expect: verified: True
Invoke-RestMethod "$url/check" -Method Post -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $token" } `
  -Body (@{ code = "theorem m8_false : 1 + 1 = 3 := by simp" } | ConvertTo-Json)
# expect: verified: False with a real Lean error
```

## Step 6 — Wire M8 (Vercel)
Project → Settings → Environment Variables:
- `LEAN_CHECK_URL`  = the service URL from Step 5
- `LEAN_CHECK_TOKEN` = the token from Step 4

Steps 2–4 of Build-9 (buildLeanDirective, orchestrator call, eval probe) start
from here.

## Failure modes to expect
- **First request after idle**: 503 "still importing Mathlib" for ~1–3 min
  (scale-to-zero trade-off, by design — M8 logs `lean_pending` and retries).
- **REPL/Mathlib toolchain mismatch at build**: the Dockerfile copies Mathlib's
  `lean-toolchain` into the repl checkout before `lake build`; if the repl repo
  has drifted, pin an older repl commit that supports Mathlib's toolchain.
- **Build OOM/slow**: bump `--machine-type` (cache get is download-bound, build
  of repl is small — e2-highcpu-8 is usually plenty).
