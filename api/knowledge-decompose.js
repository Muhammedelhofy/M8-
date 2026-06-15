/**
 * api/knowledge-decompose.js — Build-42 (D3): approve a staged kernel/leap split
 *
 * POST /api/knowledge-decompose
 * Body: { source_id, kernelEstablished?: boolean }
 *   - Writes the leap node (always speculative) + the kernel (matched to an
 *     already-established node at cosine >= 0.82, else minted: speculative by
 *     default, established only if kernelEstablished:true), linked
 *     leap --derived_from--> kernel (metadata.decomposition='leap_of_kernel').
 *   - Requires a pending_decomposition staged by the speculative ingest path.
 *
 * Returns: { ok, leapId, kernelId, kernelStanding } | { ok:false, message }
 */

"use strict";

const { approveDecomposition } = require("../lib/knowledge-intake");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const { source_id, kernelEstablished = false } = req.body || {};
  if (!source_id) {
    return res.status(400).json({ error: "source_id is required" });
  }
  try {
    const result = await approveDecomposition(source_id, { kernelEstablished: !!kernelEstablished });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    console.error("[knowledge-decompose]", e.message);
    return res.status(500).json({ error: e.message });
  }
};
