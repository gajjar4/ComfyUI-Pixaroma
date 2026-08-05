// Longest Side Pixaroma - wiring.
//
// One DOM widget carries the whole face, so both renderers get the same thing
// and there is nothing to rebuild when the renderer is flipped (the trap that
// bit Switch and Mute Switch). The state lives on node.properties and is pushed
// into the hidden LongestSideState input at submission time (Resolution
// pattern, Vue Compat #9), so no extra input dot appears.

import { app } from "/scripts/app.js";
import {
  applyAdaptiveCanvasOnly, isVueNodes, installResizeFloor,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { installNodeAccent, registerNodeSettings } from "../shared/node_settings.mjs";
import { HIDDEN_INPUT_NAME, runState } from "./core.mjs";
import { inputSizeKey } from "./input_size.mjs";
import { buildFace, WIDGET_H, DEFAULT_W, MIN_W } from "./ui.mjs";
import { openLongestSidePanel, closeLongestSidePanelFor } from "./settings.mjs";
import "./help.mjs";

const CLASS_NAME = "PixaromaLongestSide";

function openPanel(node) {
  openLongestSidePanel(node, (n) => {
    n._pixLsRefresh?.();
    n.setDirtyCanvas?.(true, true);
  });
}

// ── where the band lives, per renderer ──────────────────────────────────────
// The band sits on the `width` / `height` slot rows, whose left half is empty.
// CLASSIC: lift it out of the widget flow with a measured offset (see ui.mjs).
// NODES 2.0: Vue clips anything above the widget top, so the lift is no use -
// park the band INSIDE the output-slot block, which is the dead-space itself,
// so it needs no offset and cannot drift if a slot moves.
//
// DOM only, wrapped in try/catch: if a future frontend defeats it, the band
// falls back to a plain row and the node still works.

function vueSlotBlock(el) {
  return el?.querySelector(".lg-slot--output")?.parentElement?.parentElement || null;
}

function parkBand(node) {
  try {
    const band = node._pixLsBand;
    if (!band) return;
    const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    const block = vueSlotBlock(el);
    if (!block) return;
    if (band.parentElement === block) return;   // steady state, one comparison
    block.style.position = "relative";
    block.appendChild(band);
    band.classList.add("parked");
  } catch { /* degrades to a row in the body */ }
}

function applyBandPlacement(node) {
  const band = node._pixLsBand;
  if (!band) return;
  const classic = !isVueNodes();
  band.classList.toggle("classic", classic);
  if (classic) {
    // Coming back from Nodes 2.0 the band is still parked in a slot block that
    // does not exist in Classic - put it back at the top of our own root.
    band.classList.remove("parked");
    const root = node._pixLsRoot;
    if (root && band.parentElement !== root) root.insertBefore(band, root.firstChild);
  } else {
    parkBand(node);
  }
}

// Vue REPLACES the node element on re-render, orphaning the parked band, and it
// can add the slots a frame late, so re-parking has to be a poll. That poll is
// the shared watchdog below (sweep), not a per-node timer.

const WIDGET_NAME = "pixaroma_longest_side_ui";

/** Is this node's face actually present and ours? */
function faceAlive(node) {
  return !!node._pixLsRoot && (node.widgets || []).some((w) => w.name === WIDGET_NAME);
}

/** Drop whatever is left of a face so it can be rebuilt from scratch. */
function teardownFace(node) {
  node._pixLsFloorOff?.();
  node._pixLsFloorOff = null;
  try { node._pixLsBand?.remove(); } catch {}
  try { node._pixLsRoot?.remove(); } catch {}
  const i = (node.widgets || []).findIndex((w) => w.name === WIDGET_NAME);
  if (i >= 0) {
    // Splice AND onRemove. Removing our own element drops what WE made, but
    // ComfyUI created a wrapper and a registration of its own in addDOMWidget
    // and only onRemove releases those. Without it every renderer flip and
    // every node delete left an orphan behind, and this function runs on both.
    // Same order as js/switch/vue_list.mjs, js/mute_switch/vue_list.mjs and
    // js/sliders/ui.mjs; try/catch because the element may already be detached.
    const w = node.widgets[i];
    node.widgets.splice(i, 1);
    try { w?.onRemove?.(); } catch { /* already detached */ }
  }
  node._pixLsBand = null;
  node._pixLsRoot = null;
  node._pixLsRefresh = null;
}

/**
 * IDEMPOTENT. Builds the face only if it is missing, so it is safe to call from
 * a poll.
 *
 * Flipping "Modern Node Design" live does NOT just move things around: measured
 * on this node, the flip left it with `widgets: []` and no face at all, because
 * the widget is created once in nodeCreated and the flip tears the node down
 * without running it again. ComfyUI marks that setting with no reload flag, so
 * nobody is told to refresh, and core's own nodes re-render in place - people
 * reasonably expect ours to as well.
 */
function ensureFace(node) {
  if (faceAlive(node)) return false;
  teardownFace(node);            // clear any half-built leftovers first
  buildFaceOnNode(node);
  return true;
}

function buildFaceOnNode(node) {
  const { root, band, refresh } = buildFace(node, { onGear: openPanel });
  node._pixLsRoot = root;
  node._pixLsBand = band;
  node._pixLsRefresh = refresh;

  applyBandPlacement(node);

  // MANDATORY on every DOM widget: without it the wheel is swallowed by this
  // element and the canvas stops zooming while the cursor is over the node
  // (UI convention #17). No-op in Nodes 2.0, which forwards it itself.
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);   // the face follows this node's accent colour

  const height = () => WIDGET_H;
  const w = node.addDOMWidget("pixaroma_longest_side_ui", "pixaroma_longest_side", root, {
    // canvasOnly is set adaptively: true in legacy (keeps it out of the
    // Parameters tab), false in Nodes 2.0 (so the Vue body renders it).
    getValue: () => null,
    setValue: () => {},
    getMinHeight: height,
    getMaxHeight: height,
    margin: 4,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(w);
  // BOTH serialize flags, because they are different things: the `serialize`
  // passed in the options above is widget.options.serialize, which only keeps
  // the widget out of the PROMPT. The top-level widget.serialize is what keeps
  // it out of the saved WORKFLOW. With only the first one set, every saved file
  // carried a stray widgets_values entry (measured: `widgets_values: [""]`).
  // Harmless here because this is the only widget, but a second widget added
  // later would turn that stray entry into the value-shifting bug in Vue
  // Compat #23.
  w.serialize = false;

  // Nodes 2.0 drag floor: pin the content height ONLY while a resize handle is
  // dragged, so the rows cannot be dragged out of the node frame. The Vue
  // renderer's own floor is a live DOM measurement, not getMinHeight. No-op in
  // legacy; uninstalled in onRemoved.
  node._pixLsFloorOff = installResizeFloor(root, () => WIDGET_H);
  // Deliberately NO node.size write here: this runs on a rebuild too, and
  // resetting the size on a renderer flip would throw away a size the user set.
  node.setDirtyCanvas(true, true);
}

// ── one watchdog for every node of this type ────────────────────────────────
// It does two jobs a per-node timer could not: rebuild a face the renderer flip
// destroyed (the node INSTANCE can be replaced, so a captured `node` in a
// per-node callback would be stale), and re-park the band after Vue replaces
// the node element. Cheap in the steady state - two property checks per node -
// and it stops as soon as the last node of this type is gone.
let _watchdog = 0;
let _rendererOff = null;
let _emptySweeps = 0;

function sweep() {
  const nodes = (app.graph?._nodes || app.graph?.nodes || [])
    .filter((n) => n && n.comfyClass === CLASS_NAME);
  if (!nodes.length) {
    // Do NOT stop on the first empty sweep. A renderer flip and a workflow
    // switch both pass through a moment with zero nodes, and stopping there
    // would leave the nodes that come back a second later with no watchdog to
    // rebuild their faces. Three quiet passes (~1s) means genuinely gone.
    if (++_emptySweeps < 3) return;
    if (_watchdog) { clearInterval(_watchdog); _watchdog = 0; }
    _rendererOff?.();
    _rendererOff = null;
    return;
  }
  _emptySweeps = 0;
  for (const n of nodes) {
    const rebuilt = ensureFace(n);
    // The incoming picture's size can change with no event we can hook: the
    // user swaps the file on the upstream node, or the <img> simply finishes
    // decoding (naturalWidth is 0 until it does). Comparing a cheap key is far
    // simpler than trying to observe every way that can happen.
    const key = inputSizeKey(n);
    if (rebuilt || key !== n._pixLsSizeKey) {
      n._pixLsSizeKey = key;
      n._pixLsRefresh?.();
    }
    if (isVueNodes()) parkBand(n);
  }
}

function startWatchdog() {
  if (!_watchdog) _watchdog = setInterval(sweep, 350);
  if (!_rendererOff) {
    _rendererOff = onRendererChange(() => {
      // The flip and the re-render are not simultaneous, so sweep now AND let
      // the interval catch whatever settles a few hundred ms later.
      sweep();
      for (const n of (app.graph?._nodes || [])) {
        if (n.comfyClass === CLASS_NAME) { applyBandPlacement(n); n._pixLsRefresh?.(); }
      }
    });
  }
}

app.registerExtension({
  name: "Pixaroma.LongestSide",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS_NAME) return;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origConfigure?.apply(this, arguments);
      // Repaint from the restored properties, and re-assert the band placement
      // (a saved node arrives without it). DOM only - nothing here may write
      // node.size or an untouched workflow opens flagged "modified"
      // (Vue Compat #18).
      applyBandPlacement(this);
      queueMicrotask(() => { applyBandPlacement(this); this._pixLsRefresh?.(); });
      startWatchdog();   // belt: a node arriving by any path gets the watchdog
      return r;
    };

    // The run reports the incoming size back so the face can show the EXACT
    // output instead of an estimate. Runtime-only field, deliberately not
    // node.properties: a run must never dirty a saved workflow.
    const _origExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = _origExecuted?.apply(this, arguments);
      try {
        const info = message?.pixaroma_longest_side?.[0];
        if (info?.in_w > 0 && info?.in_h > 0) {
          this._pixLsLastIn = { w: info.in_w, h: info.in_h };
          this._pixLsRefresh?.();
        }
      } catch {}
      return r;
    };

    // Width clamp so the six chips never clip past the right edge. LEGACY-ONLY:
    // in Nodes 2.0 the rendered size lives in the Vue layout store, so clamping
    // node.size there desyncs the two and makes the node jump on a workflow
    // switch.
    const _origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      }
      if (_origOnResize) return _origOnResize.apply(this, arguments);
    };

    // Self-heal for the resize paths that bypass onResize (Vue Compat #13).
    // Gated on isGraphLoading as well as the renderer: node.size is SERIALIZED
    // and a draw hook runs on the very first frame of a load, so an ungated
    // clamp here is the one place that can rewrite the size of a workflow
    // nobody touched (UI convention #7).
    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (isVueNodes() || isGraphLoading()) return;
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };

    const _origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeLongestSidePanelFor(this);
      // teardownFace also removes the BAND, which can be parked in the Vue slot
      // block OUTSIDE our own root - removing the node would otherwise leave it
      // behind in the DOM.
      teardownFace(this);
      const r = _origOnRemoved?.apply(this, arguments);
      // Let the shared watchdog notice the graph is empty and stop itself,
      // rather than counting nodes here (this fires before the node leaves the
      // graph on some paths).
      setTimeout(sweep, 0);
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS_NAME) return;
    buildFaceOnNode(node);
    // Fresh-drop size, set ONLY here and never on a rebuild. configure() runs
    // AFTER nodeCreated (Vue Compat #8), so a saved or duplicated node keeps its
    // own size; and this must not be deferred into a microtask, which would run
    // after configure and clobber it (UI convention #9).
    node.size[0] = DEFAULT_W;
    node.size[1] = node.computeSize()[1];
    node.setDirtyCanvas(true, true);
    startWatchdog();
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────────
// LongestSideState is a `hidden` input, so the workflow JSON does not carry it;
// it is injected from node.properties at submission time. Same walk-and-inject
// as Resolution / Portrait Landscape.

function buildNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS_NAME || n.type === CLASS_NAME) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  // FAIL OPEN: a throw here would reject ComfyUI's own graphToPrompt and break
  // Run for the whole workflow. Never wrap the await above - a failure in CORE
  // must propagate.
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS_NAME) continue;
        if (!index) index = buildNodeIndex();
        const node = findNode(index, id);
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        // runState, not readState: the size-tab and shape-chip LISTS are
        // cosmetic, and sending them would make editing the list change the
        // string ComfyUI caches on, re-running the node for nothing.
        entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(runState(node));
      }
    }
  } catch (e) {
    console.error("[Pixaroma] Longest Side prompt injection failed; prompt sent unchanged", e);
  }
  return result;
};

// The gear in the selection toolbar and the right-click entry both open the
// node's own panel. ownMenuItem false so the central menu adds the one line.
registerNodeSettings(CLASS_NAME, {
  title: "Longest Side",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeLongestSidePanelFor(node),
});
