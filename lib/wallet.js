// M8 ↔ Family Wallet — READ-ONLY money summary (Build: Money view).
//
// ── HARD PRIVACY WALL ───────────────────────────────────────────────────────
// Transaction free-text (note / counterparty) NEVER enters this module: we do
// not even SELECT the `note` column. Nothing here is ever fed to an LLM prompt,
// and we NEVER log row contents — only HTTP status + table name on error. The
// screen is a deterministic, code-computed + code-TEMPLATED summary. Category
// and bill *names* are surfaced only back to the owner's own UI (budget/bill
// labels), never to a model or a log.
//
// ── ACCESS ──────────────────────────────────────────────────────────────────
// We mint a short-lived HS256 JWT { role: "m8_wallet" } signed with
// WALLET_JWT_SECRET and use it as the PostgREST bearer. The `m8_wallet` DB role
// is nologin, not superuser, not bypassrls: SELECT on the analysis tables +
// column-scoped UPDATE on transactions only, RLS-scoped to the Hofy Home
// household. We also pass an `apikey` header for the Supabase gateway — the
// public anon key if WALLET_SUPABASE_ANON_KEY is set, otherwise the minted JWT.
const crypto = require("crypto");

// Real household — "Hofy Home". All reads are additionally filtered to this id
// (defense in depth; RLS already scopes the role to it).
const HOUSEHOLD_ID = "3c55a0a3-837c-41b8-96a9-abfe5395d3d7";
const WALLET_ROLE = "m8_wallet";
const CURRENCIES = ["SAR", "EGP"];
const DEFAULT_BASE = "SAR";
const DEFAULT_RATE = 13; // egp_per_sar fallback (matches the Family Wallet app)
const KSA_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh = UTC+3, no DST

// ── JWT (hand-rolled HS256; no extra dependency) ────────────────────────────
function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function mintToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ role: WALLET_ROLE, iat: now, exp: now + 120 }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

function cfg() {
  const url = process.env.WALLET_SUPABASE_URL;
  const secret = process.env.WALLET_JWT_SECRET;
  if (!url || !secret) {
    const miss = [!url && "WALLET_SUPABASE_URL", !secret && "WALLET_JWT_SECRET"].filter(Boolean);
    const err = new Error("wallet not configured: missing " + miss.join(", "));
    err.code = "WALLET_UNCONFIGURED";
    throw err;
  }
  return { url: url.replace(/\/+$/, ""), secret, apikey: process.env.WALLET_SUPABASE_ANON_KEY || null };
}

