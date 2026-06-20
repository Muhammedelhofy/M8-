# Build-85a Live Test — Morning Brief P&L

## What changed
`lib/morning-brief.js` now includes a **Weekly P&L Snapshot** section in every morning brief email:
- Fleet gross this week vs last week + delta %
- Per-driver: gross earnings → minus weekly car rental → net
- Bolt bonus tier hits (T4/T5/T6) based on MTD net
- "Needs attention" list: drivers whose weekly pace projects below 5,000 SAR/month

## How to trigger the brief

### Option A — trigger the email cron manually (recommended)
```
GET https://m8-alpha.vercel.app/api/send-morning-brief
```
Check **mohd.hofy@gmail.com** inbox. The email should contain the new "Weekly P&L Snapshot" section.

### Option B — ask M8 in chat
```
Morning brief
```
or
```
Brief me on the fleet
```
M8 will respond with the brief text, which now includes the P&L section.

### Option C — inspect via the morning-brief API
```
GET https://m8-alpha.vercel.app/api/morning-brief
```
The JSON response has a top-level `pnl` field alongside `onTrack`, `below`, etc.

---

## What to check in the email

1. **Section present** — Look for a "Weekly P&L Snapshot (Xd)" heading near the top of the email, between the header line and the DROPPED YESTERDAY / ON TRACK sections.

2. **Fleet totals line** — Should show:
   ```
   Fleet gross this week: X,XXX SAR  ·  Last week: X,XXX SAR  ▲/▼ Z%
   ```
   If there are fewer than 7 days of prior data the "Last week" part is omitted.

3. **Per-driver rows** — Each driver shows:
   ```
   Driver Name: X,XXX SAR gross − YYY SAR rent → Z,ZZZ SAR net
   ```
   If a driver has no car rental profile set, the "− rent → net" part is absent.

4. **Bolt bonus tiers** — Line like:
   ```
   Bolt bonus tiers (MTD): Ahmad T5 · Bilal T4
   ```
   Or "none reached yet" if no driver has hit 4,000 SAR MTD net.

5. **Needs attention** — Amber block if any driver's weekly pace projects below 5,000 SAR/month. If all drivers are on pace, this block is absent.

6. **No invented numbers** — Every figure must match what the dashboard shows. Cross-check 2–3 driver earningss against the fleet dashboard.

---

## Edge cases to verify

| Scenario | Expected |
|---|---|
| First week of month (< 7 days data) | Shows available days, no "Last week" comparison |
| Driver with no finance profile | Shows gross only, no car rent / net line |
| Driver at exactly 5,000 SAR MTD | Listed as T5 |
| All drivers above 5,000/month pace | "Needs attention" block is absent |
| No fleet data yet | Brief shows "No fleet data available" — no P&L section |
