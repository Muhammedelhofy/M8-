# M8 Stateful Proactive Alerting — SPEC (Build: JULY · spec'd S8/Build-15, 2026-06-13)

*Merged design per team round 3 Q5 (`archive/M8_Team_Round3_Synthesis_2026_06_13.md`):
state machine (union of replies) · data-verified resolution (Gemini) × 2 consecutive
clear checks (Grok) · asymmetric hysteresis (Gemini) · worsening-delta re-raise
(Manus) · fleet-level fatigue controls (Manus/Gemini) · **cash-gap first (Grok's
ruling — Muhammad can overrule here in spec review)**. Track A — Personal AI OS.
SPEC ONLY: zero alerting code ships in S8 (scope discipline, archive/BUILD_15_SPEC.md A10).*

## 0. Why stateful (the round-2 finding this answers)

M8's briefs today recompute conditions from scratch every time: an unpaid cash gap
"alerts" every brief forever (fatigue), a resolved problem can't be told from a
recurring one, and nothing tracks whether Muhammad has SEEN an alert. Alerting
becomes real when an alert is an ENTITY with a lifecycle, not a sentence in a brief.

## 1. State machine

```
            ┌────────────┐   ack (Muhammad sees/clicks/replies)
   raise ──►│   raised   ├──────────────► acknowledged ──► in_progress (optional)
            └─────┬──────┘                      │                  │
                  │ snooze(until)               │ data-verified clear × 2 checks
                  ▼                             ▼                  ▼
              snoozed ────unsnooze/expiry──► (re-eval) ──────► resolved
                                                                   │ condition recurs
                                                                   │ OR worsening-delta
                                                                   ▼
                                                               re_raised
```

- **raised** — condition crossed the raise threshold. Creates/updates one row.
- **acknowledged** — Muhammad interacted (clicked the alert, asked about it in chat,
  or replied to a push). Auto-detected from chat when the driver+condition is named.
- **in_progress** — optional explicit "working on it" (chat: "I'm collecting from X").
- **resolved** — **data-verified only** (Gemini): the underlying numbers cleared, on
  **2 consecutive evaluation runs** (Grok). Muhammad saying "done" moves it to
  in_progress + pending-verify, never directly to resolved — the data closes it.
- **re_raised** — a resolved alert whose condition recurs within `recur_window_days`
  (default 14), OR an open alert whose metric worsens by the per-condition
  worsening-delta (Manus). Re-raise BYPASSES the cooldown (a worsening situation
  must never be silenced by its own cooldown) and increments `times_raised`.
- **snoozed / suppressed** — `suppression_until` timestamp; alert exits all
  surfaces but keeps evaluating. If the metric crosses the worsening-delta during
  the snooze, it un-snoozes (snooze ≠ blindfold).

## 2. Hysteresis + anti-flapping (constants are per-condition, FIXED in code)

- **Asymmetric thresholds**: raise and resolve thresholds differ (Gemini's example
  for tier: raise <60%, resolve >65% — the band kills flapping).
- **2-consecutive-clear rule** on resolution (above).
- **Per-condition cooldown**: after a raise, the same (driver, condition) cannot
  re-raise for `cooldown_hours` (default 48) — EXCEPT via worsening-delta.
- **Evaluation cadence**: piggybacks the existing data-sync/brief generation paths
  (no new cron); every evaluation writes `last_checked_at` + `consecutive_clear`.

## 3. Fatigue controls (the part that decides whether Muhammad keeps reading)

- **Fleet-level aggregation with drill-down** (Manus): the brief shows "3 drivers
  with cash gaps (total SAR 4,310) — worst: X (SAR 2,100, 9 days)" — one line per
  CONDITION, not per driver. Per-driver detail on demand.
- **Hard cap** (Gemini): at most **2** pushed unacked alerts per brief; the rest
  fold into the aggregate line. Priority order decides which 2.
- **Tiered escalation**: dashboard badge → daily-brief line → push notification.
  Escalation only on: new raise of priority-1, worsening-delta, or age threshold
  (cash gap unacked > 3 days).
- **Priority order**: cash > tier/utilization > acceptance/churn (locked round 3).

## 4. Storage

