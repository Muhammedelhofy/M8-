# M8 Session Handoff — 2026-06-12 (Session 6)

## Read this first. It is the single source of truth for where M8 stands right now.

---

## What shipped this session

### Build-6b — Compound search→compute — `f57c0b2` (+ probe-band fix; shipped after Build-5, same session)

The case Build-6 deliberately left: a query needing a LIVE value (FX rate, market price) AND arithmetic over it. **The bug it fixes:** "convert 50,000 SAR to USD" matched `COMPUTE_HEURISTIC`, the Build-6 gate suppressed search, and Gemini converted at a REMEMBERED training-data rate — a live-value fabrication.

- `COMPOUND_HEURISTIC` + `detectCompound` (`lib/orchestrator.js`): currency amount A→B conversions; current/today/live price + a quantity. Fixed-factor conversions (km→miles) and self-contained math stay on the plain compute lane.
- SLOT 2a compound search: fires regardless of intent classification and even when computeMode hijacked the turn; the fleet/finance/eosb/state/notebook hard-routes still win.
- Sequential ownership: `useCompute` includes compound; the COMPUTE contract is excluded on compound turns (its "never attach external citations" line would fight the required rate citation — the SEARCH contract rides with the results) + `COMPOUND_DIRECTIVE` (take the value from the cited source, compute with code, flag the as-of; empty search ⇒ give the formula, never a remembered rate).
- `toolDecision = "search_compute"`.

**Build-6b verification:** new `tests/compound-verify.ps1` 27/27; regression ports tool-decision 27/27, compute-autoroute 40/40, notebook 54/54, discovery-b2 50/50. LIVE: "Convert 12,500 SAR to USD at the current exchange rate" → **3,337.50 USD at a cited live 0.267 rate, computed in the sandbox** (sources named, fluctuation flagged). Live eval `tool_decision`: both new probes pass (`tool.compound_fx_live` 3/3 after widening the band to 3,3xx — live quotes 0.2664–0.267 straddle the 3.75 peg; `tool.fixed_factor_no_compound` 2/2).

**Known issue caught during verification (pre-existing, NOT a Build-6b regression):** under back-to-back eval load, the free fallback provider occasionally answers a compute probe with a WRONG figure while claiming "computed in Python" (9^11 → 313,810,596,091 instead of 31,381,059,609). Gemini-served runs are correct (2/2 on standalone re-runs). The documented fix is the pending OpenAI paid-key backstop.

---

### Build-5 — Known-thread read inference — `74063f3` (shipped after Build-4, same session)

"any progress on collatz?" carries no notebook/research keyword and no where-are-we stem, so `detectNotebook` missed it — the turn fell through to search/LLM, the same confabulation class Build-4 closed for WHERE_ON, through a different entrance. Now:

- `PROGRESS_STEM` + `matchKnownThread` + `inferKnownThreadRead` (`lib/notebook.js`): a progress-stem message whose topic matches a thread that ACTUALLY EXISTS routes to that thread's structured briefing. Unknown topics ("any progress on the visa?") fall through untouched — the registry is the gate, mirroring the known-driver registry pattern.
- Ephemeral sessions match against the in-session staged registry (history-replay) — the hermetic invariant holds.
- 30s registry cache on `getActiveThreads` (invalidated on write) so casual "how's it going?" turns don't pay a Supabase query each time. `NOTEBOOK_REGISTRY_TTL_MS` env override.
- Generic/default threads (`general`, `research`) can never match a message.
- `buildState.js` brought current per the update-on-ship discipline (it was stale at 2026-06-10 — Builds 2–5 added).

