// Info Pixaroma - a title-less button that opens a note in a reading window.
//
//   core.mjs      state (the note_json widget), icons, sizes, canvas icon images
//   face.mjs      the button: classic canvas paint + body hook, Nodes 2.0 DOM face
//   reader.mjs    the reading window
//   editor.mjs    Note Pixaroma's editor + the title / icon / colour strip
//   starters.mjs  starter buttons + the "start from" popup
//   help.mjs      help text
//
// Title-less recipe: run-timer.md #4 and label.md (title_mode on the TYPE,
// flags.no_title for Align, drawBadges off, classic paints, Nodes 2.0 DOM).

import { app } from "../../../scripts/app.js";
import { hideJsonWidget } from "../shared/utils.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { isLiveNode } from "../shared/live_node.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import { NODE, M, DEFAULT_INFO, unitWidth, readCfg } from "./core.mjs";
import { isInfo, installInfoBodyHook, paintClassic, applyResizeAspect, repairClassicHeight,
  buildVueFace, teardownVueFace, renderVueFace, classicComputeSize, heightForWidth } from "./face.mjs";
import { openReader, closeReader, readerNode, setReaderEditHandler } from "./reader.mjs";
import { openInfoEditor } from "./editor.mjs";
import { showStarterPopup, closeStarterPopup, starterPopupOpen } from "./starters.mjs";
import { INFO_HELP } from "./help.mjs";

registerNodeHelp(NODE, INFO_HELP);

function edit(node, opts = {}) {
  closeReader();
  closeStarterPopup();
  openInfoEditor(node, { ...opts, onReopen: (n) => { if (isLiveNode(n)) openReader(n); } });
}
setReaderEditHandler((node, opts) => edit(node, opts));

// The gear in the selection toolbar opens the editor: the strip on top of it IS
// this node's settings (title, icon, colour). ownMenuItem: Edit is our own line.
registerNodeSettings(NODE, {
  title: "Info",
  ownMenuItem: true,
  menuLabel: "Edit",
  open: (node) => edit(node),
});

// `live` is true only for a flip of the setting (a user action); the first call
// is on the creation path and writes nothing serialized.
function applyRenderer(node, vue, live) {
  vue = !!vue;
  if (node._pixInfoVue === vue) return;
  node._pixInfoVue = vue;
  if (vue) {
    buildVueFace(node);
  } else {
    teardownVueFace(node);
    // A live switch to Classic: Nodes 2.0 left a short stored height, so set
    // it from the width, which carries the scale in both renderers
    // (run-timer.md #13: derive from node.size[0], never from a value an
    // observer on the old face may have rewritten during the switch).
    if (live) node.size[1] = heightForWidth(node);
  }
  try { node.setDirtyCanvas?.(true, true); } catch (_e) {}
}

function setupNode(node) {
  hideJsonWidget(node.widgets, "note_json");
  node.badges = [];
  if (!node.flags) node.flags = {};
  if (!node.flags.no_title) node.flags.no_title = true;
  node._pixInfoRefresh = () => {
    if (node._pixInfoRoot) renderVueFace(node);
    try { node.setDirtyCanvas?.(true, false); } catch (_e) {}
  };
  applyRenderer(node, isVueNodes(), false);
  node._pixInfoRendererOff = onRendererChange((vue) => {
    if (node.graph && isLiveNode(node)) applyRenderer(node, vue, true);
  });
}

