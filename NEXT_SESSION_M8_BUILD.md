# M8 app — next-session build brief

**Model/effort:** Opus + MAX (multi-file build touching the orchestrator + a money DB).
**Branch:** work in worktree `m8-scifi` on `fun/scifi-ui` (auto-deploys to prod `m8-alpha.vercel.app` on push to `main` — never deploy without Muhammad's OK). Repo `Muhammedelhofy/M8-`.

## Where things stand (all LIVE on m8-alpha, branch fun/scifi-ui)
- Sci-fi UI + installable PWA + voice (record → Groq `whisper-large-v3` via `/api/transcribe`).
- Reply modality: TYPE → text reply (silent); TALK → voice reply (`voice.muted` flag). Welcome is silent.
- **Tasks v1 SHIPPED** — `m8_tasks` table (M8 Supabase `ltqpoupferwituusxwal`), `api/tasks.js` (GET/POST/PATCH/DELETE), `js/tasks.js` + header glyph → slide-in panel (manual add/check/delete, due tags, overdue). Diagnostics + Tasks are slide-in panels (pattern to reuse).
- **Wallet DB access PROVISIONED + AUDITED** (Wallet Supabase `sjomysminfzohkbauahw`, household "Hofy Home" id `3c55a0a3-837c-41b8-96a9-abfe5395d3d7`): role `m8_wallet` (nologin, NOT superuser, NOT bypassrls) — SELECT on the 11 analysis tables, UPDATE on ONLY `transactions(amount,category,note,occurred_on,type)`, NO insert/delete, RLS-scoped to Hofy Home + `EXECUTE` on `user_household_ids()`. Verified: reads work (7 txns), DELETE denied, column-scoped UPDATE.
- **Env vars SET in M8 Vercel:** `WALLET_SUPABASE_URL=https://sjomysminfzohkbauahw.supabase.co`, `WALLET_JWT_SECRET` (the wallet's JWT secret) — for the read code to connect.

## BUILD 1 — Money: chat add/see + Money view (design LOCKED = blend of all 3 concepts)
**SCOPE UPDATED 2026-06-23 (Muhammad wants ADD-expense too):** v1 now = read + EDIT-existing + **ADD an expense**. So FIRST extend the wallet grants: `GRANT INSERT (household_id, member_id, type, category, amount, currency, occurred_on, note, payment_method) ON public.transactions TO m8_wallet;` + an RLS INSERT policy `with check (household_id = '3c55a0a3-837c-41b8-96a9-abfe5395d3d7')`. Still NO delete, nothing on loans/cards/balances. (Needs Muhammad's explicit OK to run on the money DB — he gave it 2026-06-23.)
`lib/wallet.js`: mint a short JWT `{ role:"m8_wallet" }` signed HS256 with `WALLET_JWT_SECRET`; bearer to the wallet's PostgREST; scoped to Hofy Home. `api/wallet.js`: GET summary + POST add-expense. **PRIVACY WALL (hard rule): wallet TEXT (note/category/counterparty) never enters an LLM prompt or a log — code computes totals + TEMPLATES.** Every write **confirm-gated** ("Add 30 SAR · lunch · Omar? yes/no").
**SAFETY/AUDIT (Muhammad asked): mark + log every M8 write.** (a) M8-added transactions carry a "[M8]" marker in the `note` so they're findable in the Wallet app. (b) A NEW `m8_wallet_writes` table in **M8's own** Supabase (`ltqpoupferwituusxwal`) records every write — action, wallet txn id, amount, category, note, ts — an independent trail to reconcile/undo if anything goes wrong.
**Money screen = blend:** budget ring (A) + In/Out tiles (B) + M8 insight cards (C) + an **"Open Wallet"** button → `family-wallet.vercel.app` (full app for anything M8 doesn't do). Slide-in panel, calm/low-noise, real data.
**Also: chat lane** — "add 30 sar lunch", "how much did I spend", "what's groceries this month" → confirm → insert/read → templated reply (works by voice too). This is the part Muhammad actually tested + wants.

## BUILD 2 — Tasks v2: chat-driven management
Orchestrator: detect "remind me to … / add task … / what's on my list / mark … done / delete …" (EN+AR) → CRUD via the tasks table → templated reply. Works by voice too (mic → transcript → same path). Keep it a hard-route lane (like the other deterministic lanes), don't let it stream past.

## BUILD 3 — Active reminders (the "bigger build" Muhammad flagged)
Passive first (small): due-today tasks appended to the existing 7am brief email (`morning-brief.js`/`notify.js`, Resend already wired). Active (real ping when app closed): Web Push — VAPID keys (env), a push-subscribe call + SW `push` handler in `sw.js`, and a cron that fires due-task pushes. Email-at-due-time is the simpler fallback.

## Nav
Tasks + Diagnostics + (soon) Money are slide-in panels off header glyphs. Decide later whether to promote to a real bottom nav (Chat | Tasks | Money | Home) per the image-5 model — only when it earns it; keep low-noise.
