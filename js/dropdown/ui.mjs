// Dropdown Pixaroma - the node face (one DOM row) and the output-dot alignment
// that puts the dot ON that row in BOTH renderers.
//
// A DOM widget renders in both renderers, so one row implementation serves each.
// Getting the dot onto the row is two entirely separate mechanisms:
//
//   CLASSIC    LiteGraph honours a hard-coded `output.pos` (getConnectionPos
//              returns node.pos + slot.pos verbatim) and skips positioned
//              outputs in its auto-stacker, so we park the dot at the row's Y.
//
//   NODES 2.0  There is NO official way to move an output - NodeSlots.vue
//              renders every output in the top-right column and there is no
//              output equivalent of the widget-socket model that inputs have.
//              So we NUDGE the DOM. Cosmetic and wrapped in try/catch: if a
//              future frontend defeats it, the dot simply returns to the corner
//              and the node keeps working.
//
// Both are lifted from Control Panel (js/sliders/ui.mjs), which is the only
// other node in the pack doing this. Every trap it documents applies here.

import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNodeAccent, accentOf, ACC } from "../shared/node_settings.mjs";
import { ROW_H, MIN_W, BODY_PAD, readState, writeState, selectedOption } from "./core.mjs";
import { SOCKET_LABELS, previewText } from "./coerce.mjs";

// What Classic inserts above the row: node.widgets_start_y (2, set in index.js)
// plus BaseDOMWidgetImpl.DEFAULT_MARGIN (10). Read the margin off the live
// widget where it matters (alignOutputLegacy); this constant is only for
// reserving the matching space below.
const TOP_INSET = 12;

const ROW_CLASS = "pix-dd-row";
const WIDGET_NAME = "dropdown_ui";
// Namespaced so a future frontend cannot start claiming the type name and
// render its OWN widget instead of our element (the Show Text bug).
const WIDGET_TYPE = "pixaroma_dropdown";

