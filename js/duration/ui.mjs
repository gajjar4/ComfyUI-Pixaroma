// Duration Pixaroma - the node face.
//
// One DOM widget, so a single implementation serves both renderers. Two rows:
// the picker (chips, slider or a number box, whichever the settings say) and a
// readout that always states what will be SENT, because snapping to the model's
// pattern changes the length and that must never be hidden.

import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNodeAccent, ACC } from "../shared/node_settings.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import {
  ROW_H, READOUT_H, BODY_PAD, PICK_CHIPS, PICK_SLIDER,
  readState, writeState, clampToPick,
} from "./core.mjs";
import { computeLocal } from "./compute.mjs";
import { previewCustom } from "./api.mjs";

const ROOT_CLASS = "pix-dur-root";
const WIDGET_NAME = "duration_ui";
// Namespaced so a future frontend cannot claim the type name and render its own
// widget instead of our element (the Show Text bug).
const WIDGET_TYPE = "pixaroma_duration";

let _cssDone = false;

export function bodyHeight() {
  return ROW_H + READOUT_H + BODY_PAD * 2 + 4;
}

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT_CLASS}{
    box-sizing:border-box; display:flex; flex-direction:column; gap:4px;
    padding:${BODY_PAD}px; font:12px 'Segoe UI',sans-serif; user-select:none;
    min-height:${bodyHeight()}px;
    /* Transparent, not a panel colour: in Nodes 2.0 an opaque root would cover
       the slot labels the node draws beside it. */
    background:transparent;
  }
  .pix-dur-pickrow{ display:flex; align-items:center; gap:5px; min-height:${ROW_H}px; }

  .pix-dur-chips{ display:flex; gap:4px; flex:1 1 auto; min-width:0; flex-wrap:wrap; }
  .pix-dur-chip{
    flex:1 1 auto; min-width:34px; box-sizing:border-box;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
    border-radius:4px; color:rgba(255,255,255,0.72); font-size:12px;
    padding:4px 6px; cursor:pointer; text-align:center; line-height:1.1;
  }
  .pix-dur-chip:hover{ border-color:${ACC}; color:#ddd; }
  .pix-dur-chip.on, .pix-dur-chip.on:hover{
    background:${ACC}; border-color:${ACC}; color:#fff;
  }

  .pix-dur-slider{
    flex:1 1 auto; min-width:0; height:${ROW_H - 4}px; box-sizing:border-box;
    position:relative; overflow:hidden; cursor:ew-resize;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
  }
  .pix-dur-slider:hover{ border-color:${ACC}; }
  .pix-dur-fill{ position:absolute; left:0; top:0; bottom:0; background:${ACC}; pointer-events:none; }
  .pix-dur-sval{
    position:absolute; inset:0; display:flex; align-items:center;
    justify-content:space-between; padding:0 7px; pointer-events:none;
    font-size:12px; color:#ddd;
  }
  .pix-dur-slabel{ color:rgba(255,255,255,0.75); }

  .pix-dur-num{
    flex:1 1 auto; min-width:0; height:${ROW_H - 4}px; box-sizing:border-box;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
    color:#ddd; font:12px 'Segoe UI',sans-serif; padding:0 7px; outline:none;
  }
  .pix-dur-num:focus{ border-color:${ACC}; }

  /* The bundled gear SVG as a mask, never the emoji: an emoji is drawn by the
     OS, so it is a different shape and baseline on every platform. */
  .pix-dur-gear{
    flex:none; width:16px; height:16px; padding:0; margin:0; line-height:0;
    background:none; border:none; cursor:pointer;
  }
  .pix-dur-gear::before{
    content:""; display:block; width:14px; height:14px; background:#bbb;
    -webkit-mask:url("/pixaroma/assets/icons/note/gear.svg") center/contain no-repeat;
    mask:url("/pixaroma/assets/icons/note/gear.svg") center/contain no-repeat;
  }
  .pix-dur-gear:hover::before{ background:${ACC}; }

  .pix-dur-readout{
    min-height:${READOUT_H}px; display:flex; align-items:center; gap:5px;
    font-size:11px; color:${ACC}; white-space:nowrap; overflow:hidden;
    text-overflow:ellipsis;
  }
  .pix-dur-readout .dim{ color:rgba(255,255,255,0.42); }
  .pix-dur-readout.bad{ color:#e8694a; }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

/** Trim float dust for display: 5 -> "5", 5.5 -> "5.5", 5.1667 -> "5.17". */
function fmt(value, places = 2) {
  const rounded = Math.round(value * 10 ** places) / 10 ** places;
  return String(rounded);
}

export function buildFace(node, openPanel) {
  const root = document.createElement("div");
  root.className = ROOT_CLASS;

  const pickRow = document.createElement("div");
  pickRow.className = "pix-dur-pickrow";
  const readout = document.createElement("div");
  readout.className = "pix-dur-readout";
  root.append(pickRow, readout);

  node._pixDurRoot = root;
  node._pixDurPickRow = pickRow;
  node._pixDurReadout = readout;
  node._pixDurOpenPanel = openPanel;

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => bodyHeight(),
  });
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
  node._pixDurFloorOff = installResizeFloor(root, () => bodyHeight());

  return widget;
}

