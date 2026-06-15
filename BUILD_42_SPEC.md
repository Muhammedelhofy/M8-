# Build-42 — Kernel/Leap Decomposition + Co-Retrieval Invariant (D3)

**Status:** SPEC. The "gem" of the epistemic axis, deferred from Build-41. Human-gated design LOCKED (Build-41 §4, Session-36).
**Builds on:** Build-41 (D1 neutral bucket + D2 edge-ban) · Build-38/39 trust layer · Build-27/28 ingest + `source_class`.
**Honesty contract:** carries all prior invariants. Adds no path to `proven`/`refuted`. `source_class` standing is still never assigned by autonomous LLM judgment. Free Gemini stack only.

---

## 1. The idea (team rule 1, 4/5)
An ingested **speculative** idea is split into TWO linked nodes:
- **kernel** — the true, established arithmetic/physical core ("the mod-9 digital-root cycle is real arithmetic"),
- **leap** — the speculative extension ("…therefore it encodes the energy-geometry of reality"),

linked **`leap —derived_from→ kernel`** with `metadata.decomposition = "leap_of_kernel"`. Two reasons it's two nodes, not one structured node: (a) kernels are **shared** across many leaps; (b) one combined node **pollutes the embedding** so a clean math query drags in the fringe half.

**Co-retrieval invariant (the honesty core):** recall must NEVER surface a leap without also surfacing its kernel + **both** classifications. Deterministic, code-level — not a prompt request.

---

## 2. Who confers "established" — human-gated, never autonomous
Autonomous LLM labeling of a half as "established" is the serious-vs-crackpot vibe-call the doctrine forbids, and would let M8 *generate* established standing for fringe-adjacent content (violates rule 3). So:

**At ingest of a `speculative` document**, one extra Gemini pass *proposes* a decomposition (kernel candidate + leap candidate). It is **NOT written** — it's stored on the source row (`pending_decomposition`) and surfaced in the ingest reply. Nothing enters the graph until Muhammad approves.

