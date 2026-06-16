# M8 — Next Session Brief
**Latest:** 2026-06-16 (Session-38, Opus) · **Branch:** main · **Head:** `54162e4`
**Canonical plan:** [`M8/HONESTY_TRACK_PLAN.md`](HONESTY_TRACK_PLAN.md) ← the living backlog. Read it first.
(Older Session-34 brief preserved below for history.)

---

## ★ SESSION-38 CURRENT STATE — read this first (the cross-session source of truth)

**The problem-solving-engine roadmap is COMPLETE and LIVE: Build-43 D → B → A → C all shipped + live-verified.**
- **D** (`cfff4c1`) — fringe idea → testable claim (kernel → computable conjecture → falsifier → "observed through N").
- **B** (`5ce54ec`) — test the user's LITERAL claim first (counterexample), then offer the nearest-TRUE pattern.
- **A** (`10edb8d`) — **M8 plans the attack**: drafts an anti-degeneracy-gated lemma-DAG for a target, human approves `#N`, the existing M4/Lean lane verifies the leaves (k/m; target stays an OPEN CONJECTURE). `lib/decomp-proposer.js`; migration `m8_decomp_proposals.sql` applied.
- **C** (`7bb79e9`) — **2nd problem domain = reverse-and-add / Lychrel "196"** (`lib/lychrel-probes.js`, BigInt). A structural twin of the Collatz M1 census; proves the engine generalizes. LIVE: found exactly the 13 known Lychrel candidates < 1000 (OEIS A023108), conjecture "every n≤1000 within K" falsified at 196, all framed OPEN.

**LOCKED DECISION — depth over breadth ([`m8-depth-over-breadth`] memory):** with C done, the engine has TWO domains so "it generalizes" is proven. **STOP adding problem domains.** Future engine work goes into DEPTH (smarter conjectures, deeper decompositions, discharging more leaves), NOT more domains. Revisit breadth only on an explicit ask.

**IN-FLIGHT (separate session/account):** a "make the M8 diagram better → mind/brain map + Tasks/Projects/Evolution" effort is being done in a DIFFERENT Claude session. Its agreed vision is captured in [`M8/MIND_DIAGRAM_BRIEF.md`](MIND_DIAGRAM_BRIEF.md). That session must `git pull` first (this repo is ahead at `54162e4`) and push its work to the `M8-` repo so it isn't lost. The engine work (this brief) and the diagram work (that brief) are independent — no code overlap.

**Honesty spine (unchanged law):** `lean_verified` is the ONLY path to `proven`; a counterexample the ONLY path to `refuted`; ingestion/extraction reach neither; narration ≤ evidence; code computes truth, the LLM narrates. Free Gemini/Tavily stack. Live runs cost Gemini quota + need Muhammad's OK.

### ▶ THE PLAN FROM HERE (sequenced — don't lose progress)
1. **ANTI-LOSS GATE (must pass before the diagram is "done"):** the new mind-diagram (`m8_mind_2026.html`)
   is NOT finished until it has been verified ITEM-BY-ITEM against [`M8_INVENTORY.md`](M8_INVENTORY.md)'s
   checklist — the diagram session must output a "PLACED / OMITTED (why)" table covering every checklist
   line, and Muhammad reviews it. The OLD diagram (`m8_full_architecture_2026.html`) STAYS in place until
   the new one passes this gate. (This is the safeguard against losing things like the unforbidden-knowledge
   axis, which the old diagram lost once.)
2. **Finalize the mind-diagram** (separate session, per `MIND_DIAGRAM_BRIEF.md`) → commit `m8_mind_2026.html`.
3. **Resume engine DEPTH** (the locked next direction — NOT more domains). Candidate depth levers, pick one
   spec-first:
   - **Make M4 discharge a REAL (non-degenerate) decomposition** — the logged §0.4 caveat was that the
     verified DAG was degenerate (L1 ≈ target). Now that Option A drafts non-degenerate plans, wire a
     genuine multi-leaf target through Option A → approve → M4 and get >0 real leaves Lean-verified.
   - **Smarter conjecture generation** (Option B's "richer guesses" — LLM proposes, deterministic falsifier
     polices) to raise candidate quality.
   - **Deeper decompositions** (Option A drafting multi-level DAGs, not just one layer).

---

## ✅ RESOLVED THIS SESSION: live image vision (Build-34) is FIXED

**Root cause (not the SDK/model/field-shape the Session-33 brief suspected):** the clarification +
doc **early-returns** in `orchestrate()` run ~200 lines *before* `imgTurn` was computed. On an image
turn the tool-decision (`decideAction`), specificity (`checkSpecificity`), or `INTENT.DOC` gate saw
only the message TEXT ("read this image"), not the attached `inlineData` part, and early-RETURNED a
"what image?" clarification **before** `buildUserParts` ever added the image. That also explains the
missing `request_traces` on failing calls (early return precedes the trace insert) and the
intermittency (the one phrasing that slipped the gates went full-pipeline and read the image fine).

