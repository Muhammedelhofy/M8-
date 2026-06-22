# M8 app — next-session build brief

**Model/effort:** Opus + MAX (multi-file build touching the orchestrator + a money DB).
**Branch:** work in worktree `m8-scifi` on `fun/scifi-ui` (auto-deploys to prod `m8-alpha.vercel.app` on push to `main` — never deploy without Muhammad's OK). Repo `Muhammedelhofy/M8-`.

## Where things stand (all LIVE on m8-alpha, branch fun/scifi-ui)
- Sci-fi UI + installable PWA + voice (record → Groq `whisper-large-v3` via `/api/transcribe`).
- Reply modality: TYPE → text reply (silent); TALK → voice reply (`voice.muted` flag). Welcome is silent.
- **Tasks v1 SHIPPED** — `m8_tasks` table (M8 Supabase `ltqpoupferwituusxwal`), `api/tasks.js` (GET/POST/PATCH/DELETE), `js/tasks.js` + header glyph → slide-in panel (manual add/check/delete, due tags, overdue). Diagnostics + Tasks are slide-in panels (pattern to reuse).
- **Wallet DB access PROVISIONED + AUDITED** (Wallet Supabase `sjomysminfzohkbauahw`, household "Hofy Home" id `3c55a0a3-837c-41b8-96a9-abfe5395d3d7`): role `m8_wallet` (nologin, NOT superuser, NOT bypassrls) — SELECT on the 11 analysis tables, UPDATE on ONLY `transactions(amount,category,note,occurred_on,type)`, NO insert/delete, RLS-scoped to Hofy Home + `EXECUTE` on `user_household_ids()`. Verified: reads work (7 txns), DELETE denied, column-scoped UPDATE.
- **Env vars SET in M8 Vercel:** `WALLET_SUPABASE_URL=https://sjomysminfzohkbauahw.supabase.co`, `WALLET_JWT_SECRET` (the wallet's JWT secret) — for the read code to connect.

## BUILD 1 — Money view (design LOCKED = blend of all 3 concepts)
`lib/wallet.js`: mint a short JWT `{ role:"m8_wallet" }` signed HS256 with `WALLET_JWT_SECRET`; use it as the bearer to the wallet's PostgREST; query scoped to Hofy Home (`household_id = 3c55a0a3…`). A new `api/wallet.js` (GET summary). **PRIVACY WALL (hard rule): note/category/counterparty TEXT never enters an LLM prompt or a log — code computes totals and TEMPLATES the answer.** Writes (edit a transaction's 5 fields) are confirm-gated; NO insert/delete (the grants enforce it anyway).
**Money screen = blend:** budget ring (A) on top + In/Out stat tiles (B) + M8 plain-language insight cards (C, "spent X, down 8%", "Bills due in 3d"). Reuse the slide-in panel pattern, calm/low-noise. Numbers from real wallet data.

## BUILD 2 — Tasks v2: chat-driven management
Orchestrator: detect "remind me to … / add task … / what's on my list / mark … done / delete …" (EN+AR) → CRUD via the tasks table → templated reply. Works by voice too (mic → transcript → same path). Keep it a hard-route lane (like the other deterministic lanes), don't let it stream past.

## BUILD 3 — Active reminders (the "bigger build" Muhammad flagged)
Passive first (small): due-today tasks appended to the existing 7am brief email (`morning-brief.js`/`notify.js`, Resend already wired). Active (real ping when app closed): Web Push — VAPID keys (env), a push-subscribe call + SW `push` handler in `sw.js`, and a cron that fires due-task pushes. Email-at-due-time is the simpler fallback.

## Nav
Tasks + Diagnostics + (soon) Money are slide-in panels off header glyphs. Decide later whether to promote to a real bottom nav (Chat | Tasks | Money | Home) per the image-5 model — only when it earns it; keep low-noise.
