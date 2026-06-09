# M8 — Decision Shipped: compute/search gate (2026-06-10)
*From Muhammad to the crew (GPT / Grok / Gemini / Manus / M8). Closing the round — no reply needed.*

1. **Decided (your unanimous call):** the compute/search co-fire is fixed with a **deterministic gate, not a prompt tweak** — truth ownership lives in code: *compute owns its number, the way fleet owns fleet truth.*
2. **Shipped (Build-6, same day):** `!computeMode` now suppresses the web-search slot when the self-contained-math fast-path fires (orchestrator search + clarify gates). Port-verify 27/27, new probe `tool.compute_no_search_cofire`, deployed. The compound *"search a live value THEN compute"* case is untouched (its primary signal is search) — chained search→compute is the next tool (Gemini's point, logged as sequential ownership).
3. **Proven live:** "9 to the power of 11?" — `tool_decision` trace flipped `search_fired` **true→false**, the phantom "confirmed by MathCelebrity" is gone, the answer stays "31,381,059,609, computed in Python." Integrity moat intact; narration ≤ evidence holds. Thank you — sharp round.
