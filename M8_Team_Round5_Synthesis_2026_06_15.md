# M8 Team Round 5 — Synthesis
**Date:** 2026-06-15
**Crew:** M8 · GPT-4o · Grok · Gemini · Manus
**Brief:** [M8_Team_Brief_Round5_2026_06_15.md](M8_Team_Brief_Round5_2026_06_15.md)
**Status:** ✅ COMPLETE — all 5 in, synthesized by Claude.

---

## TL;DR

- **Q1 (best-of-N integrity):** The crew split cleanly on *whether they read `probe-class.ps1`*. Code-readers (Manus, GPT-4o) confirmed the integrity argument holds **by construction**; non-readers (Gemini, the late M8 pass) re-derived a *voting-ensemble* strawman M8 never built and raised laundering fears that don't apply. The threshold/2-of-3 worry is **already closed** (no partial acceptance; fabrication-class never re-run; 3 clean *nights* provide repeated sampling). The one genuine, unanimous-among-readers open item — **selection integrity / per-probe completeness** — was **audited this session: 14/14 probes carry their anti-fabrication signal in an `absent` check** (one optional hardening on `scaffold_not_proof` turn-1). N=3 stays; increase *night count*, not N.
- **Q2:** Unanimous top risk — **provenance + trust state at INGESTION, not retrofitted.** Plus selector/ranker/summarizer hallucination (a new test surface) and graph-bloat context dilution.
- **Q3 — Build-37 DECISION: Silent Vision Miss Guard.** Consensus ranking: vision guard → provenance/source-trust → search routing → full epistemic axis ("trust before taxonomy"). This **reorders** the prior backlog (search routing drops from #1 to #3).
- **Q4 — L6:** the first level where knowledge **compounds** — cross-session synthesis that auto-generates new research directions from accumulated, provenance-tracked, verified memory. M8's "autonomous proof-step generation" is sharper but is L6-late/L7.

---

## Raw responses (per crew)

### GPT-4o
Reframed Q1: the question isn't "can best-of-N launder fabrication?" but **"can a fabricated answer *win selection* despite the verifier?"** If the selector rewards completeness/fluency/specificity, yes — short truthful "I don't know" loses to rich "Conjecture #7 survived." Therefore order must be **fabrication-check → scoring → selection**, never scoring→check, "otherwise fabrication becomes a search strategy." Split "close to complete"; audit every probe for invented identifiers/statuses/counts; highest-risk = probes using only positive assertions. N=3 reasonable — **keep N=3 and increase night count.** Q2: biggest risk = **selector contamination** — "you now test generators; soon you'll need to test rankers, selectors, summarizers." Q3: **silent vision miss guard** — "a failed search is visible; a missed image is invisible → false confidence." Q4: L6 = **system-generated research memory *synthesis*** (not storage, not retrieval).

### Grok
_(Anti-sycophancy.)_ Best-of-N **can** launder intermittent fabrication where it's subtle (partial provenance hallucination, over-confident "verified" without an `EXEC_MARKER`/`/check`, memory replay dropping a failed path). N=3 marginal for high-stakes; the `absent`/`refusal`/`anyOf` split is incomplete if it doesn't weight *how* fabrication manifests (silent omission vs invented evidence vs stance creep). **Per-probe audit needed; any probe relying only on `present` checks is brittle.** Verdict: not airtight yet — best-of-N doesn't replace a single-turn honesty contract. Do-now: log **rejected**-sample fail patterns. Build: K-of-M with provider/temperature **diversity**. Test: measure laundering rate post-N=3. (Round-2) Add per-candidate verdict telemetry (`candidate_1..3 verdict / winner verdict`); Q3 vote **broaden search routing** ("acquisition without discovery becomes passive memory"); Q4 L6 = **cross-session hypothesis evolution — conjectures gain lineage.** Q2: knowledge intake grows faster than trust calibration — `source/trust/verification_state` **at ingestion**. Strategic asides: Track A ≥70%; 90-day Track B = FunSearch loop on simple Collatz invariants + Lean → 3–5 logged non-fabricated observations; FunSearch on Hobby = prototype only (real loops need ~$5–20/mo sandbox); honest solo 12-mo ceiling = strong ops co-pilot + small verifiable contributions, **not** an autonomous mathematician. *"Prioritize fixes that make best-of-N less necessary, not more. Push back on any relaxation of verification standards — that's the moat."*

### Gemini
Framed best-of-N as a dangerous "majority vote" — **but this misreads the design** (see Synthesis Q1; Build-36 is single-endpoint re-run, no vote, fabrication never re-run, no partial acceptance). The salvageable kernel: distinguish **Generation Integrity** (can a candidate fabricate?) from **Selection Integrity** (can the selector *prefer* fabrication?) — current work addresses the first; add probes where **truthful answer is short, fabricated answer is rich** (selector stress tests). Anti-fabrication must reside in a **deterministic** check (it does — .NET regex, not an LLM judge). Q2: highest risk = **graph provenance / context dilution (RAG poisoning)** — flooding the window pushes the Honesty Contract out of attention on Flash-class models; enforce a **hard deterministic cap on nodes/turn + edge truncation**. Every node stores `source/timestamp/confidence/verification_state` **before** graph expansion. Q3 vote: **source-trust infrastructure before more ingestion** ("otherwise garbage scales"). Q4: L6 = **automatically identifies contradictions across months of accumulated knowledge.**

### Manus
_(Read `probe-class.ps1`.)_ Q1: **No**, best-of-N does not launder — fabrication-class is never re-run, so intermittent fabrication eventually manifests as a hard fail. Split appears robust **provided** every anti-fabrication signal lives in a fabrication-class check; continuous battery audit is essential. N=3 defensible for framing flakes; a genuine honesty flake should be classed fabrication-class (and the system correctly prevents those from being absorbed). **Relaxed the measurement, did not lower the bar.** Q2: vision/search **asymmetry** — search failures visible, vision misses silently disappear → unequal confidence calibration; harden `IMAGE_FALLBACK`; intent classifier needs a more robust approach; intake expansion needs ongoing Odysseus coverage. Q3 vote: **silent vision miss guard** — "the only candidate that directly protects honesty; everything else increases capability." Q4: L6 = **research-agenda generation — multi-week plans**, then (fuller) **automated cross-domain hypothesis generation** (meta-pattern recognition across disparate problems). Also flagged: the battery should test **"was uncertainty represented correctly?"** ("*probably* conjecture #7 survived") beyond binary fabrication.

### M8 (self-assessment)
**Primary pass (sharper):** integrity argument **strong but not yet airtight**; the missing property is **selection transparency** — store `candidate / reason_selected / fabrication_verdict` per best-of-N run so future audits are possible. Top risks (ordered): missing provenance at ingestion → missing trust state on graph nodes → silent vision misses → selector-induced hallucination. Build-37 ranking: **vision guard → provenance → search routing → epistemic axis** ("the epistemic axis is useful only after trustworthy intake exists — **trust before taxonomy**"). L6 = **autonomous accumulation and synthesis** (paper June → graph July → contradiction Aug → direction Sept, no manual reconnection).
**Second pass (drifted):** evaluated best-of-N as a *multi-model vote* ("2-1 split," "outvoted") — a misread of the single-endpoint design; correctly *stated* the guardrail ("selection, not repair") while assuming it was violated. Salvage: provenance tracing + a visible **grounding-confidence score** (= the telemetry point). Voted reopen epistemic axis (conflicts with its own "trust before taxonomy") and L6 = autonomous proof-step generation (→ classed L6-late/L7 here).

---

## Question 1 — Build-36 best-of-N red-team

**The defining pattern of this round:** responses split on whether the author read the implementation. **Manus and GPT-4o** (code-grounded) converged on the real risk; **Gemini and M8's second pass** re-derived a *voting-ensemble* design — "2/3 majority," "2-1 split," "most fluent candidate wins" — that **does not exist**. Build-36 is: same probe, same endpoint, re-run up to N; first **fully-clean** attempt wins; a fabrication-class miss is **never re-run** (instant hard fail). There is **no partial/majority acceptance anywhere** ([run-battery.ps1:261](tests/odysseus/run-battery.ps1)), and the gate's "3" is **3 clean nights** ([loop.js:45](lib/loop.js)), not 3 attempts.

- [x] **Verdict: integrity argument is airtight against the threshold/laundering objection — by construction.** No partial acceptance; fabrication-class never re-run; 3 consecutive clean *nights* are the repeated-sampling mechanism that catches an intermittent fabricator over time. GPT-4o's framing is the correct one: the only real risk is **selection integrity** — can a fabrication *win* despite the verifier? — and that reduces entirely to per-probe coverage completeness.
- [x] **Per-probe audit (RUN THIS SESSION): 14/14 probes carry their core anti-fabrication signal in an `absent` check.** Detail:
  - **battery-l5 (6/6):** every probe pairs a `present` framing check with an `absent` anti-fabrication check (`autonomy_no_discovery`, `gate_not_truth`, `m4_human_architected`, `no_overnight_promotion`, `no_false_promotion` [the refuse-correctly probe], `no_run_confabulation`). ✓
  - **battery-m3-armed (8/8):** anti-fabrication lives in `absent` checks on the *pressure* turn (`survivor_recall`, `survivor_vs_literature`, `novelty_narration`, `retrieval_flood`, `self_citation_loop`, `rank_not_novelty`, `queue_not_ranking`, `scaffold_not_proof`). Generation turns are `present`-only by design (they only assert framing; the overclaim bar is the later `absent`). ✓
  - **One hardening opportunity (not a hole):** `scaffold_not_proof` turn-1's honesty footer is a `present` check, and the anti-overclaim `absent` exists only on turn-2. Add an `absent` check to turn-1 (never asserts "proven/complete" *on the scaffold turn itself*) so the bar exists on both turns. Belt-and-suspenders.
  - **Confirms GPT-4o/Grok/Manus's exact concern and resolves it:** no probe's anti-fabrication signal lives *only* in a `present` check.
- [x] **N=3 vs alternatives:** keep **N=3**; consensus (GPT-4o, M8-self, implied Grok) is **increase the night count, not N** — more leverage, no extra per-night quota. fail-K-of-M-nights stays parked (only relevant if a genuine honesty flake ever reads as framing-only, which the classification prevents).
- [x] **Actionable fixes:**
  - **DO-NOW (done):** per-probe completeness audit — ✅ above, 14/14 clean.
  - **BUILD (small):** **per-attempt telemetry** — persist every attempt's verdict (clean / framing-miss / fabrication-miss), not just the chosen one, so the laundering rate becomes *measurable* (Grok + GPT-4o + M8-self all asked; this is "selection transparency"). Lands in `run-battery.ps1` + the attestation payload.
  - **BUILD:** **selector-stress probes** — short-truthful-vs-rich-fabricated pairs (Gemini, GPT-4o) added to `battery-realworld`/`confabulation_realworld`; these test selection integrity directly.
  - **BUILD (optional):** the `scaffold_not_proof` turn-1 `absent` hardening above.

**Did we relax or lower the gate?** Unanimous (once misreads are corrected): **relaxed the measurement** to absorb framing-class statistical noise; **did not lower the honesty bar** — any fabrication-class miss is still an instant, non-absorbable hard fail.

---

## Question 2 — Fixes / risks across Build-27→36

**#1 shared concern (Gemini, Grok, Manus, M8-self): provenance + trust state must exist at INGESTION, not be retrofitted.** Every node/note should carry `source · timestamp · evidence_kind (hypothesis/experiment/result/failed_path) · confidence · verification_state` *before* the Knowledge Acquisition Pipeline (Build-27) scales. Build-30 (provenance tagging on `m8_conversations`) is the right start but must extend to **graph nodes** and **intake**. Risk if not: "ghost threads" recalling a *rejected* path as active (Grok); "garbage scales" (Gemini).

**#2 Selector/ranker/summarizer hallucination (GPT-4o):** the Odysseus battery currently tests *generators*. As ranking/selection/summarization layers grow, each can hallucinate — a **new probe surface** to build out.

**#3 Context dilution / RAG poisoning (Gemini):** as M1/M2/M3 pump nodes into pgvector, semantic recall floods the window and pushes the Honesty Contract out of a Flash-class model's attention. Enforce a **hard deterministic cap on nodes/turn + edge-count truncation** before the payload hits the LLM. *(Note: `GRAPH_EVIDENCE_CAP` already exists — verify it's enforced as a hard integer cap, per `od2arm.retrieval_flood`.)*

**#4 Vision/search asymmetry (Manus, GPT-4o):** search failures are visible; vision misses vanish silently → unequal confidence calibration. Harden `IMAGE_FALLBACK` (→ Build-37).

**#5 Uncertainty representation (Manus):** expand the battery beyond binary fabrication to "was uncertainty represented correctly?" ("*probably* conjecture #7 survived" is a calibration miss even if not a direct fabrication).

---

## Question 3 — What should Build-37 be?

**Consensus ranking:**
1. **Silent Vision Miss Guard** — GPT-4o, Manus, M8-self (primary). Rationale: a silent failure in a core modality = invisible false confidence, the most dangerous honesty bug; small, high-leverage.
2. **Provenance / source-trust infrastructure** — Gemini, Grok, M8-self. "Trust before taxonomy."
3. **Broaden search routing** — Grok (round-2). Important, but it's an efficiency/coverage win, not a silent-honesty fix.
4. **Full epistemic axis** — Gemini, M8 (second pass). Real, but **deferred again behind provenance** — it's a taxonomy that needs trustworthy intake underneath it first.

- [x] **Crew recommendation + leverage point:** silent vision guard #1 (invisible false confidence), provenance #2 (enabler for both the epistemic axis *and* L6).
- [x] **DECISION: Build-37 = Silent Vision Miss Guard.** When an image turn gets a model-authored "I cannot see images / please provide the image" despite an attachment, **detect it and return the honest `IMAGE_FALLBACK`** instead of letting a later turn confabulate. *File: `lib/orchestrator.js` image path.* The throw-only guard misses this today. **This reorders the prior backlog** (search routing was #1; now #3). Provenance/trust-at-ingestion becomes the leading **Build-38** candidate.

---

## Question 4 — L6 definition

**Unified:** L6 is **the first level where knowledge compounds.** The first concrete capability is **not** better experimentation — it is **cross-session synthesis that automatically generates new research directions from accumulated, provenance-tracked, verified memory.**

Convergent framings: GPT-4o "research-memory *synthesis*"; Grok "cross-session hypothesis evolution — conjectures gain lineage"; Gemini "auto-identify contradictions across months"; Manus "research-agenda generation / cross-domain hypothesis"; M8-self "paper June → graph July → contradiction Aug → direction Sept, unprompted." All describe the same arc: **ingest → accumulate (provenance-tracked) → detect tension → propose direction, with no human manually reconnecting the events.**

M8's **autonomous verifiable proof-step generation** (generate steps → Lean → iterate, no human per step) is the sharpest and most *measurable* definition, but it is nearly the North Star itself — classed here as **L6-late / L7** (Grok's honest-ceiling caveat applies: not an autonomous mathematician on a solo $10–50/mo budget in 12 months). **Throughline:** L6 *requires* provenance + verification_state to exist first → reinforces the Q3 ordering. Provenance is the enabler for both the epistemic axis and L6.

---

## Cross-cutting meta-finding

The strongest signal of this round is **not any single answer** — it's that crew responses split cleanly on **whether the author read `probe-class.ps1`.** Code-grounded critiques (Manus, GPT-4o) found the real risk; the others re-derived a strawman. **Lessons:** (1) ship the actual diff/code *with* the brief and weight code-grounded critiques higher; (2) this is itself a live **selection-integrity** demonstration — a fluent-but-wrong critique (M8 second pass) must not be "selected" over a terse-correct one (Manus). The thing the crew warned about in the abstract (fluency winning over correctness) showed up *in their own responses*. That is the case for the per-attempt telemetry and selector-stress probes, in miniature.

---

## Decisions & action items

| # | Action | Type | Owner | Source |
|---|--------|------|-------|--------|
| 1 | Per-probe anti-fabrication completeness audit | **do-now ✅ done** (14/14 clean) | Claude | Q1 (Grok/GPT-4o/Manus) |
| 2 | Per-attempt verdict telemetry (log all attempts, not just chosen) → attestation payload | build (small) | `run-battery.ps1` | Q1 (Grok/GPT-4o/M8-self) |
| 3 | Selector-stress probes (short-truth vs rich-fabrication) | build | `battery-realworld` / `confabulation_realworld` | Q1 (Gemini/GPT-4o) |
| 4 | `scaffold_not_proof` turn-1 `absent` hardening | build (optional) | `battery-m3-armed.json` | Q1 audit |
| 5 | **Build-37 = Silent Vision Miss Guard** | build (NEXT) | `lib/orchestrator.js` | Q3 (consensus) |
| 6 | Provenance + trust_state at ingestion (extend Build-30 to graph nodes + intake) | build (Build-38 candidate) | intake / memory-graph | Q2 (unanimous) |
| 7 | Verify `GRAPH_EVIDENCE_CAP` is a hard enforced cap + edge truncation | verify / do-now | `lib/orchestrator.js` / graph recall | Q2 (Gemini) |
| 8 | Uncertainty-calibration probes (beyond binary fabrication) | build | battery | Q2 (Manus) |
| 9 | New probe surface for rankers/selectors/summarizers | defer (post Build-37/38) | battery | Q2 (GPT-4o) |
| 10 | Full epistemic axis | **defer** behind provenance ("trust before taxonomy") | — | Q3 |
| 11 | L6 = cross-session synthesis (north-star alignment; proof-step gen = L6-late/L7) | direction | — | Q4 |
