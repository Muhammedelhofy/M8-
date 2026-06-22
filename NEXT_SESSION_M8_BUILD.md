# M8 app — next-session build brief

**Model/effort:** Opus + MAX (touches the orchestrator + a money DB + the live 7am brief).
**Branch:** worktree `m8-scifi` on `fun/scifi-ui`. Pushing `main` AUTO-DEPLOYS prod
`m8-alpha.vercel.app` — **never deploy without Muhammad's OK.** Repo `Muhammedelhofy/M8-`.

## Where things stand (2026-06-23b)
Builds 1–3 are **BUILT + locally verified, committed on `fun/scifi-ui`, NOT yet deployed**
(4 commits ahead of `origin/main`). Nothing is live until you push to `main`.
- **Build 1 — Money view** ✅ `lib/wallet.js` + `api/wallet.js` + `js/money.js` + money panel.
  Slide-in 💰 panel: spend ring + In/Out tiles + templated insight cards. **Privacy wall:**
  the `note` column is never read; no txn text is logged/returned/sent to an LLM; every string
  is code-templated from numbers. Render verified locally (success + error states).
- **Build 2 — Tasks v2 (chat/voice)** ✅ `handleTasksCommand()` in `lib/orchestrator.js`,
  wired into `orchestrate()` + `orchestrateStream()` as a deterministic hard-route lane
  (EN+AR). "remind me to / add task / what's on my list / mark X done / delete X". Classifier
  verified vs 24 phrases incl. negatives.
- **Build 3 (passive) — due tasks in 7am brief** ✅ `attachDueTasks()` in `lib/morning-brief.js`
  + section in text/HTML renderers + cron (`api/morning-brief.js`). Zero regression when nothing
  is due; fails safe.

## START HERE next session: DEPLOY + live-verify (gated on Muhammad's OK)
The backends can only be truly tested on a real deploy (local `serve.ps1` is static; `/api/*` 404s).
1. **Decide /api/wallet auth** 🔴 — it's currently UNAUTHENTICATED like `/api/tasks`. It returns
   financial totals only (no line-item text), but money is sensitive. Options: leave as-is /
   gate with a secret / PIN-gate the Money panel. Decide before prod.
2. **Maybe set `WALLET_SUPABASE_ANON_KEY`** — if the Money view 401s with "No API key", add the
   wallet's PUBLIC anon key (already in `FamilyWallet/config.js`) as this env var in M8 Vercel.
   The code already prefers it as the gateway apikey and falls back to the minted JWT.
3. **Deploy** (only on OK): push `fun/scifi-ui` → `main`. Watch the Vercel build (atomic — a bad
   build keeps the old version). Rollback target if needed: the pre-session main head.
4. **Live-verify:** open 💰 Money (ring/tiles/cards show real Hofy Home numbers; if "couldn't
   reach", check Vercel logs for the `[wallet]` read status). Chat: "add task test", "what's on
   my list", "mark test done", "delete test" (EN+AR). Next 7am brief shows "Tasks due today" if any.

## Device tests still outstanding (need the installed app on his phone)
- Voice: speak EN **and** AR → transcribes? 🔴 **Language is a manual toggle (defaults EN), not
  auto-detect** — to dictate Arabic, tap عر first, else Whisper is forced to `en`. (Consider
  switching `/api/transcribe` to auto-detect — omit the `language` param.)
- Modality: typed → silent text; spoken → spoken reply. Tasks v1 panel add/check/delete persists.
  PWA installs with the v2 (centered, no-halo) icon.

## THEN BUILD — active Web Push (the "bigger" reminder build, deferred)
Real ping when the app is closed. Needs: VAPID keys (generate, set `VAPID_PUBLIC`/`VAPID_PRIVATE`
+ subject env), an `m8_push_subscriptions` table (migration), `POST /api/push-subscribe`
(store subscription), `push` + `notificationclick` handlers in `sw.js`, and a cron
(`/api/cron-reminders`) that finds due tasks and sends pushes (web-push lib or hand-rolled VAPID).
Email-at-due-time is the simpler fallback if Web Push is fiddly.

## Privacy wall (keep holding it)
Family-wallet transaction text must NEVER enter an LLM prompt or a log. The Money view is a
deterministic screen on purpose — do NOT add a "ask M8 about my spending" chat path that feeds
transaction text to the model. Totals-only, code-templated.

## Nav
Tasks + Diagnostics + Money are slide-in panels off header glyphs. Promote to a real bottom nav
(Chat | Tasks | Money | Home) only when it earns it; keep low-noise.
