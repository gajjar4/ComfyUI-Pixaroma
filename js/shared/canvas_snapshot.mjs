// ╔═══════════════════════════════════════════════════════════════╗
// ║  Canvas snapshot: a node-body canvas that costs nothing idle  ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// WHY THIS EXISTS (measured 2026-09-26, D:\Claude Tests\_perf_bench, CLAUDE.md
// node UI convention #41). A <canvas> on screen in a Nodes 2.0 node body costs
// the browser's GPU process work on EVERY frame the page draws, even when
// nothing on it changes - and while a run goes, ComfyUI redraws the page several
// times a second. That work is taken out of the generation: three Image Compare
// nodes made an SD1.5 render 3-4% slower (GPU-process CPU +0.68 s per run).
// The SAME pixels shown as an <img> cost nothing (+0.04 s; the render time fell
// back to what any three extra nodes cost). A CPU canvas (willReadFrequently)
// did NOT help - it is the canvas being on screen, not how it is drawn.
//
// So a node canvas shows a lossless PICTURE of itself while it is static, and
// the live canvas only while it is being drawn. The node calls `changed()` at
// the end of every render: the live canvas comes back at once, and after
// `idleMs` with no further render it is encoded (PNG, lossless) into an <img>
// laid exactly over it, and the canvas is hidden.
//
// Rules it relies on, each one load-bearing:
//  - ONLY for a canvas that fills its box by itself (position:absolute). The
//    image copies the canvas's inline style, so it covers the same pixels and
//    adds no layout. An in-flow canvas gets a no-op handle instead.
//  - Show/hide is VISIBILITY on both elements, never `hidden`/display: the
//    copied style carries display:block, which beats the hidden attribute, and
//    visibility keeps both boxes so nothing moves.
//  - Pointer events keep going to the node's own root: a visibility:hidden
//    canvas and a pointer-events:none image are never hit.
//  - A render always wins: every changed() bumps a generation number, and a
//    snapshot that lands after a newer render is thrown away unseen.
//  - It degrades to today's behavior (the live canvas stays up) when toBlob
//    throws (a tainted canvas) or yields nothing.
//  - dispose() on teardown (renderer switch, node removed): it revokes the
//    object URL, removes the image and leaves the canvas visible.

const NOOP = { changed() {}, dispose() {}, get showing() { return "canvas"; } };

export function attachCanvasSnapshot(canvas, opts = {}) {
  if (!canvas || !canvas.parentNode) return NOOP;
  const pos = canvas.style.position || "";
  if (pos !== "absolute") return NOOP;
  const idleMs = opts.idleMs ?? 400;

  const img = document.createElement("img");
  img.className = "pix-canvas-snapshot";
  img.alt = "";
  img.draggable = false;
  img.decoding = "async";
  img.style.cssText = canvas.style.cssText;
  img.style.pointerEvents = "none";
  img.style.visibility = "hidden";
  canvas.insertAdjacentElement("afterend", img);

  let url = null;
  let timer = 0;
  let gen = 0;
  let disposed = false;
  let showing = "canvas";

  const showCanvas = () => {
    canvas.style.visibility = "";
    img.style.visibility = "hidden";
    showing = "canvas";
  };

  const snapshot = () => {
    timer = 0;
    if (disposed || !canvas.isConnected || !canvas.width || !canvas.height) return;
    const my = gen;
    try {
      canvas.toBlob((blob) => {
        if (disposed || my !== gen || !blob) return;
        const next = URL.createObjectURL(blob);
        img.src = next;
        img.decode().then(() => {
          if (disposed || my !== gen) { URL.revokeObjectURL(next); return; }
          if (url && url !== next) URL.revokeObjectURL(url);
          url = next;
          img.style.visibility = "visible";
          canvas.style.visibility = "hidden";
          showing = "image";
        }, () => {
          URL.revokeObjectURL(next);
        });
      }, "image/png");
    } catch (_e) {
      // A tainted canvas cannot be read back: keep the live canvas.
    }
  };

  return {
    // Call at the END of every render (the canvas now holds the new pixels).
    changed() {
      if (disposed) return;
      gen++;
      showCanvas();
      clearTimeout(timer);
      timer = setTimeout(snapshot, idleMs);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gen++;
      clearTimeout(timer);
      canvas.style.visibility = "";
      try { img.remove(); } catch (_e) { /* ignore */ }
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
    get showing() { return showing; },
  };
}
