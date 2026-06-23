// M8 Notes — the general-note store (assistant-architecture build #2).
// A SEPARATE typed store from m8_tasks. M8's own Supabase (NOT the Wallet),
// service key, server-side. Capture + recall are deterministic; recall is
// code-templated (no LLM). Notes are general memory — distinct from the
// privacy-walled Family Wallet.
"use strict";
const { createClient } = require("@supabase/supabase-js");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Insert a note. source: 'chat' (typed) | 'migrated' (from old memory) | …
async function addNote(content, source = "chat") {
  const c = String(content || "").trim().slice(0, 2000);
  if (!c) throw new Error("empty note");
  const { data, error } = await db()
    .from("m8_notes")
    .insert({ content: c, source })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Most-recent open notes.
async function listNotes(limit = 20) {
  const { data, error } = await db()
    .from("m8_notes")
    .select("*")
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Keyword (substring) search on content. `query` is escaped for ILIKE so a
// stray % / _ in the topic can't widen the match.
async function searchNotes(query, limit = 10) {
  const q = String(query || "").trim();
  if (!q) return [];
  const safe = q.replace(/[%_\\]/g, (ch) => "\\" + ch);
  const { data, error } = await db()
    .from("m8_notes")
    .select("*")
    .eq("archived", false)
    .ilike("content", `%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

module.exports = { addNote, listNotes, searchNotes };