**Fix (`c5023d0`):** hoist `const imgTurn = hasImageAttachments(attachments)` to the top of
`orchestrate()` and gate every pre-vision early-return on `!imgTurn` (DOC gate, INTENT.NONE
tool-clarify, both specificity gates incl. the web-search slot). `/api/chat` + `/api/chat-stream`
both covered (stream delegates image turns to buffered orchestrate). VISIONDBG stripped (`032ce9e`).

**Live-verified on `m8-alpha.vercel.app`:** PNG read 4/4, JPEG read clean, quota → honest
`IMAGE_FALLBACK` (not "what image?"). Traces now record image turns (`intent=NONE, search=False,
prov=gemini, ok=True`). **Build-37 now live-verified** (S1 degenerate honest "blank", S2 reads, S4
no downstream confab). Offline: image-attachment 25/25, vision-blind 20/20, attachment 21/21,
fleet-routing 19/19.

**Lesson for next time:** when a new feature adds a turn-type gate (like `imgTurn`), evaluate it
BEFORE every pre-existing early-return that can swallow the turn — and trust the *trace absence* over
a "payload looks correct" round-trip when diagnosing a dropped-modality bug.

---

## Where we are (all shipped + pushed)

| Commit | What |
|---|---|
| `c5023d0`/`032ce9e`/`7ca2484` | **Build-34 LIVE VISION FIX (Session-34).** Hoisted `imgTurn` + gated the clarify/doc early-returns on `!imgTurn`; VISIONDBG stripped; plan updated. Live-verified (see top). |
| `aa18326` | **Build-37 — Silent Vision-Miss Guard.** Success-path guard: an image turn whose reply denies sight ("I can't see images") → honest `IMAGE_BLIND_RESPONSE`, not a blind reply a later turn confabulates from. `VISION_BLIND_RE` + `SAW_IMAGE_RE` veto; precision-guarded so the legit "too blurry to read" hedge survives; success-path only. **Offline `vision-blind-verify.ps1` 20/20; now LIVE-VERIFIED (Session-34).** |
| `c51efb2`/`f1f627a`/`25a3e62` | **Team Round 5** brief + synthesis (all 5 crew). Headline: best-of-N integrity holds *by construction*; real risk = selection integrity. Per-probe audit: **14/14 carry their anti-fab signal in an `absent` check.** Decisions: Build-37 = vision guard (done); Build-38 = provenance-at-ingestion; epistemic axis deferred ("trust before taxonomy"). |
| `12fbd57`/`2342cc9` | **Build-36 — best-of-N L5 gate relaxation.** Framing-only flakes re-run (default N=3); fabrication-class (`absent`/`refusal`/`anyOf`) = instant hard block, never re-run. `loop-verify.ps1` 52/52; combined live dry-run 14/14 → ATTEST PASS. |

Also: `M8-L5-Nightly-Attest` task re-registered (StartWhenAvailable, battery-resilient, 1h limit; `CRON_SECRET` confirmed User-level; still Interactive logon — S4U needs an elevated shell).

---

## ✅ SESSION-35 (2026-06-15, Opus): Build-39 shipped + live-verified; CRON_SECRET closed

- **Build-39 — read-path trust tiers** (`85f7752`, pushed, LIVE on deploy `6215582`). `renderGraphPacket`
  groups recall nodes into VERIFIED/EMPIRICAL/HEURISTIC/UNVERIFIED/REFUTED tiers (most-trusted first,
  cosine order within tier), flags `confidence<0.5` non-proven nodes "low confidence", appends a TRUST
  TIERS directive. Makes Build-38's `verification_state`/`confidence` ACT on the read path. No migration.
  `tests/trust-tier-verify.ps1` 12/12; live query narrated under verbatim Empirical/Unverified headers,
  flagged the [SPECULATIVE] claim, and refused to invent a VERIFIED node when none was in top-k.
- **CRON_SECRET in Vercel prod — CONFIRMED enforced** (unauth `/api/graph-relabel` → 401). Backlog
  item CLOSED — no action was needed.
- **`/api/health` now reports `deploy.sha`/`ref`/`env`** (`6215582`) — deterministic deploy-confirm so a
  live test can verify WHICH commit is serving (closes the push→serve-lag gap the live-test docs flag).
- **Build-40 — self-status search-routing guard** (`073150a`, pushed, LIVE on its own deploy).
  "what's your most recent build?" no longer web-searches Windows updates: shared `SELF_STATUS_RE`/
  `isSelfStatus` in `lib/intentClassifier.js`, `classifyIntent`→NONE for self-status, orchestrator ORs
  it into `buildQuery` at both sites. Fixed the stale `classifier-test.js` import too.
  `tests/intent-routing-verify.ps1` 26/26; live Q1 (self-status→build state, no search) + Q2
  ("latest keeta news"→still searched) both PASS.