let _cssDone = false;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROW_CLASS}{
    /* DEFINITE height, never 100%. The Nodes 2.0 widget row is a min-content
       grid track, so a row whose height is not definite collapses (measured: a
       2px row). Legacy hides the bug by setting an explicit element height. */
    height:${ROW_H}px; min-height:${ROW_H}px; box-sizing:border-box;
    display:flex; align-items:center; gap:5px;
    font:12px 'Segoe UI',sans-serif; user-select:none;
    padding-right:16px;   /* the output dot lands here */
  }
  .pix-dd-arrow{
    flex:none; width:13px; text-align:center; cursor:pointer;
    color:${ACC}; font-size:10px; line-height:1; background:none; border:none; padding:0;
  }
  .pix-dd-arrow:hover{ filter:brightness(1.35); }
  .pix-dd-arrow.dim{ opacity:.28; cursor:default; }
  .pix-dd-arrow.dim:hover{ filter:none; }

  .pix-dd-field{
    flex:1 1 auto; min-width:0; height:${ROW_H - 6}px; box-sizing:border-box;
    display:flex; align-items:center; justify-content:space-between; gap:5px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
    padding:0 6px; cursor:pointer;
  }
  .pix-dd-field:hover{ border-color:${ACC}; }
  .pix-dd-field.open{ border-color:${ACC}; }
  .pix-dd-name{
    flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; color:#ddd; font-size:11px;
  }
  .pix-dd-name.empty{ color:#777; font-style:italic; }
  .pix-dd-caret{ flex:none; color:${ACC}; font-size:8px; }

  .pix-dd-gear{
    flex:none; width:15px; text-align:center; cursor:pointer;
    color:#aaa; font-size:12px; line-height:1; background:none; border:none; padding:0;
  }
  .pix-dd-gear:hover{ color:${ACC}; }

  .pix-dd-type{
    flex:none; color:${ACC}; font-size:10px; letter-spacing:.02em;
    max-width:46px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }

  /* ── The option popup (lives on document.body, outside the node) ────────── */
  .pix-dd-pop{
    position:fixed; z-index:1200; box-sizing:border-box;
    background:#1d1d1d; border:1px solid #555; border-radius:6px; padding:4px;
    max-height:320px; overflow-y:auto; overflow-x:hidden;
    font:12px 'Segoe UI',sans-serif; box-shadow:0 6px 20px rgba(0,0,0,.45);
  }
  .pix-dd-opt{
    display:flex; align-items:baseline; gap:10px;
    padding:6px 9px; border-radius:4px; cursor:pointer;
  }
  .pix-dd-opt:hover{ background:#2a2a2a; }
  .pix-dd-opt.sel{ background:${ACC}; }
  .pix-dd-oname{
    flex:none; max-width:45%; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; color:#ddd; font-size:12px;
  }
  .pix-dd-opt.sel .pix-dd-oname{ color:#fff; }
  .pix-dd-ohint{
    flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; color:#888; font-size:11px; text-align:right;
  }
  .pix-dd-opt.sel .pix-dd-ohint{ color:rgba(255,255,255,.8); }
  .pix-dd-opt.bad .pix-dd-ohint{ color:#e0703a; }
  .pix-dd-pop-empty{ padding:8px 10px; color:#777; font-size:11px; font-style:italic; }

  /* ── Nodes 2.0 only ─────────────────────────────────────────────────────
     Every widget row reserves a 12px column for a widget-INPUT dot. This node
     has no inputs, so collapse it or the row is indented by 12px for nothing. */
  .lg-node:has(.${ROW_CLASS}) .lg-node-widget > div:first-child{
    width:0 !important; min-width:0 !important; overflow:hidden !important;
  }
  /* The moved output slot must paint no label (our row already shows the type)
     and must not swallow pointer events over the row - only its dot may. */
  .lg-node:has(.${ROW_CLASS}) .lg-slot--output{ padding-left:0 !important; pointer-events:none; }
  .lg-node:has(.${ROW_CLASS}) .lg-slot--output > div:first-child{ display:none !important; }
  .lg-node:has(.${ROW_CLASS}) .lg-slot--output [data-testid="slot-connection-dot"]{ pointer-events:auto; }
  `;
  const tag = document.createElement("style");
  tag.id = "pix-dd-css";
  tag.textContent = css;
  document.head.appendChild(tag);
}

/**
 * The node body height. One row, but the two renderers inset it differently.
 *
 * CLASSIC puts the row at `widgets_start_y + widget.margin` from the top (2 + 10
 * here), so the body has to reserve the same again underneath or the row sits
 * visibly high in the node - measured 12px of space above and 2px below before
 * this was matched.
 *
 * NODES 2.0 applies no such margin; its own chrome is added at the call site.
 */
export function bodyHeight() {
  return isVueNodes() ? ROW_H + BODY_PAD * 2 : TOP_INSET * 2 + ROW_H;
}

// ── The row ────────────────────────────────────────────────────────────────

export function ensureRow(node) {
  if (node._pixDdRow?.isConnected) return node._pixDdRow;
  // Fall back to the held element even when it is not connected yet: the first
  // render runs before the element is in the DOM, and bailing here would leave
  // the body permanently empty (the Sizes bug).
  return node._pixDdRow || null;
}

export function buildRow(node, onOpenSettings) {
  injectCSS();

  const row = document.createElement("div");
  row.className = ROW_CLASS;

  const prev = document.createElement("button");
  prev.className = "pix-dd-arrow pix-dd-prev";
  prev.textContent = "◀";
  prev.title = "Previous entry";

  const field = document.createElement("div");
  field.className = "pix-dd-field";
  field.title = "Click to choose from your list";
  const name = document.createElement("span");
  name.className = "pix-dd-name";
  const caret = document.createElement("span");
  caret.className = "pix-dd-caret";
  caret.textContent = "▼";
  field.append(name, caret);

  const next = document.createElement("button");
  next.className = "pix-dd-arrow pix-dd-next";
  next.textContent = "▶";
  next.title = "Next entry";

  const gear = document.createElement("button");
  gear.className = "pix-dd-gear";
  gear.textContent = "⚙";
  gear.title = "Edit the list and what it sends out";

  const type = document.createElement("span");
  type.className = "pix-dd-type";

  row.append(prev, field, next, gear, type);

  node._pixDdRow = row;
  node._pixDdParts = { prev, field, name, next, gear, type };

  // ONE delegated listener. Every branch stops propagation so the click does
  // not reach the canvas and start a node drag.
  row.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (t.closest(".pix-dd-prev")) { e.stopPropagation(); step(node, -1); return; }
    if (t.closest(".pix-dd-next")) { e.stopPropagation(); step(node, +1); return; }
    // The gear must close the popup itself: _outside now skips this row, so it
    // will not do it for us.
    if (t.closest(".pix-dd-gear")) { e.stopPropagation(); closePopup(); onOpenSettings?.(node); return; }
    if (t.closest(".pix-dd-field")) {
      e.stopPropagation();
      // An empty list has nothing to show, so send the user where they can fix
      // that instead of opening a popup that says nothing.
      if (!readState(node).options.length) onOpenSettings?.(node);
      else togglePopup(node);
    }
  });

  const w = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, row, {
    serialize: false,                       // keeps it out of the API prompt
    getValue: () => "",
    setValue: () => {},
  });
  if (w) {
    // A DIFFERENT flag from options.serialize above: this one keeps the widget
    // out of the SAVED WORKFLOW, so the file does not gain a widgets_values slot.
    w.serialize = false;
    // Fixes the height in legacy.
    w.computeSize = () => [node.size?.[0] || MIN_W, ROW_H];
    // Own-property shadow of the DOMWidget prototype method. With it defined the
    // row becomes an 'auto' grid track in Nodes 2.0 and eats the node's spare
    // height instead of hugging its content.
    w.computeLayoutSize = undefined;
    applyAdaptiveCanvasOnly(w);
    node._pixDdWidget = w;
  }

  // Without this the wheel over the row stops zooming the canvas in Classic.
  installCanvasZoomPassthrough(row);
  installNodeAccent(node, row);

  return row;
}

/** Repaint the row from state. DOM only - never touches serialized node state. */
export function renderRow(node) {
  const parts = node._pixDdParts;
  if (!parts) return;
  const st = readState(node);
  const opt = st.options[st.index];

  if (!st.options.length) {
    parts.name.textContent = "No options yet, press the gear";
    parts.name.classList.add("empty");
    parts.field.title = "Open the settings and add your first entry";
  } else {
    parts.name.textContent = opt?.name?.trim() || "(unnamed)";
    parts.name.classList.remove("empty");
    parts.field.title = opt ? `Sends: ${previewText(opt.value, st.type)}` : "";
  }

  parts.type.textContent = SOCKET_LABELS[st.type] || st.type;
  parts.type.title = `This node sends ${SOCKET_LABELS[st.type]}. Change it in the settings.`;

  const many = st.options.length > 1;
  parts.prev.classList.toggle("dim", !many);
  parts.next.classList.toggle("dim", !many);
}

/** Step the selection. Wraps, so a short list is quick to cycle. */
export function step(node, delta) {
  const st = readState(node);
  if (st.options.length < 2) return;
  const n = st.options.length;
  writeState(node, { index: ((st.index + delta) % n + n) % n });
  renderRow(node);
  closePopup();
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

// ── The option popup ───────────────────────────────────────────────────────

let _pop = null;
let _popNode = null;

export function closePopup() {
  if (_pop) {
    _pop.remove();
    document.removeEventListener("pointerdown", _outside, true);
    document.removeEventListener("wheel", _outside, true);
    document.removeEventListener("keydown", _onKey, true);
  }
  _popNode?._pixDdParts?.field?.classList?.remove("open");
  _pop = null;
  _popNode = null;
}

export function closePopupFor(node) {
  if (_popNode === node) closePopup();
}

function _outside(e) {
  if (!_pop) return;
  // MUST gate on containment or scrolling the option list closes the popup.
  if (_pop.contains(e.target)) return;
  // The OWNING row is not "outside" either. This handler runs in the CAPTURE
  // phase, so without this it fires before the row's own pointerdown: clicking
  // the field a second time closed the popup here and the row handler then
  // immediately reopened it, which looks exactly like the click doing nothing.
  // Leaving the row alone lets its own handler decide (toggle, step, or gear).
  if (_popNode?._pixDdRow?.contains(e.target)) return;
  closePopup();
}

function _onKey(e) {
  if (e.key === "Escape") { e.stopPropagation(); closePopup(); }
}

function togglePopup(node) {
  if (_popNode === node) { closePopup(); return; }
  openPopup(node);
}

export function openPopup(node) {
  closePopup();
  const parts = node._pixDdParts;
  if (!parts) return;
  const st = readState(node);

  const pop = document.createElement("div");
  pop.className = "pix-dd-pop";
  // The popup lives on document.body, outside the node, so it does not inherit
  // the node's accent variable - set it here or the selected row is orange when
  // the node is not.
  pop.style.setProperty("--pix-acc", accentOf(node));

  if (!st.options.length) {
    const empty = document.createElement("div");
    empty.className = "pix-dd-pop-empty";
    empty.textContent = "Nothing in the list yet.";
    pop.appendChild(empty);
  } else {
    st.options.forEach((o, i) => {
      const item = document.createElement("div");
      item.className = "pix-dd-opt" + (i === st.index ? " sel" : "");
      const nm = document.createElement("span");
      nm.className = "pix-dd-oname";
      nm.textContent = o.name?.trim() || "(unnamed)";
      const hint = document.createElement("span");
      hint.className = "pix-dd-ohint";
      // First line only: a value may be several lines and the raw string would
      // blow the one-line row apart.
      hint.textContent = previewText(o.value, st.type);
      item.append(nm, hint);
      item.title = o.value || "";
      item.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        writeState(node, { index: i });
        renderRow(node);
        closePopup();
        node.setDirtyCanvas?.(true, true);
      });
      pop.appendChild(item);
    });
  }

  document.body.appendChild(pop);
  const r = parts.field.getBoundingClientRect();
  pop.style.left = Math.round(r.left) + "px";
  pop.style.width = Math.max(200, Math.round(r.width)) + "px";
  // Flip above when there is not room below.
  const h = pop.offsetHeight;
  const below = window.innerHeight - r.bottom;
  pop.style.top = (below < h + 8 && r.top > h + 8)
    ? Math.round(r.top - h - 4) + "px"
    : Math.round(r.bottom + 4) + "px";

  parts.field.classList.add("open");
  _pop = pop;
  _popNode = node;

  // Deferred, or the click that opened it immediately closes it.
  setTimeout(() => {
    document.addEventListener("pointerdown", _outside, true);
    document.addEventListener("wheel", _outside, true);
    document.addEventListener("keydown", _onKey, true);
  }, 0);
}

// ── Output-dot alignment ───────────────────────────────────────────────────

/**
 * CLASSIC: park the dot at the row's Y.
 *
 * MIND THE MARGIN. Legacy insets a DOM widget's ELEMENT by widget.margin
 * (default 10): the element draws at node.pos + margin + widget.y while
 * widget.y carries NO margin. A dot at widget.y + ROW_H/2 therefore lands a
 * full 10px ABOVE the row's real centre - on a 26px row that is nearly its top
 * edge. Control Panel shipped exactly that bug and the user spotted it at once.
 * Nodes 2.0 has no such margin, which is why the same maths looks right there.
 */
export function alignOutputLegacy(node) {
  const w = node._pixDdWidget;
  const out = node.outputs?.[0];
  if (!w || !out) return;
  const y = w.y;
  if (!Number.isFinite(y)) return;
  const margin = Number.isFinite(w.margin) ? w.margin : 10;
  const nx = node.size[0];
  const ny = y + margin + ROW_H * 0.5;
  const pos = out.pos;
  // Diff-gated: output.pos is serialized, and rewriting an identical value
  // still counts as a change on some builds (Vue Compat #18).
  if (!pos || pos[0] !== nx || Math.abs(pos[1] - ny) > 0.5) out.pos = [nx, ny];
}

function isAligned(rowEl, dot) {
  const rr = rowEl.getBoundingClientRect();
  const dd = dot.getBoundingClientRect();
  return Math.abs((rr.top + rr.height / 2) - (dd.top + dd.height / 2)) < 1;
}

/**
 * NODES 2.0: the nudge. Pull the slots block out of the flow so it stops
 * pushing the row down, then translate the dot onto the row.
 *
 * ORDER MATTERS: sizing the slot changes the block's height, so the block must
 * be measured AFTER. Measuring first pulls up by one slot-row too little and
 * the dot sits mysteriously high - a bug Control Panel chased for rounds.
 */
export function alignOutput(node) {
  if (!isVueNodes()) return;
  try {
    const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    if (!el) return;
    const rowEl = el.querySelector(`.${ROW_CLASS}`);
    const outs = el.querySelectorAll(".lg-slot--output");
    if (!rowEl || !outs.length) return;
    if (isAligned(rowEl, outs[0])) return;

    const col = outs[0].parentElement;
    const block = col?.parentElement;
    if (!col || !block) return;

    // Reset first: every measurement below must be taken against the natural
    // layout, not against a previous nudge, or the correction compounds.
    block.style.marginBottom = "0px";
    col.style.transform = "none";
    col.style.gap = "0px";
    block.style.pointerEvents = "none";
    col.style.pointerEvents = "auto";

    // The styles we write are LAYOUT px; getBoundingClientRect returns SCREEN px
    // because the node is CSS-scaled by the graph zoom. Measure the ratio off an
    // element whose layout height we already know rather than trusting ds.scale -
    // correct at any zoom, however the zoom happens to be applied.
    const rowH = rowEl.offsetHeight || ROW_H;
    const toLayout = rowH / (rowEl.getBoundingClientRect().height || rowH);

    // STEP ONE: size the dot's slot to one row. Changes the block's height.
    for (const o of outs) {
      o.style.height = rowH + "px";
      o.style.minHeight = rowH + "px";
      o.style.marginBottom = "0px";
    }
    // STEP TWO: take the now-correctly-sized block out of the flow.
    block.style.marginBottom = (-block.offsetHeight) + "px";
    // STEP THREE: drop the dot onto the row.
    const delta =
      (rowEl.getBoundingClientRect().top - outs[0].getBoundingClientRect().top) * toLayout;
    col.style.transform = `translateY(${delta}px)`;
  } catch {
    /* nudge failed - the dot stays in the corner and the node still works */
  }
}

/**
 * The row is not laid out yet on the frame the node is built, so measuring
 * straight away yields a stale offset that nothing would ever correct.
 */
export function scheduleAlign(node) {
  alignOutput(node);
  requestAnimationFrame(() => {
    alignOutput(node);
    setTimeout(() => alignOutput(node), 120);
  });
}

/**
 * A MutationObserver is not enough: Vue REPLACES the node element when it
 * re-renders, silently orphaning any observer bound to the old one. Hence a
 * self-healing poll, like the pack's other canvas features. alignOutput
 * early-returns when nothing has moved, so the steady-state cost is one rect
 * read every 350ms.
 */
export function watchAlign(node) {
  if (node._pixDdPoll) return;
  // Deliberately NOT gated on isVueNodes(). The renderer can be switched while
  // the node already exists, and that switch does not re-run onNodeCreated or
  // onConfigure - so a node built in Classic and then switched to Nodes 2.0 was
  // left with no aligner at all and its dot stayed in the corner forever
  // (observed, not theorised). alignOutput early-returns in Classic, so the
  // steady-state cost of running the poll either way is one boolean check.
  node._pixDdPoll = setInterval(() => {
    if (!node.graph) { unwatchAlign(node); return; }
    alignOutput(node);
  }, 350);
  scheduleAlign(node);
}

export function unwatchAlign(node) {
  if (node._pixDdPoll) clearInterval(node._pixDdPoll);
  node._pixDdPoll = null;
}