```sql
create table public.fleet_alerts (
  id              bigint generated always as identity primary key,
  condition       text not null,          -- 'cash_gap' | 'tier_slip' | ...
  driver_key      text not null,          -- registry key; '' = fleet-level
  state           text not null default 'raised' check (state in
                    ('raised','acknowledged','in_progress','resolved','re_raised','snoozed')),
  severity        int  not null default 2,        -- 1 high / 2 normal / 3 info
  metric_value    numeric,                -- current value of the watched metric
  raise_value     numeric,                -- value at (last) raise — worsening-delta base
  threshold       numeric,                -- raise threshold that fired
  consecutive_clear int not null default 0,
  times_raised    int  not null default 1,
  suppression_until timestamptz,
  first_raised_at timestamptz not null default now(),
  last_checked_at timestamptz,
  acked_at        timestamptz,
  resolved_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  unique (condition, driver_key)          -- ONE living row per condition+driver
);
```

- One row per (condition, driver) — history lives in `metadata.history[]`
  (state transitions with timestamps, capped at 50 entries).
- **Graph integration** (round-2 statefulness requirement): on raise/resolve, a
  driver-entity node (`kind: technique`? no — new Track-A node kinds are NOT added;
  the alert lands as a notebook-style ops note referencing the driver name, thread
  `fleet-ops`, and the graph ingests it like any note). Alerts must be RECALLABLE:
  "what alerts are open on X?" answers from `fleet_alerts`, not from the graph.

## 5. Condition #1 — CASH GAP (the full lifecycle test)

**Why first** (Grok's winning argument): highest stakes (real money at risk), the
deterministic spine ALREADY computes it (cash-collection tracking is live in the
fleet blob), and resolution semantics are the cleanest possible state-machine test:
gap paid → numbers clear → data-verified resolve. Tier-slip trajectory (Gemini,
genuinely predictive) is condition #2; acceptance-rate folds into churn later.

- **Metric**: `cash_gap = cash_collected_by_driver − cash_deposited` per driver,
  from the existing fleet data (already in the deterministic packet).
- **Raise**: gap > **SAR 500** for **≥ 2 consecutive syncs** (a single sync can be
  mid-deposit noise). Severity 1 if gap > SAR 1,500 or age > 7 days.
- **Resolve**: gap ≤ **SAR 100** (asymmetric — not zero: rounding/fee noise) on
  **2 consecutive syncs**.
- **Worsening-delta re-raise**: gap grows ≥ **SAR 500** above `raise_value`.
- **Cooldown**: 48h. **Recur window**: 14 days (re_raised, not a fresh alert).
- **Brief line shape**: `⚠ Cash: X owes SAR 2,100 (9 days, raised twice)` —
  aggregate when >2 drivers. Push only if severity 1 AND unacked > 24h.
- **Ack detection**: any chat turn naming the driver + cash/deposit/gap topic, or
  a click on the alert chip (UI sends `ack:<alert_id>`).

## 6. Condition #2 (next) — TIER-SLIP TRAJECTORY (sketch, build after cash-gap)

Watch the 7-day acceptance/activity trend vs the tier threshold; raise when the
TRAJECTORY crosses ("on pace to drop to Silver in 4 days"), resolve when pace
clears the band (raise <60% pace, resolve >65% × 2 days — Gemini's constants,
final values fixed at build time against real distributions).

## 7. Explicit non-goals (July build keeps these out)

- No LLM judgment in raise/resolve decisions — conditions are pure code over the
  deterministic packet (the honesty spine extends to ops alerts).
- No new cron functions (Vercel cap) — evaluation rides existing sync/brief paths.
- No per-message push spam: pushes only via the escalation ladder above.
- No alert entities in the research graph as first-class nodes (ops notes only).

## 8. Acceptance tests (write with the build)

1. Synthetic gap > threshold × 2 syncs → row `raised`, brief line appears once.
2. Same gap next brief → NO duplicate line (state held, fatigue control).
3. Muhammad asks "what's the situation with X's cash?" → `acknowledged`.
4. Deposit clears gap on 1 sync → still open (needs 2). Second clear sync → `resolved`.
5. Gap recurs day 10 → `re_raised`, `times_raised` = 2 (not a new row).
6. Open gap grows +SAR 600 during cooldown → re-raise fires anyway.
7. 4 drivers with gaps → brief shows 1 aggregate line + worst case, ≤2 pushes.
8. Snoozed alert whose gap doubles → un-snoozes.