**On approval (`approveDecomposition`):**
- The **leap** node is created: `kind='claim'`, `source_class='speculative'`, `verification_state='unverified'` — by construction, no judgment needed.
- The **kernel** is resolved by a **deterministic match**, not by minting an LLM-judged "established" node:
  - Embed the kernel text, `graphMatch` it. If an **already-established** node (`source_class='established'`, OR a curated M2 literature seed `source='external'` with no `source_class`, OR a lean-`proven` theorem) sits at **cosine ≥ 0.82** (`NOVELTY_SIM_MIN`), **link the leap to THAT existing node** — the kernel is established *because it matches something already established*, and shared kernels fall out for free.
  - Else **mint a new kernel node**, `source_class='established'` **only if** Muhammad passed the explicit `kernelEstablished:true` flag on approval; **otherwise `source_class='speculative'`** (honest default: we couldn't independently establish it).
- Edge: `leap —derived_from→ kernel`, `metadata.decomposition='leap_of_kernel'`. (D2 allows `derived_from`.)

This keeps deterministic-first + "M8 reads, never generates fringe": M8 never *invents* an established fact — it matches one already in the graph, or defers to the human, or defaults to speculative.

---

## 3. Recall co-retrieval (deterministic) — `buildGraphContext` + `renderGraphPacket`
After the cosine match + `EVIDENCE_CAP` pass, before render:
1. Query `m8_graph_edges` where `rel='derived_from'`, `metadata->>'decomposition'='leap_of_kernel'`, and `src_id IN (matched ids)` → leap→kernel pairs.
2. For each matched **leap**, **force-include its kernel** node in the render set even if it missed the cosine top-k (cap the forced pulls at **4** to protect `GRAPH_EVIDENCE_CAP`/attention).
3. `renderGraphPacket`: annotate each leap line inline — `decomposed from kernel "<label>" [<kernel standing>]` — and append a **CO-RETRIEVAL NOTE** directive: a speculative leap is only meaningful next to its established/speculative kernel; never present the leap's claim as standing on its own. The kernel also renders in its own trust tier (Build-39), so both classifications are visible.

The reverse (a matched kernel with no leap) needs nothing — a kernel standing alone is honest and shared.

---

## 4. Schema (`migrations/m8_kernel_leap.sql`)
- **`m8_knowledge_sources`**: `add column if not exists pending_decomposition jsonb` — holds `{kernel:{label,content}, leap:{label,content}}` between propose and approve. No other schema change — `derived_from` + `m8_graph_edges.metadata` already exist (Build-10).
- Optional: a partial index on `m8_graph_edges ((metadata->>'decomposition'))` for the co-retrieval lookup. Small graph today — defer unless needed.
- Idempotent; mirrors the Build-41 migration header style.

---

## 5. Code
**`lib/knowledge-intake.js`:**
- `DECOMP_SYSTEM` + `proposeDecomposition(title, text)` — Gemini pass (temp 0), strict JSON `{kernel:{label,content}, leap:{label,content}} | null`; validated, fail-safe → null. Reasoning lives in the prompt (crystallization pattern). The prompt instructs: kernel = the part that is established/real independent of the speculative framing; leap = the speculative claim built on it; return null if the text has no separable established core.
- In `buildKnowledgeIngestContext`, when `source_class==='speculative'`: after extraction, call `proposeDecomposition`, store on the source row, and append a `KERNEL/LEAP PROPOSAL` block to the ingest packet ("approve with `approve decomposition <source_id>`"). Non-fatal — a null proposal just omits the block.
- `resolveKernelStanding(matchSim, matchIsEstablished, kernelEstablishedFlag)` — **pure** predicate (mirrored in tests): returns `'use-existing'` (sim≥0.82 & established match), else `'established'` (explicit flag), else `'speculative'`.
- `approveDecomposition(source_id, { kernelEstablished=false })` — reads `pending_decomposition`, resolves the kernel (match-or-mint per §2 via `resolveKernelStanding`), writes leap + kernel (when minting) via `populateGraph`-style inserts, adds the `derived_from`/`leap_of_kernel` edge, clears `pending_decomposition`. Returns a summary. Fail-safe.

**`lib/memory-graph.js`:**
- `fetchKernelLinks(leapIds)` — returns `Map(leapId → {kernelId, kernelLabel, kernelClass})` from the `leap_of_kernel` edges (one query; selects edge `metadata` + joins kernel node label/source_class).
- `buildGraphContext` — after matches: `fetchKernelLinks`, force-pull missing kernels (cap 4), pass the link map to `renderGraphPacket`.
- `renderGraphPacket(det, matches, edges, farNodes, kernelLinks)` — inline leap annotation + the CO-RETRIEVAL NOTE.

**`api/knowledge-extract.js`** (or a small new `api/knowledge-decompose.js`): expose `approveDecomposition` so it's reachable without a chat command. A chat command (`approve decomposition <id>`) is OPTIONAL polish — the pending-review chat lane isn't wired today either.

---

## 6. Tests — `tests/kernel-leap-verify.ps1` (PS mirror, no Node)
- `resolveKernelStanding` truth table (sim/established/flag → use-existing | established | speculative).
- `parseDecomposition` shape validation (good JSON → pair; missing half / prose / fences → null).
- Co-retrieval: given synthetic matches + `leap_of_kernel` edges, assert (a) every matched leap's kernel ends up in the render set, (b) the forced-pull cap = 4, (c) a matched kernel with no leap pulls nothing, (d) the leap annotation names its kernel + class.
- D2 regression: a `leap —supports→ kernel` edge would be BANNED (only `derived_from` is the decomposition relation) — confirms the edge model respects Build-41 D2.

---

## 7. Verification sequence
1. Offline: `kernel-leap-verify.ps1` green + Build-41 mirrors still green.
2. Deploy-confirm via `/api/health` `deploy.sha`.
3. **Live (needs Muhammad's OK — Gemini quota AND it WRITES test nodes to the real graph):** ingest a small speculative doc with a clean kernel/leap split (e.g. a vortex-math paragraph), confirm the proposal, approve it, then recall the topic and confirm the leap renders only alongside its kernel with both classifications. Clean up the test nodes after if desired.

---

## 8. Open sub-decisions (resolve if they surface during build)
- Per-**document** decomposition (one kernel/leap) vs per-**claim** (a kernel/leap per speculative claim). Spec assumes **per-document** (one proposal per ingest) for simplicity; revisit if a doc clearly carries several independent ideas.
- Whether to mint a brand-new kernel at all when no match is found, vs requiring the human to confirm the kernel text first. Spec mints a **speculative** kernel by default (honest, non-elevating) — safe.
