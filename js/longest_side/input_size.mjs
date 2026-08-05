// Longest Side Pixaroma - what size picture is arriving.
//
// The node used to need a run before it could show the exact output size, which
// is the wrong way round: ComfyUI's frontend ALREADY knows the incoming size.
// A Load Image node prints "720 x 1280" on its own face, and that comes from
// `node.imgs[0]`, a plain <img> whose naturalWidth/naturalHeight are readable
// the moment the picture loads. So we read it straight off the upstream node.
//
// Kept in its own module because it needs ComfyUI's `app`, and core.mjs must
// stay import-free - that is what lets the parity harness load core.mjs with
// plain node and diff it against Python.

import { app } from "/scripts/app.js";

/**
 * The image size the node will actually receive, or null when it cannot be
 * known. `source` says where the answer came from, which the caller uses to
 * decide how confidently to show it.
 *
 *   "upstream" - read live off the node feeding us. No run needed, and it
 *                follows a swapped file straight away.
 *   "run"      - what the last execution reported. Exact for that run, and the
 *                fallback when the upstream draws no preview of its own.
 */
export function resolveInputSize(node) {
  // Nothing wired in means nothing is arriving, so there is no size to report.
  // Checking this FIRST matters: the run cache outlives the wire that filled
  // it, and without this an unplugged node kept showing a confident, precise,
  // undimmed size from whatever it was last connected to (measured: a node cut
  // loose still read "1024x256").
  if (!isInputConnected(node)) return null;

  const live = upstreamImageDims(node);
  if (live) return { ...live, source: "upstream" };
  const last = node?._pixLsLastIn;
  if (last?.w > 0 && last?.h > 0) return { w: last.w, h: last.h, source: "run" };
  return null;
}

/** Is the image input wired at all? */
export function isInputConnected(node) {
  const inp = (node?.inputs || [])[0];
  return !!inp && inp.link != null;
}

/**
 * Nodes whose `imgs` preview is NOT what they output, so their preview must
 * never be measured.
 *
 * Both Pixaroma loaders set `node.imgs` from the FILE ON DISK
 * (`updateNativePreview` in js/load_image/api.mjs) but pass the picture through
 * `_resize_frame` before returning it (nodes/node_load_image.py). With their
 * inline resize on, the preview is the ORIGINAL and the output is the resized
 * one, so trusting it prints a confident wrong size - the exact failure this
 * module exists to avoid.
 *
 * They fall back to the run-measured size instead, which Python reports and is
 * always right. The only cost is that behind one of these two, the preview is
 * an estimate until the first run.
 *
 * Deliberately NOT solved by reading their resize state: that couples this file
 * to another node's state schema, and a schema change would silently start
 * trusting a resizing node again. Refusing outright cannot rot.
 */
const PREVIEW_IS_NOT_OUTPUT = new Set([
  "PixaromaLoadImage",
  "PixaromaLoadImageMini",
]);

/**
 * The dimensions of the picture the upstream node is showing.
 *
 * DIRECT upstream only, deliberately. Walking further back would be wrong, not
 * merely incomplete: an intermediate node with no preview of its own may well
 * be a resize, so the size two hops back is not the size arriving here. A
 * confident wrong number is worse than an honest estimate, so when the node
 * feeding us draws nothing we say we do not know.
 */
function upstreamImageDims(node) {
  try {
    const inp = (node?.inputs || [])[0];
    if (!inp || inp.link == null) return null;

    const graph = node.graph || app.graph;
    if (!graph) return null;

    // graph.links is a plain object on older frontends and a Map on newer ones
    // (Vue Compat #3) - try both.
    let link = graph.links?.[inp.link];
    if (!link && typeof graph.links?.get === "function") link = graph.links.get(inp.link);
    if (!link) return null;

    const up = graph.getNodeById?.(link.origin_id);
    if (!up) return null;

    // A MUTED (mode 2) or BYPASSED (mode 4) node is not producing the picture
    // it is still showing: bypass passes its own INPUT straight through, so its
    // preview is of an image that never arrives here. Trusting it gives a
    // confident wrong size - e.g. a bypassed crop still previewing 512x512 while
    // the 2000x1000 original is what actually flows past it. Returning null
    // falls back to the honest estimate instead.
    if (up.mode === 2 || up.mode === 4) return null;

    // A node whose preview is not its output (see the set above).
    if (PREVIEW_IS_NOT_OUTPUT.has(up.comfyClass)) return null;

    // node.imgs is the batch the node is previewing; imageIndex is which one is
    // on show. A batch is uniform in size, so the first is representative.
    const imgs = up.imgs;
    if (!imgs?.length) return null;
    const img = imgs[up.imageIndex || 0] || imgs[0];
    const w = Math.trunc(img?.naturalWidth || 0);
    const h = Math.trunc(img?.naturalHeight || 0);
    // naturalWidth is 0 until the picture has actually decoded, so a freshly
    // set src reports nothing for a frame or two. Returning null lets the
    // caller fall back rather than show 0x0.
    if (w > 0 && h > 0) return { w, h };
  } catch { /* any frontend change here degrades to the run-cached size */ }
  return null;
}

/** A cheap value that changes whenever the answer would change, for polling. */
export function inputSizeKey(node) {
  const d = resolveInputSize(node);
  return `${isInputConnected(node) ? 1 : 0}:${d ? `${d.w}x${d.h}:${d.source}` : "none"}`;
}