**Build-5 verification:** notebook-verify 54/54 (13 new checks), discovery-b2 50/50, live deploy probe returned the structured briefing ("CONJECTURE: every orbit eventually reaches 1 … NEXT STEP: none recorded"), research_notebook live eval 10 probes with both new probes (`known_thread_inference` 4/4, `unknown_topic_no_hijack` 3/3) passing, odysseus_redteam re-run 10/10 (no regression). One flaky miss on `notebook.discovery_loop_chain` (3/5, 11s fallback-model run) — manually re-run immediately after and produced a full pass (Step 1/2 + bounds + logged + ▶ coda); known eval-noise class, not a regression (Build-5 doesn't touch discovery turns).

---

### Build-4 — Notebook Intelligence Layer + WHERE_ON confabulation fixes — `5543f67`

**Step 1 fixes (the two Build-3 misses):**

**Fix A — `renderEmptyPacket` hardened (`lib/notebook.js`)**
The old empty packet ("nothing is recorded yet… do NOT invent findings") was soft enough for the LLM to override with training knowledge. New packet:
- Opens "RESEARCH NOTEBOOK — CONFIRMED EMPTY."
- States "The database returned ZERO entries for the '[thread]' thread."
- Names the forbidden class: "Any specific number, bound, milestone, or researcher result you name would be a fabrication pulled from training data."
- Mandates the opening line: "You MUST open your reply with 'Nothing recorded yet for [thread].'" and bans outside-world context.

**Fix B — `rt.loop_followup_bare` probe bound 3,000 → 7,777** (`tests/eval/probes.js` + `run-eval-live.ps1`). The LLM was claiming round bounds were "already verified"; 7,777 forces a fresh run that produces the `▶ Next probe` coda turn 2 needs.

**Step 2 — the intelligence layer (all in `lib/notebook.js`):**

**2A — Thread registry.** `getActiveThreads()` returns every distinct current thread with entry count + last-touched date. A bare or GENERIC read ("where are we on our research?" parses to thread=`research`, caught by `GENERIC_THREAD_RE`) now renders `renderRegistryPacket` — a real list the LLM reads from, closing fabrication at the root: "RESEARCH NOTEBOOK REGISTRY — N active threads … These are the ONLY threads on record."

**2B — Structured thread summaries.** `renderThreadPacket` reorganised into labelled sections: CONJECTURE (latest, with +N-earlier count) / EVIDENCE FOR / EVIDENCE AGAINST (newest-first, max 3) / COUNTEREXAMPLE / DEAD ENDS (max 3) / NOTES / STATUS (singleton) / NEXT STEP (singleton), closing with a "narrate as a research briefing, invent nothing beyond the packet" directive.

**2C — Write-kind inference.** `inferKind(message)` classifies a bare `notebook:` statement with no explicit kind word: "I think / I believe / hypothesis / propose" → conjecture; "dead end / doesn't work / failed / tried and / ruled out" → dead_end; "counterexample / found a case where / breaks down at" → counterexample; "next step / should try / plan to" → next_step; "found that / shows / confirms / supports / verified" → evidence (for); "status is / update / currently" → status; fallback note. Rule order: specific outcomes before loose stems. The logged packet tells the LLM to say which kind was inferred; the inference is logged in the `notebook_context` trace (`inferredKind`).

**2D — 4 new eval probes** (`research_notebook` category, JS + PS mirror): `notebook.thread_registry_overview`, `notebook.structured_summary`, `notebook.kind_inference_conjecture`, `notebook.kind_inference_dead_end`.

**Bonus architectural upgrade — hermetic history-replay.** Ephemeral (eval-prefixed) reads previously always returned honest-empty, so a multi-turn probe could never test read-back. Now `stagedNotesFromHistory(history)` replays the conversation's own notebook WRITES from chat history (user turns only) and serves reads from that — still ZERO DB contact (the hermetic invariant holds), but a probe that writes collatz + goldbach entries then asks "where are we on our research?" reads real in-session state. `registryFromNotes` groups staged notes into the registry shape (`last: "this session"`).

---

## Verification results (all run 2026-06-11)

| Suite | Result |
|-------|--------|
| `tests/notebook-verify.ps1` (port, +5 new inference checks) | **41/41** |
| `tests/discovery-b2-verify.ps1` (port) | **50/50** |
| `run-eval-live.ps1 -Only odysseus_redteam` (live) | **10/10 probes — 5/5** ✅ (was 8/10) |
| `run-eval-live.ps1 -Only research_notebook` (live, 8 probes incl. 4 new) | **8/8 probes, 30/30 checks — 5/5** ✅ |

Both Build-3 misses (`rt.loop_followup_bare`, `rt.notebook_bare_research`) now PASS. No failing tests.

Deploy verified live before the eval runs: "notebook: I think every Collatz orbit eventually hits a power of 2" → *"Logged to notebook (general): … (conjecture)."*

---

## Architecture snapshot (what's live right now)

```
orchestrate(message, history)
  │
  ├─ 1. FLEET HARD-ROUTE (looksFleet → lib/fleet.js)
  ├─ 2. FINANCE HARD-ROUTE (isFinanceQuery → lib/finance.js)
  ├─ 3. EOSB HARD-ROUTE (isEosbQuery → lib/eosb.js)
  ├─ 4. STATE HARD-ROUTE (isStateQuery → lib/state.js)
  ├─ 5. DISCOVERY / LOOP (detectDiscovery + detectFollowUpLoop → lib/discovery.js)
  ├─ 6. NOTEBOOK HARD-ROUTE (lib/notebook.js)
  │      ├─ WRITE: explicit kind OR inferKind() on a bare notebook: statement
  │      ├─ READ (specific thread): renderThreadPacket — labelled sections
  │      ├─ READ (bare / generic 'research'): getActiveThreads → renderRegistryPacket
  │      ├─ READ (empty / table missing): hardened renderEmptyPacket (CONFIRMED EMPTY)
  │      └─ EPHEMERAL (eval): stagedNotesFromHistory replay — zero DB contact
  ├─ 7. COMPANY HARD-ROUTE (lib/companies.js)
  ├─ 8. COMPUTE GATE (!computeMode → lib/llm.js Gemini code execution)
  └─ 9. TOOL DECISION (LLM picks: answer | search | clarify)
```

Steps 1–8 deterministic; LLM decides only at step 9. Hard-route order unchanged.

---

## Pending user action (still blocks full notebook persistence)

**Run the migration in Supabase:**
- Project: `ltqpoupferwituusxwal`
- File: `M8/migrations/research_notes.sql`
- Until this runs: real-session notebook writes acknowledge but don't persist; reads degrade to the (now hardened) honest-empty packet. Non-fatal everywhere.

---

## Current commit log

```
5543f67  Build-4: Notebook Intelligence Layer + WHERE_ON confabulation fixes
0945c1f  Add next session kickoff prompt (Build-4)
2121352  Update handoff: harness results 8/10 pass, two misses documented
0507c76  Build-3: Odysseus red-team probe battery
a6c20bd  Build-2 runtime fixes: WHERE_ON empty-packet + detectFollowUpLoop
```

---

## Next build options (Session 7)

1. **Compound search→compute** — ✅ DONE this session (Build-6b, `f57c0b2`).
2. **Known-thread inference** — ✅ DONE this session (Build-5, `74063f3`).
3. **★ Recommended next — Odysseus AI integration (red-team loop automation):** wire Odysseus-generated probe specs into the ingestion contract (already documented in `probes.js` comments) so the adversarial battery grows without manual authoring.
4. **OEIS probing (Track B / North-Star math track):** extend the discovery loop to OEIS-class sequence probing — pattern detection → conjecture → bounded verification → notebook log.
5. **OpenAI paid-key backstop:** kills the fallback-provider noise class (wrong figure + fake "computed in Python" claim — caught live on 9^11 this session) and the eval reasoning-axis noise.
6. **Wire the `tool_decision` DB column into logTrace** once Muhammad confirms the `request_traces` ALTER ran.

---

## Kickoff prompt for next session

Paste this at the start of the next conversation:

---

**Read `M8/SESSION_HANDOFF_2026-06-12.md` first.** Then proceed autonomously.

State: Build-4 (Notebook Intelligence Layer) is live at `5543f67`. odysseus_redteam 10/10, research_notebook 8/8 — no failing tests. The notebook now has a thread registry, structured summaries, write-kind inference, and hermetic history-replay for evals.

Standing user action: run `migrations/research_notes.sql` in Supabase (`ltqpoupferwituusxwal`) for real-session persistence.

NEXT BUILD — Muhammad's pick of the Session-7 options in the handoff (recommended: Odysseus integration or OEIS probing). Keep the standing constraints: api/ = endpoints only, no local Node (PS ports), don't push broken code, eval sessions stay hermetic, hard-route order fleet → finance → eosb → state → discovery → notebook → company → compute → search.

---

## Odysseus AI status

Experimental wing (red-team QA). Its 10 `odysseus_redteam` probes now pass 10/10 after Build-4 — the wing's first full adversarial round is closed out. Next step for the wing: automate probe generation through the ingestion contract (Session-7 option 1). Never touches the live spine.
