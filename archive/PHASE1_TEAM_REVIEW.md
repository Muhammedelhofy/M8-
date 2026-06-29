# M8 — Phase 1 Intent Brain · Team Review Brief
**To:** GPT / Grok / Gemini / Manus · **From:** Muhammad + Claude Code · **Date:** 2026-06-24
**Ask:** Pressure-test the *real, shipped* Phase 1 code (not a plan). Be blunt — we want failure modes, not praise.

---

## Context (1 minute)
M8 is a personal AI assistant. Its lanes (money/tasks/notes/fleet) were a **keyword router in front of a context-starved LLM** → it got lost on typos/synonyms and looped. We're upgrading to **intent routing** (AI understands first, then calls the SAME confirm-gated actions). Full plan: `INTENT_UPGRADE_ROADMAP.md`.

- **Phase 0 (done, live):** deterministic safety net — unhandled money/task/note request → plain "here's what I can do" instead of a loop.
- **Phase 1 (done, live — THIS REVIEW):** the **wallet** lane got an AI intent brain. Verified live: "throw 30 egp to groceries", "put down fifty riyals for lunch", Arabic "حط ٥٠ ريال غدا" (with a typo) all understood → correct confirm → logged right.

## Locked invariants (do NOT propose breaking these)
- **AI proposes, locked code disposes** — the model returns a *proposal*; deterministic code executes the same confirm-gated, scoped actions. No new authority.
- **Privacy:** the model sees **only the live message** — never stored balances/history, never conversation history, nothing money is logged. (Owner's explicit, deliberate choice.)
- **Fail-safe:** low confidence / timeout / model-down → null → Phase 0 net answers.
- **Kill switch:** `M8_INTENT_BRAIN_DISABLED=1` reverts to Phase 0 instantly.

## What shipped
- **NEW `lib/intent-router.js`** — `classifyMoneyIntent(message, categories)` → fast FREE model (Groq-first via the existing multi-provider chain), strict JSON `{kind, amount, currency, category, note, confidence}`. temp 0, maxOutputTokens 200, thinkingBudget 0, 6s hard timeout. Validates kind ∈ {add, edit_last, delete_last, total, category, unknown}, clamps category to the allowed list, coerces types.
- **`lib/orchestrator.js`** — wired as the wallet lane's **second stage**: existing keyword parsers run FIRST (instant, free); the AI fires ONLY when they miss AND the message is "money-plausible" (currency/expense/spend signal) AND it's not a fleet/finance query. The proposal maps to the existing add/edit/total/category actions; `delete_last` is understood but stays honest (no chat delete power). `pendingExpenseFromHistory` now reconstructs the pending expense from OUR confirm prompt so AI-detected adds survive the follow-up "yes".

Public repo (read the real code):
- `lib/intent-router.js` → https://github.com/Muhammedelhofy/M8-/blob/main/lib/intent-router.js
- `lib/orchestrator.js` (search `PHASE 1 — INTENT BRAIN`) → https://github.com/Muhammedelhofy/M8-/blob/main/lib/orchestrator.js

### Core module (inline for convenience)
```js
// classifyMoneyIntent: returns a validated {kind,amount,currency,category,note,confidence} or null.
// Privacy: contents = ONLY the live message; not logged. Fail-safe: any error → null.
async function classifyMoneyIntent(message, categories) {
  if (process.env.M8_INTENT_BRAIN_DISABLED === "1") return null;
  const text = String(message || "").trim();
  if (!text) return null;
  // ... builds a strict-JSON system prompt with the allowed category list + few-shot examples ...
  const call = generate({
    systemInstruction: buildMoneyPrompt(cats),
    contents: [{ role: "user", parts: [{ text }] }],     // ONLY the live message
    providerOrder: "groq,cerebras,gemini,gemini2,mistral,openrouter",
    genConfig: { temperature: 0, maxOutputTokens: 200, thinkingBudget: 0 },
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("intent timeout")), 6000));
  let raw; try { raw = await Promise.race([call, timeout]); } catch (e) { return null; }
  const obj = extractJson(raw);                          // strips fences, parses first {...}
  if (!obj || !MONEY_KINDS.includes(obj.kind)) return null;
  // validate category against allowed list, currency ∈ {SAR,EGP}, clamp confidence 0..1
  return { kind, amount, currency, category, note, confidence };
}
// caller (wallet lane), after all keyword parsers return null:
if (_MONEY_PLAUSIBLE.test(m) && !looksFleet(m) && !looksFinance(m)) {
  const it = await classifyMoneyIntent(m, EXPENSE_CATEGORIES);
  if (it && it.confidence >= 0.6) { /* map add/edit_last/delete_last/total/category → existing confirm-gated actions */ }
}
```

---

## Review questions (the sharp ones — push back hard)
**A. Privacy.** Is "model sees the live message only, nothing stored, nothing logged" actually airtight given the provider fallback chain (Groq/Gemini/etc.)? Any leak vector we missed (provider-side logging, the few-shot prompt, error paths)?

**B. Reliability / safety.** Failure modes of a free-model classifier: hallucinated amount, wrong currency, wrong category. The confirm card is the backstop for writes — is that enough, or do specific kinds need extra guards? Is **confidence ≥ 0.6** the right gate? Should medium confidence force a clarify instead of a confirm?

**C. The "never guess between multiple matches" rule.** We don't do arbitrary-transaction delete yet (only edit/delete of the LAST M8-added expense). When we add real delete, what's the safest disambiguation design?

**D. Latency / cost.** One AI call inserted into the wallet path, gated to money-plausible misses. Is the gate (`_MONEY_PLAUSIBLE` + not-fleet/finance) tight enough? Is Groq-first the right order for a strict-JSON classifier? Any reason to prefer JSON-mode/responseSchema where the provider supports it?

**E. Architecture / scaling.** Is "keyword fast-path first, AI on miss" the right pattern to spread to Tasks / Notes / Fleet (Phases 2–4)? Should the classifier become one generic `classifyIntent(domain, message)` or stay per-lane?

**F. Phase 4 — the live fleet trap.** Today an unknown message can be grabbed by the Fleet lane and looped into "which driver account?" ("make me rich" did this). Fleet is the owner's **live job tool** — what's the safest way to let intent routing fix this WITHOUT risking the daily fleet workflow?

## Out of scope (don't re-open)
M8's existence (un-parked, settled) · the privacy posture (owner's explicit choice) · the phased plan order · adding paid models (free-stack default).

## Response format
Per question (A–F): a one-line verdict (sound / risky / change-it) + the specific change if any. Lead with the **single highest-risk thing** you'd fix before we spread this to the other lanes. Anti-sycophancy: if it's fine, say "fine" and move on — spend your words on real risks.