- **NEXT in order:** #3 **full epistemic axis** (now unblocked — "trust before taxonomy" satisfied by
  Build-38/39). Then backlog: #12 search UNDER-routing (needs an example corpus first; build-state feed
  also lags — names Build-37 as "most recent"), #11 open-conjecture literature seed reads `empirical`
  (Build-38 classification refinement). See HONESTY_TRACK_PLAN backlog for the full list.

## (historical) NEXT BUILD → Build-38 (vision now resolved)
**Provenance + `trust_state` at ingestion** (crew-unanimous Q2, "trust before taxonomy"). Extend Build-30
provenance beyond `m8_conversations` to **graph nodes + the Build-27 intake path**: every node carries
`source · timestamp · evidence_kind (hypothesis/experiment/result/failed_path) · confidence ·
verification_state` *before* graph expansion scales. Enabler for both the epistemic axis and L6.
*Files: intake / `lib/memory-graph.js`.* Then: broaden search routing (`lib/intentClassifier.js`);
the deferred full epistemic axis. Round-5 honesty follow-ups (per-attempt telemetry, selector-stress
probes, `GRAPH_EVIDENCE_CAP` verification, uncertainty-calibration probes) — see HONESTY_TRACK_PLAN backlog.

---

## Standing notes
- Live runs hit `m8-alpha.vercel.app` + cost Gemini quota — run deliberately; need explicit authorization.
- The nightly L5 attestation fires ~05:00 AST; with Build-36 the gate can now actually accumulate clean nights — watch the next few land + confirm the POST reaches `/api/loop-attest`.
- PS gotcha (bit us this session): `ConvertTo-Json` unwraps a single-element array → force the `attachments` JSON array by hand (see repro above).

## ✅ SESSION-36 (2026-06-15, Opus): FULL EPISTEMIC AXIS COMPLETE
- **Build-41 (`af8974f`)** + **Build-42 (`a5b6788`)** both SHIPPED + LIVE-VERIFIED. The honesty backbone
  is done: M8 reliably separates proven / guess / speculative, and handles fringe ideas without laundering
  them. Build-41 = neutral `speculative` bucket + schema edge-ban + Odysseus probe. Build-42 = kernel/leap
  split (real core vs speculative leap, two linked nodes, human-gated) + co-retrieval invariant. Specs
  `M8/BUILD_41_SPEC.md` + `M8/BUILD_42_SPEC.md`.
- **Decision (Muhammad, end of Session-36):** stop polishing honesty; turn toward USEFULNESS. Next session
  does the small search fix FIRST, then starts the big problem-solving engine.

## Kickoff prompt to paste into the next session
> Continue M8. Read `M8/HONESTY_TRACK_PLAN.md` + `M8/NEXT_SESSION_BRIEF.md` first. The full epistemic
> axis (Builds 41+42) is DONE + LIVE-VERIFIED — don't reopen it; the honesty backbone is finished.
>
> **Do these two things, in order:**
>
> **1. FIRST — fix search "under-routing" (backlog #12).** The problem: sometimes M8 answers a
> checkable, current-fact question from memory/training instead of looking it up, and can be wrong. The
> trap: if we make it search too eagerly, it does clumsy web searches for things it already knows and
> answers get worse. So the work is mostly JUDGEMENT, not code: **(a) first build a small corpus of real
> example questions M8 currently mis-handles** (a mix of "should have searched but didn't" and "correctly
> answered from its own knowledge — must NOT start searching these"), put it in a test file like
> `M8/tests/odysseus/` ; **(b) then make a conservative widening** of the search trigger in
> `lib/intentClassifier.js` that fixes the misses WITHOUT making it search things it already knows; **(c)**
> prove it with a PS-mirror test (no local Node) + measure the example corpus before/after. Keep the free
> Gemini/Tavily stack. Ship it the usual way: code → offline verify → confirm deploy via `/api/health`
> `deploy.sha` → live-verify (Gemini quota needs my OK). Keep it SMALL and safe — it's a modest win, not a
> big build.
>
> **2. THEN — start the big "problem-solving engine" build.** This is the real prize: M8 actually making
> progress on hard/unsolved problems, not just recording and classifying honestly. **Spec-first** — write
> `M8/BUILD_43_SPEC.md` proposing the smallest genuinely-useful next rung of the engine (look at
> `M8/NORTH_STAR.md` Track B + the existing generator/Lean/lemma-DAG pieces to find the real bottleneck),
> and ask me to pick the direction before building. Don't boil the ocean — propose one concrete, testable
> step.
>
> Standing rules: live runs cost Gemini quota + need my OK; `commitFamily` in `lib/buildState.js` is one
> ~30KB line — edit only via a unique-anchor replace, never load it into context; M8 lives in its OWN git
> repo (`github.com/Muhammedelhofy/M8-`), push there, not the Bolt repo.
