/**
 * api/knowledge-inventory.js — Read-only knowledge graph inventory
 *
 * GET /api/knowledge-inventory
 * Returns all ingested books, their chapters, and node counts.
 * No Gemini calls — DB read only.
 *
 * Response shape:
 * {
 *   ok: true,
 *   books: [
 *     {
 *       book_title, author, year, source_class, total_chapters,
 *       total_nodes,
 *       chapters: [{ chapter_index, chapter_title, source_id, word_count, node_count, ingested_at }]
 *     }
 *   ],
 *   raw_snippets: [{ id, title, source_class, word_count, node_count, ingested_at }],
 *   total_books, total_nodes_in_books
 * }
 */

"use strict";

const { getIngestionInventory } = require("../lib/knowledge-intake");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  try {
    const inventory = await getIngestionInventory();
    return res.status(200).json({ ok: true, ...inventory });
  } catch (e) {
    console.error("[knowledge-inventory]", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
