# Build-168 Live Test — context-packet telemetry (E2 step 1: MEASURE)

**What shipped:** every chat turn now records WHAT was stuffed into M8's context
and HOW BIG each piece was — labels + character counts only, never content.
Nothing about routing or answers changes. This is the evidence base for the
context diet (E2 step 2 — the mid-chat-drift fix).

**Kill switch:** set `M8_CTX_TELEMETRY=off` in Vercel env + redeploy → telemetry
fully silent, behavior byte-for-byte identical either way.

## Live checks (on m8-alpha, after deploy READY)

1. **Ask anything in M8 chat** (e.g. "how did the fleet do yesterday?").
   The answer must be normal — same speed feel, same content. Telemetry is invisible.

2. **Ask M8: "show my recent misses"** — the misses list works as before
   (ctx rows share the table but use lane `ctx:packet`; the miss reader is
   unaffected because it lists whatever is newest — if ctx rows crowd the list,
   that's cosmetic and noted for B-169).

3. **DB proof (the real verification):** in Supabase → `m8_router_misses`,
   filter `lane = ctx:packet`. Expect one row per chat turn like:
   `L:fleet TOT:18432 H:12t/9301c SYS:3400 FLEET:9800 MEM:1200 ...`
   - `TOT` = full instruction-packet size in characters
   - `H:12t/9301c` = 12 history turns / 9,301 chars sent alongside
   - each label = one context section and its size

4. **Vercel runtime logs:** filter for `ctx:telemetry` — full JSON per turn.

## What we're looking for over the next 2–3 days (feeds B-169, the diet)
- Which section dominates TOT on the lanes where drift happens (general/knowledge)?
- How big does H (history) grow in a long chat before answers degrade?
- Any large HEAD/unlabelled mass = a section we haven't tagged yet.

## Chat questions for the live session
- "how did the fleet do yesterday?" (fleet lane)
- "what does my CV say about leadership?" (knowledge lane)
- a 10+ turn casual conversation, then check whether TOT and H grew linearly
  (that growth curve IS the drift suspect).