// PostgREST GET. `params` is an object of query params. Throws on non-2xx with
// a message that contains NO row data (status + table only).
async function pgGet(table, params) {
  const { url, secret, apikey } = cfg();
  const token = mintToken(secret);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    headers: {
      apikey: apikey || token,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    // PRIVACY: never surface the body to logs/clients — it can echo a row.
    const err = new Error(`wallet read failed (${table} → HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── date helpers (computed in KSA so months match what he sees in the app) ──
function ksaNow() {
  return new Date(Date.now() + KSA_OFFSET_MS);
}
function ymOf(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  return ymOf(new Date(Date.UTC(y, m - 1 + n, 1)));
}
function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)); // first of next month
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { start: `${ym}-01`, end };
}
function todayISO() {
  const d = ksaNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function daysUntil(iso) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayISO() + "T00:00:00Z")) / 86400000);
}

// ── currency conversion (mirrors the Family Wallet app's toBase) ───────────
function makeToBase(base, rate) {
  const r = Number(rate) || DEFAULT_RATE;
  return function toBase(amount, cur) {
    const a = Number(amount) || 0;
    if (cur === base) return a;
    if (base === "SAR" && cur === "EGP") return a / r;
    if (base === "EGP" && cur === "SAR") return a * r;
    return a;
  };
}

function monthAgg(txns, ym, toBase) {
  const { start, end } = monthBounds(ym);
  let income = 0, expense = 0;
  for (const t of txns) {
    if (!(t.occurred_on >= start && t.occurred_on < end)) continue;
    if (t.type === "income") income += toBase(t.amount, t.currency);
    else if (t.type === "expense") expense += toBase(t.amount, t.currency);
  }
  return { income, expense, net: income - expense };
}

// Main entry: returns a structured, privacy-safe summary object. All numbers,
// no free-text. Throws (caller maps to a clean error) on misconfig / read fail.
async function getSummary() {
  const curYm = ymOf(ksaNow());
  const prevYm = addMonths(curYm, -1);
  const { start: prevStart } = monthBounds(prevYm);
  const { end: curEnd } = monthBounds(curYm);

  // Fetch only what we render, only the columns we need (NO `note`).
  const [households, txns, budgets, billsRaw] = await Promise.all([
    pgGet("households", { select: "base_currency,egp_per_sar", id: `eq.${HOUSEHOLD_ID}` }).catch(() => []),
    pgGet("transactions", {
      select: "amount,type,currency,occurred_on,category",
      household_id: `eq.${HOUSEHOLD_ID}`,
      // Two bounds on the same column → one PostgREST and=() group.
      and: `(occurred_on.gte.${prevStart},occurred_on.lt.${curEnd})`,
      order: "occurred_on.desc",
    }),
    pgGet("budgets", {
      select: "category,currency,limit_amount,member_id",
      household_id: `eq.${HOUSEHOLD_ID}`,
    }).catch(() => []),
    pgGet("bills", {
      select: "name,amount,currency,next_due,is_active",
      household_id: `eq.${HOUSEHOLD_ID}`,
      is_active: "eq.true",
    }).catch(() => []),
  ]);

  const hh = (households && households[0]) || {};
  const base = hh.base_currency || DEFAULT_BASE;
  const rate = Number(hh.egp_per_sar) || DEFAULT_RATE;
  const toBase = makeToBase(base, rate);

  const tx = Array.isArray(txns) ? txns : [];
  const thisMonth = monthAgg(tx, curYm, toBase);
  const lastMonth = monthAgg(tx, prevYm, toBase);
  const expenseDeltaPct = lastMonth.expense > 0
    ? Math.round(((thisMonth.expense - lastMonth.expense) / lastMonth.expense) * 100)
    : null;

  // Per-currency (native, not converted) for the current month.
  const { start: curStart } = monthBounds(curYm);
  const perCurrency = {};
  for (const c of CURRENCIES) perCurrency[c] = { income: 0, expense: 0 };
  for (const t of tx) {
    if (!(t.occurred_on >= curStart && t.occurred_on < curEnd)) continue;
    const slot = perCurrency[t.currency];
    if (!slot) continue;
    if (t.type === "income") slot.income += Number(t.amount) || 0;
    else if (t.type === "expense") slot.expense += Number(t.amount) || 0;
  }
  const currenciesUsed = CURRENCIES.filter((c) => perCurrency[c].income || perCurrency[c].expense);

  // Budgets: spent this month per budgeted category (category+currency match,
  // mirroring the app; household-level — per-member budgets aggregate here).
  const budgetRows = (Array.isArray(budgets) ? budgets : []).map((b) => {
    let spent = 0;
    for (const t of tx) {
      if (t.type !== "expense") continue;
      if (!(t.occurred_on >= curStart && t.occurred_on < curEnd)) continue;
      if (t.category === b.category && t.currency === b.currency) spent += Number(t.amount) || 0;
    }
    const limit = Number(b.limit_amount) || 0;
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    return { category: b.category, currency: b.currency, limit, spent, pct };
  }).sort((a, b) => b.pct - a.pct);

  // Upcoming bills in the next 7 days.
  const bills = (Array.isArray(billsRaw) ? billsRaw : [])
    .filter((b) => b.next_due && daysUntil(b.next_due) >= 0 && daysUntil(b.next_due) <= 7)
    .map((b) => ({ name: b.name, amount: Number(b.amount) || 0, currency: b.currency, dueInDays: daysUntil(b.next_due) }))
    .sort((a, b) => a.dueInDays - b.dueInDays);

  return {
    ok: true,
    base,
    rate,
    month: curYm,
    income: round2(thisMonth.income),
    expense: round2(thisMonth.expense),
    net: round2(thisMonth.net),
    lastMonthExpense: round2(lastMonth.expense),
    expenseDeltaPct,
    perCurrency,
    currenciesUsed,
    budgets: budgetRows,
    bills,
    txCountThisMonth: tx.filter((t) => t.occurred_on >= curStart && t.occurred_on < curEnd).length,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { getSummary, mintToken, HOUSEHOLD_ID };
