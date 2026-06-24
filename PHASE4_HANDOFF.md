# Intent Routing — Phase 4 (Fleet RESHAPE) Handoff

**Tracker:** `INTENT_UPGRADE_ROADMAP.md` (status table + changelog). **This stream's canonical doc.**
**Prod (origin/main):** ✅ `abbd64c` — **ALL phases 0/1/1.1/2/3/4 LIVE on m8-alpha.**
**Phase 4:** Build-130 + Build-131 — **DEPLOYED to prod 2026-06-24.** Rollback = Vercel → `67f8c8b`.

---

## Where Phase 4 stands

**Status: ✅ DEPLOYED + load-verified (prod build READY, `/api/chat` 405). Awaiting his LIVE behavioral confirm.**
This was the **last phase** — the all-lanes intent-routing upgrade (0→4) is now COMPLETE.

- **Change:** `lib/fleet.js` ONLY (chat fleet lane's `buildFleetContext` entry/gating). The orchestrator
  just calls `buildFleetContext`, so buffered + streaming are both covered with zero edits to the shared
  file. **Bolt sync (MHMBOLT) + 7am brief untouched. Fleet stays READ-ONLY.**
- **The fix:** the "make me rich" → "which Bolt account?" loop. A bare short reply after a fleet turn was
  treated as a driver name and forced onto the fleet path, bypassing the known-driver check. Now: unknown
  text falls through to chat (no loop); a real driver name still resolves; verb-phrase asks for an unknown
  driver still get the honest read-only not-found. Plus a fleet capability reply at no-data dead-ends.
- **Offline:** `tests/phase4-fleet-gate-test.ps1` → **24/24**.
- **Preview:** Vercel dpl `87iUHcn9…` READY (12 lambdas = bundled clean). 405 probe blocked by SSO 401
  (normal for previews) → READY is the load proof.

---

## What HE does next (I can't — it's his device/prod chat)

1. **Live-test Phase 4** on the `phase4-fleet` preview *or* after deploy — see `tests/PHASE4_FLEET_LIVE_TEST.md`.
   The key check: in a fleet conversation, type **"make me rich"** → should get a normal chat reply, **NOT**
   "which account?". Plus the regression checks (real fleet queries still work).
2. **Also still pending his live confirm:** Phase 3 (tasks/notes) per `tests/PHASE3_*_LIVE_TEST.md` —
   "note the rent is due" → 📝 Noted (+ shows in Notes), "delete it" → confirm → deleted, "mark it done" /
   "scratch it" on a task, "change to 43" → update card. (Deployed on `67f8c8b`; awaiting his thumbs-up.)
3. **Say "go"/"deploy"** → I merge `phase4-fleet` → main (ff), Vercel auto-deploys, I verify build READY +
   alias, then add the "Phase 4 DEPLOYED" roadmap entry.

---

## Recommended follow-up (separate build — NOT folded into Phase 4)

**Wallet privacy-strip residual (fix #1):** a money sentence with **no currency word** ("throw 30 to it")
still reaches the LLM on a fall-through — the only open privacy-invariant gap. Cleanest fix: have the wallet
lane **TAG** the turns it claims for stripping, instead of re-detecting in `stripMoneyHistory`. ~10-min wallet
build, disjoint from fleet → do it as its own commit next session.

---

## Constraints (unchanged)

- **Never `git add -A`** — add files by name. **No Node locally** — tests are PS-5.1 mirrors.
- **Vercel 12-function cap** — never add `api/*.js`.
- **Fleet is READ-ONLY** — never grant it a write. **Financial text never enters an LLM** (privacy wall).