app.registerExtension({
  name: "Pixaroma.Info",

  setup() { installInfoBodyHook(); },

  getNodeMenuItems(node) {
    if (!isInfo(node)) return [];
    return [
      null,
      { content: "📖 Open", callback: () => openReader(node) },
      { content: "✏️ Edit", callback: () => edit(node) },
      { content: "✨ Start from...", callback: () => showStarterPopup(node) },
    ];
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;
    const LG = window.LiteGraph || {};
    nodeType.title_mode = (LG.NO_TITLE != null) ? LG.NO_TITLE : 1;
    // No pack badge above a title-less node (frontend 1.53.6 draws it from a
    // central provider; label.md, the last section).
    nodeType.prototype.drawBadges = function () {};

    // A copy / paste / duplicate / load runs configure; a fresh drop does not.
    // The flag is raised by a wrapper on configure ITSELF (Vue Compat #17).
    const _origConfigureFn = nodeType.prototype.configure;
    nodeType.prototype.configure = function () {
      this._pixInfoConfigured = true;
      return _origConfigureFn.apply(this, arguments);
    };

    const _origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _origCreated?.apply(this, arguments);
      // A fresh node opens at the scale-1 size of the default button. Set
      // synchronously: configure (load, paste) overwrites it with the saved size.
      this.size[0] = Math.round(unitWidth(DEFAULT_INFO));
      this.size[1] = M.h;
      this._pixInfoBorn = performance.now();
      setupNode(this);
      // Offer the starters on a FRESH drop only. Read the load flag NOW, not in
      // the timer (CLAUDE.md Vue Compat #19: it is a 300 ms window).
      const bornInLoad = isGraphLoading();
      setTimeout(() => {
        if (bornInLoad || this._pixInfoConfigured || isGraphLoading()) return;
        if (!this.graph || !isLiveNode(this)) return;
        if (String(readCfg(this).content || "").trim()) return;
        showStarterPopup(this);
      }, 120);
      return r;
    };

    const _origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origCfg?.apply(this, arguments);
      // Re-assert the flag configure just restored (Align reads it). Idempotent,
      // so an unchanged workflow stays clean (Vue Compat #18).
      if (!this.flags) this.flags = {};
      if (!this.flags.no_title) this.flags.no_title = true;
      this._pixInfoRaw = null;
      this._pixInfoRefresh?.();
      return r;
    };

    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      // Only a real corner drag (onResize also fires from setSize on restore,
      // fit-to-content, creation: convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        try { if (app.canvas?.resizing_node === this) applyResizeAspect(this); } catch (_e) {}
      }
      return _origResize?.apply(this, arguments);
    };

    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = _origDraw?.apply(this, arguments);
      if (isVueNodes() || this.flags?.collapsed) return r;
      try {
        if (app.canvas?.resizing_node === this && !isGraphLoading()) applyResizeAspect(this);
        else repairClassicHeight(this);
        paintClassic(this, ctx);
      } catch (e) {
        if (!this._pixInfoWarned) { this._pixInfoWarned = true; console.warn("[Pixaroma Info] paint failed", e); }
      }
      return r;
    };

    // The button's own floor, in BOTH renderers. Measured: with ComfyUI's
    // default computeSize left in place for Nodes 2.0, a workflow reload grew
    // every small button to that default (188x34 -> 210x58), which changed its
    // scale and its saved size on a plain open. computeSize is a minimum only.
    nodeType.prototype.computeSize = function (out) {
      const sz = classicComputeSize(this);
      if (out) { out[0] = sz[0]; out[1] = sz[1]; return out; }
      return sz;
    };

    // Opening is a single click (index.js below), not a double click.
    nodeType.prototype.onDblClick = function () { return true; };

    // The only input is the hidden saved-state widget. Classic draws a widget's
    // input dot whenever the mouse is over that widget, which put a stray dot
    // on the button's corner; and a dropped STRING wire would plug into it.
    // Nothing connects to an Info button, so draw no slots and refuse wires.
    nodeType.prototype.drawSlots = function () {};
    nodeType.prototype.onConnectInput = function () { return false; };

    const _origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try { this._pixInfoRendererOff?.(); } catch (_e) {}
      this._pixInfoRendererOff = null;
      if (readerNode() === this) closeReader();
      try { this._noteEditor?.close?.(true); } catch (_e) {}
      teardownVueFace(this);
      return _origRemoved?.apply(this, arguments);
    };
  },
});

// ── A click opens the note ──────────────────────────────────────────────────
// One window-capture pair for both renderers. Classic: the node is painted on
// the canvas, so hit-test graph coordinates (the topmost node wins). Nodes 2.0:
// the face is pointer-events:none (so the node can still be placed and dragged,
// label.md #2), so hit-test the visible button's rectangle.
//
// A click = down and up on the same button, moving under 5 px, within 700 ms,
// and the node did not move (that was a drag). Modifier keys are left to
// ComfyUI (multi-select). Nothing is blocked: ComfyUI still selects the node.

function canvasTarget(e) {
  const c = app.canvas?.canvas;
  if (!c) return false;
  const t = e.target;
  if (t === c) return true;
  // Nodes 2.0: the event can land on a node element above the canvas.
  return !!(t && t.closest && t.closest(".lg-node"));
}

function infoAt(e) {
  if (!canvasTarget(e)) return null;
  const g = app.canvas?.graph;
  if (!g) return null;
  if (isVueNodes()) {
    const over = e.target.closest?.(".lg-node");
    let hit = null;
    for (const n of g._nodes || []) {
      if (!isInfo(n) || !n._pixInfoRoot || !n._pixInfoRoot.isConnected) continue;
      const nodeEl = n._pixInfoRoot.closest(".lg-node");
      // Another node's element on top of this point is the one being clicked.
      if (over && nodeEl && over !== nodeEl) continue;
      const r = n._pixInfoRoot.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) hit = n;
    }
    return hit;
  }
  try {
    const p = app.canvas.convertEventToCanvasOffset(e);
    const n = g.getNodeOnPos(p[0], p[1], app.canvas.visible_nodes);
    return isInfo(n) ? n : null;
  } catch (_e) { return null; }
}

if (typeof window !== "undefined" && !window._pixInfoClickWired) {
  window._pixInfoClickWired = true;
  let down = null;
  window.addEventListener("pointerdown", (e) => {
    down = null;
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = infoAt(e);
    if (!n) return;
    down = { node: n, x: e.clientX, y: e.clientY, t: performance.now(), px: n.pos[0], py: n.pos[1] };
  }, true);
  window.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;
    if (!d || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    if (performance.now() - d.t > 700) return;
    const n = d.node;
    if (n.pos[0] !== d.px || n.pos[1] !== d.py) return;
    // The click that PLACES a just-added node is not a request to read it.
    if (performance.now() - (n._pixInfoBorn || 0) < 500) return;
    if (starterPopupOpen() || !isLiveNode(n)) return;
    if (infoAt(e) !== n) return;
    openReader(n);
  }, true);
}
