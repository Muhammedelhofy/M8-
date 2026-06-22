/**
 * api/knowledge.js — Router (Hobby 12-function consolidation, 2026-06-21)
 *
 * Five knowledge/data endpoints now share ONE serverless function, dispatched by
 * ?fn=. The handler bodies are UNCHANGED — each lives verbatim in lib/handlers/
 * and is invoked here. vercel.json rewrites keep every original URL working:
 *   /api/ingest-full             -> /api/knowledge?fn=ingest-full
 *   /api/ingest-extract-existing -> /api/knowledge?fn=extract-existing
 *   /api/knowledge-inventory     -> /api/knowledge?fn=inventory
 *   /api/memory-consolidate      -> /api/knowledge?fn=memory-consolidate
 *   /api/platform-sync           -> /api/knowledge?fn=platform-sync
 */
"use strict";

const ingestFull        = require("../lib/handlers/ingest-full");
const extractExisting   = require("../lib/handlers/ingest-extract-existing");
const inventory         = require("../lib/handlers/knowledge-inventory");
const memoryConsolidate = require("../lib/handlers/memory-consolidate");
const platformSync      = require("../lib/handlers/platform-sync");
const { getInventoryStatus } = require("../lib/knowledge-intake");

module.exports = async (req, res) => {
  const fn = String((req.query && req.query.fn) || "").toLowerCase();
  switch (fn) {
    case "ingest-full":        return ingestFull(req, res);
    case "extract-existing":   return extractExisting(req, res);
    case "inventory":          return inventory(req, res);
    case "memory-consolidate": return memoryConsolidate(req, res);
    case "platform-sync":      return platformSync(req, res);
    // Build-RAG: polished status — books, nodes, NotebookLM tip, test-DOCX reminder.
    case "status": {
      if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
      try {
        const status = await getInventoryStatus();
        return res.status(200).json({ ok: true, ...status });
      } catch (e) {
        console.error("[knowledge/status]", e.message);
        return res.status(500).json({ ok: false, error: e.message });
      }
    }
    default:
      return res.status(404).json({ error: `unknown knowledge fn: '${fn}'` });
  }
};

// Ingest/extraction can take ~90s; mirrors the original endpoints' budget.
module.exports.config = { maxDuration: 180 };
