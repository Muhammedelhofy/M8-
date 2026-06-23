/**
 * Notes REST  ·  /api/notes  (folded into ops via ?fn=notes)
 *   GET            -> { notes: [...] }   (most-recent open notes)
 *   DELETE { id }  -> { ok: true }
 * Backs the Notes tab. M8's own Supabase, service key. Notes are general memory
 * (separate from the privacy-walled wallet) — plain content, no money gate.
 */
"use strict";
const notes = require("../notes");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const list = await notes.listNotes(100);
      return res.status(200).json({ notes: list });
    }
    if (req.method === "DELETE") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const id = (body && body.id) || (req.query && req.query.id);
      if (!id) return res.status(400).json({ error: "id required" });
      await notes.deleteNote(id);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    console.error("[notes-api] error", e && e.message);
    return res.status(500).json({ error: "server error" });
  }
};
