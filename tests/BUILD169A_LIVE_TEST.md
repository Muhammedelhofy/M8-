# Build-169a Live Test — follow-up gate on the context lean (the "catch a word" fix)

**What shipped:** the wallet/fleet "topic stickiness" (conf 0.60) now only fires on turns
that actually look like follow-ups ("in EGP", "what about last week?"). Full novel
questions stay neutral, so web/knowledge/chat routing wins — and the fleet packet no
longer hijacks (and search-blocks) unrelated turns.

**Kill switch:** `M8_LEAN_GATE=off` in Vercel env + redeploy → old unconditional lean.

## Live checks (m8-alpha, phone) — replay YOUR OWN failing conversation

Ask a wallet question first (to make the context sticky), e.g. "my total expenses in june".
Then, without changing topic manually:

1. **"What is the result of Senegal vs Belgium in world cup 2026?"**
   → must NOT say "No expenses this month" — expect a web-search answer (or an honest
   "not found"). 🔴 the exact live bug.
2. **"What is the weather in riyadh today?"**
   → must NOT claim "no real-time access" — expect a live web answer. 🔴 the exact live bug.
3. **"What date is today?"** → a normal date answer, no fleet/wallet packet behaviour.

Then confirm follow-ups still work (the lean's original job):
4. "my total expenses in june" → wallet ✅ → then **"and in EGP?"** → still wallet,
   converted — the lean must STILL fire here.
5. "how did the fleet do yesterday" → fleet ✅ → then **"what about last week?"**
   → still fleet.

DB check (optional): `m8_router_misses` — the gated turns log `why=lean_gated`;
`ctx:packet` rows for turns 1–3 should show NO `FLEET:` ~9.6k block anymore.
