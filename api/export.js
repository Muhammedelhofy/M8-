/**
 * api/export.js — Router (Hobby 12-function consolidation, 2026-06-21)
 *
 * deck + fleet-export share ONE serverless function, dispatched by ?fn=. The
 * handler bodies are UNCHANGED — each lives verbatim in lib/handlers/. vercel.json
 * rewrites keep the original URLs working (and pass through their query params):
 *   /api/deck         -> /api/export?fn=deck   (POST -> deck spec JSON)
 *   /api/fleet-export -> /api/export?fn=fleet   (GET ?format=xlsx|pptx&type= -> file)
 *
 * The orchestrator emits the <!--M8-DOWNLOAD--> marker pointing at /api/fleet-export
 * with format/type query params; the rewrite preserves those alongside fn=fleet.
 */
"use strict";

const deck        = require("../lib/handlers/deck");
const fleetExport = require("../lib/handlers/fleet-export");

module.exports = async (req, res) => {
  const fn = String((req.query && req.query.fn) || "").toLowerCase();
  switch (fn) {
    case "deck":  return deck(req, res);
    case "fleet": return fleetExport(req, res);
    default:
      return res.status(404).json({ error: `unknown export fn: '${fn}'` });
  }
};

module.exports.config = { maxDuration: 30 };
