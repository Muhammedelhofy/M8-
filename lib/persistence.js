"use strict";

/**
 * lib/persistence.js — Build-110 (Brain CPR)
 *
 * THE PROBLEM this fixes: four already-shipped brain features (reflector,
 * reasoning chains, entity store, conjecture-outcome loop) write to Supabase
 * with FIRE-AND-FORGET, un-awaited inserts. On Vercel the serverless lambda
 * FREEZES the moment the HTTP response is returned — so an insert that hasn't
 * resolved yet is silently dropped. Result: those tables sat at 0 rows while
 * every AWAITED write (m8_conversations, m8_research_notes, the graph) worked.
 *
 * THE FIX: `safePersist(promise, label)` registers the insert with Vercel's
 * `waitUntil()` (from @vercel/functions). waitUntil EXTENDS the lambda lifetime
 * for the given promise — the response still returns immediately (so the
 * voice-first UX keeps its low TTFB; we are NOT adding blanket `await` which
 * would cost 2-4s per turn), but the runtime keeps the function alive until the
 * insert flushes.
 *
 * SAFETY CONTRACT:
 *   - NEVER throws. Every path is wrapped; the returned promise never rejects.
 *   - Supabase inserts RESOLVE with `{ data, error }` (they don't reject on a DB
 *     error), so we inspect `.error` and log it; a genuine success logs
 *     "[persist:<label>] +1" so the Vercel runtime logs PROVE writes are firing.
 *   - DEGRADES SAFELY: if @vercel/functions isn't installed, or waitUntil throws
 *     (e.g. no request context — a cron module scope, or local dev), we fall back
 *     to returning the wrapped promise so a caller MAY `await` it. The wrapped
 *     promise still has its own .catch, so an un-awaited fire-and-forget caller
 *     can never produce an unhandled rejection.
 */

// Resolve waitUntil ONCE at module load. Tolerate the package being absent
// (local dev / tests) — _waitUntil stays null and safePersist degrades to await.
let _waitUntil = null;
try {
  // eslint-disable-next-line global-require
  const vfns = require("@vercel/functions");
  if (vfns && typeof vfns.waitUntil === "function") _waitUntil = vfns.waitUntil;
} catch (_) {
  _waitUntil = null; // not on Vercel / package not installed → await fallback
}

/**
 * safePersist(promise, label) — keep a background DB write alive across the
 * Vercel freeze without blocking the response.
 *
 * @param {Promise|Thenable} promise  the insert/update (e.g. db.from(t).insert(row))
 * @param {string}           label    short tag for the log line, e.g. "reflect"
 * @returns {Promise}        a NEVER-REJECTING promise (awaitable as a fallback)
 */
function safePersist(promise, label) {
  const tag = "[persist:" + (label || "?") + "]";

  // Wrap so the promise (a) logs +1 on a real success, (b) logs the Supabase
  // {error} or a thrown error, and (c) NEVER rejects — so an un-awaited caller
  // cannot trigger an unhandled-rejection crash.
  const wrapped = Promise.resolve(promise)
    .then((res) => {
      if (res && res.error) {
        console.error(tag + " " + (res.error.message || String(res.error)));
      } else {
        console.log(tag + " +1");
      }
      return res;
    })
    .catch((err) => {
      console.error(tag + " " + (err && err.message ? err.message : String(err)));
    });

  // Preferred path: register with waitUntil so the lambda stays alive to flush
  // while the response returns immediately. Wrapped in try/catch because
  // waitUntil throws when called outside a request context.
  if (_waitUntil) {
    try {
      _waitUntil(wrapped);
    } catch (_) {
      // No request context → nothing to extend; the wrapped promise is still
      // returned below so a caller in a long-lived context (cron) can await it.
    }
  }

  // Degrade safely: return the wrapped (never-rejecting) promise. waitUntil-less
  // environments can `await` it; fire-and-forget callers can ignore it.
  return wrapped;
}

module.exports = { safePersist, _waitUntilAvailable: () => !!_waitUntil };
