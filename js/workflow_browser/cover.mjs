// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - what a card shows instead of a filename  ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Three sources, best first:
//   1. a picture the user chose by hand,
//   2. the last image that workflow actually produced,
//   3. a small map of the graph, drawn from the node positions already in the
//      file.
//
// (3) matters most: it means all 144 workflows have a recognisable cover the
// first time the panel is ever opened, with nothing to generate and nothing to
// go stale. (2) then fills in on its own as the user works.
//
// A picture of the CANVAS is deliberately not attempted - it cannot be captured
// without a screen-share permission prompt, so it is not on the table.

import { api } from "/scripts/api.js";
import * as A from "./api.mjs";

// Muted stand-ins for LiteGraph's node colours. The index comes from the
// server, which hashes the node's colour string, so the same coloured node
// always lands on the same swatch without shipping the colour strings.
const SWATCH = ["#4d7ea8", "#7ea84d", "#a8794d", "#8a4da8", "#a84d4d", "#4da8a0", "#8f8f8f", "#6d78a8"];

/** Paint the graph map. Sized to the element's real box at device pixels, or
 *  covers look soft on a high-DPI screen and blocky when the node is zoomed. */
export function drawMap(canvas, map, accent) {
  const w = canvas.clientWidth || 120;
  const h = canvas.clientHeight || 64;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, w, h);

  if (!Array.isArray(map) || !map.length) {
    // An unreadable or empty workflow still gets something honest to look at
    // rather than a blank hole in the grid.
    ctx.strokeStyle = "#2e2e2e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.3, h * 0.5); ctx.lineTo(w * 0.7, h * 0.5);
    ctx.stroke();
    return;
  }

  // Inset so boxes at the extremes are not clipped flush against the edge.
  const pad = 6;
  const iw = Math.max(1, w - pad * 2);
  const ih = Math.max(1, h - pad * 2);

  // Wires first, so boxes sit on top. Approximated as a line between box
  // centres in reading order: the real link list is not carried in the map, and
  // at 120x64 the impression of a graph is all that reads anyway.
  ctx.strokeStyle = "rgba(120,150,180,.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < map.length; i++) {
    const a = map[i - 1], b = map[i];
    ctx.moveTo(pad + (a[0] + a[2] / 2) * iw, pad + (a[1] + a[3] / 2) * ih);
    ctx.lineTo(pad + (b[0] + b[2] / 2) * iw, pad + (b[1] + b[3] / 2) * ih);
  }
  ctx.stroke();

  for (const e of map) {
    const x = pad + e[0] * iw;
    const y = pad + e[1] * ih;
    const bw = Math.max(2, e[2] * iw);
    const bh = Math.max(2, e[3] * ih);
    const ci = e[4];
    ctx.fillStyle = ci >= 0 ? SWATCH[ci % SWATCH.length] : (accent || "#5a5a5a");
    ctx.globalAlpha = ci >= 0 ? 0.92 : 0.5;
    const r = Math.min(2, bw / 2, bh / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, r);
    else ctx.rect(x, y, bw, bh);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Where a card's picture should come from, if anywhere. */
export function coverFor(entry, meta) {
  const hand = meta?.covers?.[entry.rel];
  if (hand && hand.kind === "file" && hand.url) return { kind: "image", url: hand.url };
  if (hand && hand.kind === "output" && hand.filename) {
    return { kind: "image", url: outputURL(hand) };
  }
  return { kind: "map" };
}

function outputURL(rec) {
  const p = new URLSearchParams({
    filename: rec.filename || "",
    subfolder: rec.subfolder || "",
    type: rec.type || "output",
  });
  return `/api/view?${p.toString()}`;
}

// ── remembering what a workflow produced ────────────────────────────────────
//
// When a run finishes we already know which workflow is open, and the event
// carries the images it wrote. Recording the pair is all it takes for covers to
// appear as somebody works, with no backfill and no scanning of the output
// folder.

let installed = false;
let pending = null;
let flushTimer = null;

export function installOutputCoverCapture() {
  if (installed) return;
  installed = true;

  api.addEventListener("executed", (ev) => {
    try {
      const images = ev?.detail?.output?.images;
      if (!Array.isArray(images) || !images.length) return;
      const rel = A.activePath();
      if (!rel) return;                      // an unsaved workflow has no file to pin it to
      const img = images.find((i) => i && i.filename && (i.type || "output") !== "temp");
      if (!img) return;
      pending = pending || {};
      pending[rel] = { kind: "output", filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" };
      // Debounced: a batch fires this once per output node, and each one would
      // otherwise be its own write.
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 1200);
    } catch {
      // Never throw inside ComfyUI's event loop over a cover thumbnail.
    }
  });
}

async function flush() {
  const batch = pending;
  pending = null;
  if (!batch) return;
  try { await A.saveMeta({ covers: batch }); } catch { /* a missed cover is not worth a message */ }
}
