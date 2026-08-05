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
import { installNodeAccent, registerNodeSettings } from "../shared/node_settings.mjs";
import { HIDDEN_INPUT_NAME, runState } from "./core.mjs";
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

function setupNode(node) {
  const { root, refresh } = buildFace(node, { onGear: openPanel });
  node._pixLsRoot = root;
  node._pixLsRefresh = refresh;

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

  // Fresh-drop size only. configure() runs AFTER nodeCreated (Vue Compat #8) so
  // a saved or duplicated node keeps its own size; this is never wrapped in a
  // microtask, which would run after configure and clobber it (UI convention #9).
  node.size[0] = DEFAULT_W;
  node.size[1] = node.computeSize()[1];
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "Pixaroma.LongestSide",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS_NAME) return;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origConfigure?.apply(this, arguments);
      // Repaint from the restored properties. DOM only - nothing here may write
      // node.size or an untouched workflow opens flagged "modified"
      // (Vue Compat #18).
      queueMicrotask(() => this._pixLsRefresh?.());
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
      this._pixLsFloorOff?.();
      this._pixLsFloorOff = null;
      closeLongestSidePanelFor(this);
      this._pixLsRoot = null;
      return _origOnRemoved?.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS_NAME) return;
    setupNode(node);
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
