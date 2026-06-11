# Build-9 Step 1 — Lean Verification Service: Infra Design

**Status:** DESIGN ONLY — no Cloud Run config written yet (per Boss's instruction).
**Goal:** a `/check` endpoint M8's orchestrator can call to formally verify a Lean 4
statement against Mathlib, returning `lean_verified` / `lean_rejected` ground truth.

---

## 1. Shape of the service

**`m8-lean-check`** — a single Cloud Run service, one container:

```
┌─────────────────────────── Cloud Run: m8-lean-check ──────────────────────────┐
│  FastAPI (uvicorn)                                                            │
│   ├─ POST /check    ── pipes candidate code into a persistent Lean REPL       │
│   └─ GET  /healthz  ── "ready" only after the REPL has Mathlib imported       │
│                                                                               │
│  leanprover-community/repl (long-lived child process)                         │
│   └─ Lean 4 toolchain (pinned) + Mathlib .olean cache (lake exe cache get)    │
└───────────────────────────────────────────────────────────────────────────────┘
```

Why a persistent REPL instead of `lake env lean file.lean` per request: importing
Mathlib costs ~30–90 s. The REPL pays that once at container start; each `/check`
then runs in a fresh environment in **~1–10 s**. Cloud Run keeps the instance warm
between requests, so only cold starts pay the import.

## 2. API contract

```
POST /check
Authorization: Bearer $LEAN_CHECK_TOKEN          (shared secret; service is
                                                  --allow-unauthenticated at the
                                                  GCP layer, auth enforced in-app)
{ "code": "theorem fleet_conj : ∀ n : ℕ, n + 0 = n := by simp",
  "imports": ["Mathlib"],            // or [] for core-only fast path
  "timeout_s": 60 }

→ 200 { "verified": true,            // compiled, zero errors, zero sorries
        "errors": [],                // Lean messages on failure (fed back to M8
        "sorries": [],               //  so it can repair the statement)
        "elapsed_ms": 2150,
        "toolchain": "leanprover/lean4:v4.x.0", "mathlib": "<pinned rev>" }
```

**`verified: true` is strict:** compiles AND no errors AND no `sorry`/`admit`
(REPL reports sorries structurally) AND the code is textually screened for
`axiom`/`unsafe`/`#eval`/`import` injection — the only allowed imports are the
ones in the `imports` field. A proof with `sorry` type-checks but proves
nothing; the truth-tool must call that **rejected**, not verified.

## 3. Sizing & deploy parameters (proposed)

| Knob | Value | Why |
|---|---|---|
| CPU / memory | 2 vCPU / 4 GiB | Mathlib import + elaboration headroom |
| Concurrency | 1 | one REPL, one check at a time |
| Request timeout | 300 s | hard proofs; caller enforces its own budget |
| Max instances | 1 | cost guard — this is a personal truth-tool, not a fleet |
| Min instances | **0 (decision point)** | see cost section |
| Region | `us-east1` | nearest to the Vercel functions that call it (caller locality beats Riyadh locality — Boss never hits this service directly) |
| Image | Artifact Registry, same region | ~8–10 GB with Mathlib olean cache |
| Build | Cloud Build, ~20–30 min | `lake exe cache get` downloads oleans — never compiles Mathlib from source |
| Toolchain | pinned `lean-toolchain` + Mathlib rev | reproducible verdicts; bump deliberately |

## 4. Cold-start reality & cost (the real trade-off)

| Mode | First check after idle | Cost ballpark |
|---|---|---|
| **Scale-to-zero** (min=0) | ~1–3 min (image pull on a new node + Mathlib import) | well under ~$5/mo (registry storage + per-request CPU) |
| Keep-warm ping (Cloud Scheduler, Riyadh work hours) | warm during pinged hours, cold otherwise | low single-digit $/mo, not guaranteed (instances can still be evicted) |
| Always-on (min=1) | always ~1–10 s | roughly $40–70/mo at this sizing |

**Recommendation: scale-to-zero.** A Lean check verifies a *notebook conjecture* —
it is not a latency-critical chat answer. The orchestrator (Step 3) calls with a
~50 s budget; if the service is cold it logs `lean_pending` and M8 says so
honestly THIS turn (capability-honesty rule: no "let me check" promises), and the
next ask gets the warm answer. The Step-4 eval probe simply retries once.

## 5. Caller side (Step 3 preview — sets what Step 1 must support)

- Orchestrator env: `LEAN_CHECK_URL`, `LEAN_CHECK_TOKEN`.
- `buildLeanDirective` (Step 2) drafts the formal statement — **model:
  Claude Fable 5 (`claude-fable-5`)** for the formalization step; it is the
  hardest reasoning step in the pipeline and where model ceiling matters.
- Outcome logging mirrors the existing notebook outcome-staging:
  `lean_verified` / `lean_rejected` / `lean_pending` (timeout/cold) /
  `lean_error` (service down — fails SAFE, never blocks the turn).

## 6. Decisions (LOCKED 2026-06-11, Boss)

1. **GCP starting point** — from zero → full walkthrough in
   `lean-check/SETUP_GCP.md` (account, billing, gcloud, APIs, registry).
2. **Warmth** — **scale-to-zero**, free-tier first: Cloud Run's monthly free
   tier covers this usage (≈$0); only steady cost is ~$1/mo Artifact Registry
   storage, and the $300 new-account credit covers months 1–3 entirely.
3. **v1 scope** — **full Mathlib from day one.**

Source lives in `lean-check/` (Dockerfile, FastAPI app, deploy.ps1, setup doc).

## 7. Explicitly NOT in scope (v1)

- Proof *search* (M8 writes the proof attempt; the service only checks it).
- Multi-user auth, rate limiting beyond max-instances=1.
- GPU anything. Lean checking is CPU-only.