function renderChips(node, st, pickRow) {
  const wrap = document.createElement("div");
  wrap.className = "pix-dur-chips";
  for (const v of st.values) {
    const b = document.createElement("button");
    b.className = "pix-dur-chip" + (Math.abs(v - st.seconds) < 1e-6 ? " on" : "");
    b.textContent = fmt(v) + "s";
    b.title = `Make the video ${fmt(v)} seconds long`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { seconds: v });
      renderFace(node);
    });
    wrap.appendChild(b);
  }
  pickRow.appendChild(wrap);
}

function renderSlider(node, st, pickRow) {
  const lo = Math.min(st.min, st.max);
  const hi = Math.max(st.min, st.max);
  const box = document.createElement("div");
  box.className = "pix-dur-slider";
  const frac = hi > lo ? (st.seconds - lo) / (hi - lo) : 0;
  const fill = document.createElement("div");
  fill.className = "pix-dur-fill";
  fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  const val = document.createElement("div");
  val.className = "pix-dur-sval";
  val.innerHTML = "";
  const lab = document.createElement("span");
  lab.className = "pix-dur-slabel";
  lab.textContent = "duration";
  const num = document.createElement("span");
  num.textContent = fmt(st.seconds) + " s";
  val.append(lab, num);
  box.append(fill, val);
  box.title = `Drag to set the length (${fmt(lo)} to ${fmt(hi)} seconds)`;

  const setFromEvent = (ev) => {
    const r = box.getBoundingClientRect();
    if (r.width <= 0) return;
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const next = clampToPick(readState(node), lo + f * (hi - lo));
    writeState(node, { seconds: next });
    renderFace(node);
  };
  const end = () => {
    box.onpointermove = null;
    try { box.releasePointerCapture?.(box._pixCap); } catch {}
    box._pixCap = null;
  };
  box.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    // setPointerCapture AND the buttons guard (convention #20): without both, a
    // release that goes missing leaves the slider stuck to the cursor.
    box._pixCap = ev.pointerId;
    try { box.setPointerCapture(ev.pointerId); } catch {}
    setFromEvent(ev);
    box.onpointermove = (mv) => {
      if (!(mv.buttons & 1)) { end(); return; }
      setFromEvent(mv);
    };
  });
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  box.addEventListener("lostpointercapture", end);
  pickRow.appendChild(box);
}

function renderNumber(node, st, pickRow) {
  const input = document.createElement("input");
  input.className = "pix-dur-num";
  input.type = "text";
  input.value = fmt(st.seconds);
  input.title = "Type the length in seconds";
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
  const commit = () => {
    const parsed = parseFloat(input.value);
    const next = Number.isFinite(parsed) ? clampToPick(readState(node), parsed) : readState(node).seconds;
    writeState(node, { seconds: next });
    renderFace(node);
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
  });
  pickRow.appendChild(input);
}

export function renderFace(node) {
  const pickRow = node?._pixDurPickRow;
  const readout = node?._pixDurReadout;
  if (!pickRow || !readout) return;
  const st = readState(node);

  pickRow.textContent = "";
  if (st.pick === PICK_CHIPS) renderChips(node, st, pickRow);
  else if (st.pick === PICK_SLIDER) renderSlider(node, st, pickRow);
  else renderNumber(node, st, pickRow);

  const gear = document.createElement("button");
  gear.className = "pix-dur-gear";
  gear.title = "Duration settings";
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    node._pixDurOpenPanel?.(node);
  });
  pickRow.appendChild(gear);

  paintReadout(node, st, readout);
  node.setDirtyCanvas?.(true, false);
}

function writeReadout(readout, seconds, frames, actual, note) {
  readout.className = "pix-dur-readout";
  readout.textContent = "";
  const main = document.createElement("span");
  main.textContent = `${fmt(seconds)} s → ${frames} frames`;
  readout.appendChild(main);
  const dim = document.createElement("span");
  dim.className = "dim";
  // Only mention the true length when snapping actually MOVED it; saying
  // "(5 s)" after "5 s" is noise.
  dim.textContent = note || (Math.abs(actual - seconds) > 0.005 ? `(really ${fmt(actual)} s)` : "");
  if (dim.textContent) readout.appendChild(dim);
}

export function paintReadout(node, st, readout) {
  const local = computeLocal(st || readState(node));
  const state = st || readState(node);
  if (!local.custom) {
    writeReadout(readout, state.seconds, local.frames, local.actual);
    return;
  }
  // A custom formula is evaluated by PYTHON, never re-implemented here - a
  // second expression language would agree with the real one right up until it
  // did not, and a confidently wrong number is worse than a pending one.
  readout.className = "pix-dur-readout";
  readout.textContent = `${fmt(state.seconds)} s → working it out...`;
  previewCustom(node, state).then((res) => {
    const live = node._pixDurReadout;
    if (!live || live !== readout) return;   // node re-rendered or went away
    if (!res || !res.ok) {
      readout.className = "pix-dur-readout bad";
      readout.textContent = `${fmt(state.seconds)} s → formula does not work, using ${res?.frames ?? local.frames} frames`;
      return;
    }
    writeReadout(readout, state.seconds, res.frames, res.actual);
  });
}

export function destroyFace(node) {
  try { node._pixDurFloorOff?.(); } catch {}
  node._pixDurFloorOff = null;
  node._pixDurRoot = null;
  node._pixDurPickRow = null;
  node._pixDurReadout = null;
}
