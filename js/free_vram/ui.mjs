// Free VRAM Pixaroma - the node face.
//
// One DOM widget, so a single implementation serves both renderers. Three rows:
// the mode chips with the gear, a bar of the whole card, and a readout of what
// the last run actually got back.
//
// The bar is the point of the face. A number on its own ("freed 8.4 GB") never
// says whether that was most of the card or a rounding error, and the whole
// reason someone reaches for this node is that they are close to the edge.

import { pixAsset } from "../shared/api_url.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNodeAccent, ACC } from "../shared/node_settings.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import {
  BAR_H, BODY_PAD, GAP, MODES, READOUT_H, ROW_H,
  contentHeight, formatBytes, readReport, readState, writeState,
} from "./core.mjs";

const ROOT_CLASS = "pix-fv-root";
const WIDGET_NAME = "free_vram_ui";
// Namespaced so a future frontend cannot claim the type name and render its own
// widget instead of our element (the Show Text bug).
const WIDGET_TYPE = "pixaroma_free_vram";

let _cssDone = false;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT_CLASS}{
    box-sizing:border-box; display:flex; flex-direction:column; gap:${GAP}px;
    padding:${BODY_PAD}px; font:12px 'Segoe UI',sans-serif; user-select:none;
    /* Transparent, not a panel colour: an opaque root would cover the slot
       labels the node paints just above it. */
    background:transparent;
    /* Anything spare collects BELOW the rows rather than being shared out
       between them. ComfyUI's host wrapper is "flex flex-col *:flex-1", so this
       root is handed flex:1 and can be taller than its content whatever the row
       type says - and a stretched root must never move the readout. */
    justify-content:flex-start;
  }
  /* THE BELT for the same thing, one layer in: every row keeps its own height,
     so no amount of surplus can inflate the gaps or push the last row out of
     the node. Cheap, and it makes the face immune to however a future frontend
     decides to size the widget row. */
  .${ROOT_CLASS} > *{ flex:0 0 auto; }
  .pix-fv-row{ display:flex; align-items:center; gap:6px; min-height:${ROW_H}px; }

  /* NEVER wrap. A wrapped chip row would push the bar and readout down into
     each other as soon as the node is dragged narrow; the chips shrink
     together instead, which is what someone making the node smaller wants. */
  .pix-fv-chips{
    display:flex; gap:4px; flex:1 1 auto; min-width:0;
    flex-wrap:nowrap; overflow:hidden;
  }
  .pix-fv-chip{
    flex:1 1 auto; min-width:26px; box-sizing:border-box;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
    border-radius:4px; color:rgba(255,255,255,0.72); font-size:12px;
    padding:4px 6px; cursor:pointer; text-align:center; line-height:1.1;
    font-family:inherit; white-space:nowrap; overflow:hidden;
  }
  .pix-fv-chip:hover{ border-color:${ACC}; color:#ddd; }
  .pix-fv-chip.on, .pix-fv-chip.on:hover{
    background:${ACC}; border-color:${ACC}; color:#fff;
  }

  /* The bundled gear SVG as a mask, never the emoji: an emoji is drawn by the
     OS, so it is a different shape and baseline on every platform. */
  .pix-fv-gear{
    flex:none; width:16px; height:16px; padding:0; margin:0; line-height:0;
    background:none; border:none; cursor:pointer;
  }
  .pix-fv-gear::before{
    content:""; display:block; width:14px; height:14px; background:#bbb;
    -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
  }
  .pix-fv-gear:hover::before{ background:${ACC}; }

  .pix-fv-bar{
    height:${BAR_H}px; border-radius:4px; background:#1d1d1d; overflow:hidden;
    display:flex; flex:none;
  }
  .pix-fv-bar i{ display:block; height:100%; min-width:0; }
  .pix-fv-used{ background:#3f3f3f; }
  .pix-fv-just{ background:${ACC}; }
  .pix-fv-was{ background:#242424; }

  .pix-fv-readout{
    min-height:${READOUT_H}px; display:flex; align-items:center; gap:6px;
    font-size:11px; white-space:nowrap; overflow:hidden;
  }
  .pix-fv-lead{
    color:${ACC}; overflow:hidden; text-overflow:ellipsis; min-width:0;
  }
  .pix-fv-lead b{ font-size:13px; font-weight:500; }
  .pix-fv-tail{
    margin-left:auto; color:rgba(255,255,255,0.42); flex:none;
  }
  .pix-fv-readout.idle .pix-fv-lead{ color:rgba(255,255,255,0.42); }
  .pix-fv-readout.warn .pix-fv-lead{ color:#d9a441; }
  .pix-fv-readout.bad .pix-fv-lead{ color:#e8694a; }
  `;
  const el = document.createElement("style");
  el.id = "pix-fv-css";
  el.textContent = css;
  document.head.appendChild(el);
}

export function buildFace(node, openPanel) {
  const root = document.createElement("div");
  root.className = ROOT_CLASS;

  const row = document.createElement("div");
  row.className = "pix-fv-row";
  const bar = document.createElement("div");
  bar.className = "pix-fv-bar";
  const readout = document.createElement("div");
  readout.className = "pix-fv-readout";
  root.append(row, bar, readout);

  node._pixFvRoot = root;
  node._pixFvRow = row;
  node._pixFvBar = bar;
  node._pixFvReadout = readout;
  node._pixFvOpenPanel = openPanel;

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => contentHeight(readState(node).showBar),
  });
  // BOTH flags, they are not the same one: options.serialize keeps the widget
  // out of the PROMPT, widget.serialize (top level) keeps it out of the saved
  // WORKFLOW. With only the first, the node writes widgets_values: [""] into
  // every saved file - state that means nothing and can differ between
  // renderers, which is how a clean workflow starts opening "modified".
  widget.serialize = false;
  // canvasOnly must be TRUE in Classic (keeps it out of the Parameters tab) and
  // FALSE in Nodes 2.0 (or the Vue body renders nothing) - hence the live getter.
  applyAdaptiveCanvasOnly(widget);
  // Without this the wheel stops zooming the canvas whenever the cursor is over
  // this node, because the DOM widget swallows it (convention #17).
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);
  // Pins a content floor ONLY while a resize handle is dragged, so the rows
  // cannot be squashed out of the frame - and node.size is never written, so a
  // clean workflow cannot open "modified".
  node._pixFvFloorOff = installResizeFloor(root, () => contentHeight(readState(node).showBar));

  node._pixFvWidget = widget;
  return widget;
}

function renderChips(node, st, row) {
  const wrap = document.createElement("div");
  wrap.className = "pix-fv-chips";
  for (const mode of MODES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pix-fv-chip" + (st.mode === mode.id ? " on" : "");
    b.textContent = mode.label;
    b.title = mode.title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { mode: mode.id });
      renderFace(node);
    });
    wrap.appendChild(b);
  }
  row.appendChild(wrap);
}

function paintBar(node, st, bar) {
  bar.style.display = st.showBar ? "" : "none";
  if (!st.showBar) return;
  const report = readReport(node);
  const parts = Array.isArray(report?.bar) ? report.bar : null;
  bar.textContent = "";
  if (!parts) {
    bar.title = "The card, once this node has run: grey still in use, orange " +
                "what it just released, dark what was already free.";
    return;
  }
  const [used, just, was] = parts;
  for (const [cls, frac] of [["used", used], ["just", just], ["was", was]]) {
    const seg = document.createElement("i");
    seg.className = `pix-fv-${cls}`;
    seg.style.width = `${Math.max(0, Math.min(1, Number(frac) || 0)) * 100}%`;
    bar.appendChild(seg);
  }
  bar.title = [
    `In use: ${formatBytes(report.total - report.after)}`,
    `Just released: ${formatBytes(report.after - report.before)}`,
    `Already free: ${formatBytes(report.before)}`,
    `Card: ${formatBytes(report.total)}${report.device ? ` (${report.device})` : ""}`,
  ].join("\n");
}

/**
 * True when nothing is wired to the INPUT, which is the only wiring this node
 * actually needs.
 *
 * The OUTPUT is optional: the node is an OUTPUT_NODE, so ComfyUI runs it with
 * nothing downstream - hang it off a VAE Decode and it fires there. Only the
 * input matters, because that is what says WHEN.
 */
function inputUnwired(node) {
  const inp = node?.inputs?.[0];
  if (!inp) return false;
  return inp.link == null;
}

function paintReadout(node, st, readout) {
  readout.textContent = "";
  readout.className = "pix-fv-readout";
  const lead = document.createElement("span");
  lead.className = "pix-fv-lead";
  const tail = document.createElement("span");
  tail.className = "pix-fv-tail";
  readout.append(lead, tail);

  const report = readReport(node);

  // The INPUT is what says when to act, so an unwired one is the only wiring
  // problem worth flagging - and the node deliberately does nothing in that
  // state, which is what makes it safe as an OUTPUT_NODE.
  if (inputUnwired(node)) {
    readout.classList.add("warn");
    lead.textContent = "wire something in to say when";
    lead.title = "Take the wire from whatever you want cleaned up after and drop " +
                 "it on this node's input. The output does not need connecting: " +
                 "connect it only when a particular later step must find the room " +
                 "already made.";
    return;
  }

  if (!report) {
    readout.classList.add("idle");
    lead.textContent = st.useThreshold
      ? `waiting · only below ${formatBytes(st.thresholdGb * 1024 ** 3, 0)} free`
      : "waiting for a run";
    return;
  }

  if (report.ok === false) {
    readout.classList.add("bad");
    lead.textContent = report.message || "could not free memory";
    lead.title = lead.textContent;
    return;
  }

  if (report.skipped) {
    readout.classList.add("idle");
    lead.textContent = report.unwired ? "nothing wired in" : "skipped";
    lead.title = report.message || "";
    // An unwired report carries no readings at all, so there is no figure to
    // print - "- free" would read as a broken measurement rather than none.
    tail.textContent = report.after == null ? "" : `${formatBytes(report.after)} free`;
    tail.title = lead.title;
    return;
  }

  if (report.cached) {
    // The node did not run this time: ComfyUI replayed the previous result
    // because nothing above it changed. Only reachable with "Free on every run"
    // switched off, which is exactly when claiming a fresh figure would mislead.
    readout.classList.add("idle");
    lead.textContent = `${formatBytes(report.freed)} freed earlier`;
    lead.title = "Nothing changed above this node, so ComfyUI skipped it and no " +
                 "memory was freed on this run. Turn on Free on every run in the " +
                 "settings to make it act regardless.";
    tail.textContent = "skipped";
    tail.title = lead.title;
    return;
  }

  // "freed 0 B" reads like a malfunction. It is usually the honest answer that
  // there was nothing loaded to let go of, so say that instead.
  if (!report.freed) {
    readout.classList.add("idle");
    lead.textContent = "nothing to free";
    lead.title = "It ran, and there was nothing loaded that it could let go of.";
    tail.textContent = `${formatBytes(report.after)} / ${formatBytes(report.total, 0)} free`;
    tail.title = lead.title;
    return;
  }

  const amount = document.createElement("b");
  amount.textContent = formatBytes(report.freed);
  lead.textContent = `${report.label || "freed"} `;
  lead.appendChild(amount);
  lead.title = [
    `ComfyUI can see: ${formatBytes(report.before)} free before, ` +
      `${formatBytes(report.after)} after`,
    `The card reports: ${formatBytes(report.driverBefore)} free before, ` +
      `${formatBytes(report.driverAfter)} after`,
  ].join("\n");
  tail.textContent = `${formatBytes(report.after)} / ${formatBytes(report.total, 0)} free`;
  tail.title = lead.title;
}

export function renderFace(node) {
  const row = node?._pixFvRow;
  const bar = node?._pixFvBar;
  const readout = node?._pixFvReadout;
  if (!row || !bar || !readout) return;
  const st = readState(node);

  row.textContent = "";
  renderChips(node, st, row);

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "pix-fv-gear";
  gear.title = "Free VRAM settings";
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    node._pixFvOpenPanel?.(node);
  });
  row.appendChild(gear);

  paintBar(node, st, bar);
  paintReadout(node, st, readout);
  node.setDirtyCanvas?.(true, false);
}

export function destroyFace(node) {
  try { node._pixFvFloorOff?.(); } catch {}
  node._pixFvFloorOff = null;
  // Splicing the widget out is NOT enough on its own - ComfyUI keeps DOM widgets
  // in its own store and re-mounts them (monitor.md #8). Nothing here removes
  // the widget today, but the hook is kept honest for whoever adds that.
  node._pixFvRoot = null;
  node._pixFvRow = null;
  node._pixFvBar = null;
  node._pixFvReadout = null;
  node._pixFvWidget = null;
}
