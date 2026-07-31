// Dropdown Pixaroma - the floating settings panel.
//
// Same shell as Sizes / Sliders / Run Timer: themed panel beside the node,
// draggable by its header, closes on outside click or Esc. This is where the
// list actually lives - the node face is deliberately one row.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { createAccentSection, BRAND } from "../shared/node_settings.mjs";
import {
  readState, writeState, accentOf, syncOutput, dropIncompatibleLinks,
  MODES, MODE_LETTERS, MODE_LABELS,
} from "./core.mjs";
import { TYPES, TYPE_LABELS, readable, previewText } from "./coerce.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _cpHandle = null;   // an open colour picker, so the panel can close it too

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A REAL example of valid input for the chosen type, rather than a restatement
// of the column header. It shows the point of the node in one glance: a short
// name standing in for something longer or fiddlier than you want to retype.
// Per type, because "warm light" would be nonsense above a list of step counts.
const PLACEHOLDERS = {
  text:  { name: "warm light", value: "warm golden hour light, long soft shadows" },
  int:   { name: "square",     value: "1024" },
  float: { name: "gentle",     value: "0.35" },
  bool:  { name: "detail on",  value: "true" },
};

function toast(msg, severity = "info") {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary: "Dropdown Pixaroma", detail: msg, life: 3200 });
  else console.warn("[Pixaroma.Dropdown]", msg);
}

function injectCSS() {
  if (document.getElementById("pix-ddp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-ddp-css";
  s.textContent = `
    .pix-ddp { position:fixed; z-index:10010; width:430px; max-width:94vw; background:#1a1a1a;
      border:1px solid #4a4a4a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden; }
    .pix-ddp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; color:var(--acc,${BRAND}); }
    .pix-ddp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-ddp-t .x:hover { color:#fff; }
    .pix-ddp-b { padding:12px; display:flex; flex-direction:column; gap:12px; max-height:64vh; overflow-y:auto; }

    .pix-ddp-lab { font-size:11px; color:var(--acc,${BRAND}); letter-spacing:.04em; }
    .pix-ddp-sub { font-size:11px; color:#777; line-height:1.5; }

    .pix-ddp-seg { display:flex; gap:5px; flex-wrap:wrap; }
    .pix-ddp-seg button { flex:1 1 auto; min-width:78px; text-align:center; padding:6px 8px; border-radius:5px;
      background:#1d1d1d; border:1px solid #444; color:#aaa;
      font:11px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-ddp-seg button:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-ddp-seg button.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; }

    .pix-ddp-modes { display:flex; gap:5px; }
    .pix-ddp-modes button { width:34px; text-align:center; padding:6px 0; border-radius:5px;
      background:#1d1d1d; border:1px solid #444; color:#aaa;
      font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-ddp-modes button:hover { border-color:var(--acc,#f66744); color:#ddd; }
    .pix-ddp-modes button.on { background:var(--acc,#f66744); border-color:var(--acc,#f66744); color:#fff; }

    .pix-ddp-head { display:flex; align-items:center; justify-content:space-between; }
    .pix-ddp-count { font-size:11px; color:#666; }

    .pix-ddp-cols { display:flex; gap:6px; padding:0 0 4px 22px; }
    .pix-ddp-cols .a { width:118px; flex:none; font-size:11px; color:#777; }
    .pix-ddp-cols .b { flex:1; font-size:11px; color:#777; }

    .pix-ddp-list { background:rgba(0,0,0,0.28); border-radius:6px; padding:4px;
      display:flex; flex-direction:column; gap:3px; }
    .pix-ddp-row { display:flex; align-items:flex-start; gap:6px; padding:4px;
      border-radius:5px; background:rgba(255,255,255,0.02); }
    .pix-ddp-row.sel { background:color-mix(in srgb, var(--acc,${BRAND}) 14%, transparent); }
    .pix-ddp-row.drop-above { box-shadow:inset 0 2px 0 var(--acc,${BRAND}); }
    .pix-ddp-row.drop-below { box-shadow:inset 0 -2px 0 var(--acc,${BRAND}); }
    .pix-ddp-row .grip { color:var(--acc,${BRAND}); cursor:grab; flex:none; font-size:12px;
      line-height:1; padding:6px 2px 0; opacity:.8; }
    .pix-ddp-row .grip:hover { opacity:1; }
    .pix-ddp-nm { width:118px; flex:none; box-sizing:border-box; background:#1d1d1d;
      border:1px solid #444; border-radius:4px; color:#ddd; font:11px 'Segoe UI',sans-serif;
      padding:5px 7px; outline:none; }
    .pix-ddp-nm:focus { border-color:var(--acc,${BRAND}); }
    .pix-ddp-vl { flex:1 1 auto; min-width:0; box-sizing:border-box; background:#1d1d1d;
      border:1px solid #444; border-radius:4px; color:#ddd; font:11px 'Segoe UI',sans-serif;
      padding:5px 7px; outline:none; resize:none; overflow:hidden; line-height:1.45; }
    .pix-ddp-vl:focus { border-color:var(--acc,${BRAND}); }
    .pix-ddp-vl.bad { border-color:#a8552f; }
    .pix-ddp-warn { flex:none; width:13px; text-align:center; padding-top:5px;
      color:#e0703a; font-size:11px; cursor:default; }
    .pix-ddp-warn.hide { display:none; }
    /* The + and the x sit tight against the value box: the gap that used to be
       here was dead space the value field could use. The + is a filled chip so
       it reads as the primary of the two and is not dwarfed by the x.
       BOTH are centred on the FIRST LINE of the row (height = one line of the
       value box), not on the row: the value box grows with its text, and a
       button floating in the middle of a six-line paragraph reads as belonging
       to nothing. Flex centring, not padding guesses - that is what left them
       a couple of px out from each other and from the fields. */
    .pix-ddp-ins, .pix-ddp-del { flex:none; height:27px; padding:0;
      display:flex; align-items:center; justify-content:center;
      background:none; border:none; cursor:pointer; }
    .pix-ddp-ins { width:21px; }
    .pix-ddp-ins::before { content:"+"; display:flex; align-items:center; justify-content:center;
      width:19px; height:19px; border-radius:4px;
      background:color-mix(in srgb, var(--acc,${BRAND}) 22%, transparent);
      color:var(--acc,${BRAND}); font:15px/1 'Segoe UI',sans-serif; }
    .pix-ddp-ins:hover::before { background:var(--acc,${BRAND}); color:#fff; }
    .pix-ddp-del { width:17px; color:#777; font:13px/1 'Segoe UI',sans-serif; }
    .pix-ddp-del:hover { color:#e0604a; }

    .pix-ddp-empty { padding:14px 10px; text-align:center; }
    .pix-ddp-empty p { margin:0 0 10px; color:#777; font-size:11px; font-style:italic; }
    .pix-ddp-emptybtn { background:var(--acc,${BRAND}); color:#fff; border:0; border-radius:5px;
      padding:7px 16px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-ddp-emptybtn:hover { filter:brightness(1.1); }

    .pix-ddp-f { display:flex; gap:8px; flex-wrap:wrap; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-ddp-btn { border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.65);
      border-radius:5px; padding:6px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-ddp-btn:hover { border-color:var(--acc,${BRAND}); background:var(--acc,${BRAND}); color:#fff; }
    .pix-ddp-btn.primary { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-ddp-btn.primary:hover { filter:brightness(1.1); }
    .pix-ddp-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    const e = document.querySelector(`[data-node-id="${node.id}"]`);
    if (e) return e.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds;
  const cv = c && c.canvas;
  if (!ds || !cv || !node?.pos || !node?.size) return null;
  const cr = cv.getBoundingClientRect();
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const sc = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * sc;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * sc;
  return { left, top, right: left + node.size[0] * sc, bottom: top + (node.size[1] + titleH) * sc,
           width: node.size[0] * sc, height: (node.size[1] + titleH) * sc };
}

function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = panel.offsetWidth, mh = panel.offsetHeight;
  const gap = 12, pad = 8;
  if (!rect) {
    panel.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    panel.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px";
  panel.style.top = top + "px";
}

function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".x")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) return up();
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // Without this, clicking a swatch dismisses the panel underneath the picker.
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
  closeDropdownPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    e.stopPropagation();
    closeDropdownPanel();
  }
}

export function closeDropdownPanel() {
  try { _cpHandle?.close(); } catch {}
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch {} }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeDropdownPanelFor(node) {
  if (_panelNode === node) closeDropdownPanel();
}

// Grow a value box to fit its content. An EMPTY box is pinned to one line: at a
// narrow width its wrapped placeholder otherwise balloons scrollHeight and the
// box grows tall and never shrinks back (Nodes 2.0 recipe #7).
function autoGrow(ta) {
  if (!ta.value) { ta.style.height = "27px"; return; }
  ta.style.height = "auto";
  ta.style.height = Math.min(160, Math.max(27, ta.scrollHeight)) + "px";
}

export function openDropdownPanel(node, onChange) {
  closeDropdownPanel();
  injectCSS();
  _onChange = onChange || null;
  _panelNode = node;

  const panel = el("div", "pix-ddp");
  panel.style.setProperty("--acc", accentOf(node));

  const title = el("div", "pix-ddp-t");
  title.append(el("span", null, "⚙"), el("span", null, "Dropdown settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeDropdownPanel);
  title.appendChild(x);

  const body = el("div", "pix-ddp-b");
  const foot = el("div", "pix-ddp-f");

  const fire = () => { _onChange?.(node); };

  // ── What comes out ──────────────────────────────────────────────────────
  const typeSec = el("div");
  typeSec.append(el("div", "pix-ddp-lab", "WHAT COMES OUT"));
  const seg = el("div", "pix-ddp-seg");
  typeSec.appendChild(seg);
  const typeHint = el("div", "pix-ddp-sub");
  typeSec.appendChild(typeHint);

  // ── The list ────────────────────────────────────────────────────────────
  // ── What happens on each run ─────────────────────────────────────────────
  const runSec = el("div");
  runSec.append(el("div", "pix-ddp-lab", "EACH TIME YOU RUN"));
  const modeRow = el("div", "pix-ddp-modes");
  runSec.appendChild(modeRow);
  const modeHint = el("div", "pix-ddp-sub");
  runSec.appendChild(modeHint);

  const listSec = el("div");
  const head = el("div", "pix-ddp-head");
  head.append(el("span", "pix-ddp-lab", "THE LIST"));
  const count = el("span", "pix-ddp-count");
  head.appendChild(count);
  listSec.appendChild(head);
  const cols = el("div", "pix-ddp-cols");
  const ca = el("span", "a", "Name in the list");
  const cb = el("span", "b", "What it sends out");
  cols.append(ca, cb);
  listSec.appendChild(cols);
  const list = el("div", "pix-ddp-list");
  listSec.appendChild(list);

  body.append(typeSec, runSec, listSec);

  // The accent section is the shared one, so this node's colour behaves exactly
  // like every other Pixaroma node's.
  body.appendChild(createAccentSection(node, {
    label: "Node colour",
    hint: "This node only. Save it as a default below.",
    onChange: () => { panel.style.setProperty("--acc", accentOf(node)); fire(); },
    onPickerOpen: (h) => { _cpHandle = h; },
  }));

  // ── Render ──────────────────────────────────────────────────────────────
  let dragFrom = -1;

  function renderModes() {
    const st = readState(node);
    modeRow.textContent = "";
    for (const m of MODES) {
      const b = el("button", st.mode === m ? "on" : null, MODE_LETTERS[m]);
      b.title = MODE_LABELS[m];
      b.addEventListener("click", () => {
        if (readState(node).mode === m) return;
        writeState(node, { mode: m });
        // Drop any held or spent position, so switching mode starts cleanly
        // from the entry the node is showing rather than mid-sequence.
        node._pixDdPending = null;
        node._pixDdCursor = null;
        renderModes();
        fire();
      });
      modeRow.appendChild(b);
    }
    const n = readState(node).options.length;
    modeHint.textContent = st.mode === "fixed"
      ? "Always sends the entry you picked."
      : (n < 2
        ? (st.mode === "increment" ? "Steps to the next entry each run. Add more entries for this to do anything."
                                   : "Picks any entry each run. Add more entries for this to do anything.")
        : (st.mode === "increment" ? "Steps to the next entry each run and wraps at the end."
                                   : "Picks a different entry at random each run."));
  }

  function renderTypes() {
    const st = readState(node);
    seg.textContent = "";
    for (const t of TYPES) {
      const b = el("button", st.type === t ? "on" : null, TYPE_LABELS[t]);
      b.title = `Send ${TYPE_LABELS[t].toLowerCase()} out of this node`;
      b.addEventListener("click", () => setType(t));
      seg.appendChild(b);
    }
    const st2 = readState(node);
    const bad = st2.options.filter((o) => !readable(o.value, st2.type)).length;
    typeHint.textContent = bad
      ? `${bad} of ${st2.options.length} ${bad === 1 ? "entry does" : "entries do"} not read as ${TYPE_LABELS[st2.type].toLowerCase()}. They are kept, and send the fallback until you change them.`
      : "Changing this renames the output and unplugs anything that no longer fits. Your text is always kept.";
  }

  function setType(t) {
    const st = readState(node);
    if (st.type === t) return;
    writeState(node, { type: t });
    syncOutput(node);
    const cut = dropIncompatibleLinks(node);
    const bad = readState(node).options.filter((o) => !readable(o.value, t)).length;

    // Say what happened. A silent warning mark is too quiet for something that
    // changes what the node sends, and a silently cut wire is worse.
    const bits = [];
    if (cut) bits.push(`${cut} ${cut === 1 ? "wire was" : "wires were"} unplugged`);
    if (bad) bits.push(`${bad} ${bad === 1 ? "entry does" : "entries do"} not read as ${TYPE_LABELS[t].toLowerCase()} and will send the fallback`);
    if (bits.length) toast(bits.join("; ") + ". Your text is kept.", "warn");

    renderTypes();
    renderList();
    fire();
  }

  function commit(patch) {
    writeState(node, patch);
    renderTypes();
    renderModes();
    renderList();
    fire();
  }

  // Append an entry and put the cursor in its name box, so you can just type.
  // Shared by the footer button and the empty-state one so they cannot drift.
  function addRow() {
    const cur = readState(node);
    cur.options.push({ name: "", value: "" });
    commit({ options: cur.options });
    const boxes = list.querySelectorAll(".pix-ddp-nm");
    boxes[boxes.length - 1]?.focus();
  }

  function renderList() {
    const st = readState(node);
    count.textContent = st.options.length === 1 ? "1 option" : `${st.options.length} options`;
    list.textContent = "";

    if (!st.options.length) {
      // The button belongs HERE, where the list would be and where the eye
      // already is, rather than only in the footer with a line of prose
      // pointing at it.
      const box = el("div", "pix-ddp-empty");
      box.appendChild(el("p", null, "Nothing here yet."));
      const first = el("button", "pix-ddp-emptybtn", "Add your first entry");
      first.addEventListener("click", () => addRow());
      box.appendChild(first);
      list.appendChild(box);
      return;
    }

    st.options.forEach((o, i) => {
      const row = el("div", "pix-ddp-row" + (i === st.index ? " sel" : ""));
      row.title = i === st.index ? "This is the entry the node is currently sending" : "";

      // The GRIP is the draggable element, not the row. Putting draggable on the
      // row makes e.target the row, so the guard below never matches, reorder
      // silently does nothing, AND dragging inside the value box hijacks text
      // selection instead of selecting text (UI convention #11).
      const grip = el("span", "grip", "⋮⋮");
      grip.draggable = true;
      grip.title = "Drag to reorder";

      const nm = el("input", "pix-ddp-nm");
      nm.value = o.name;
      nm.placeholder = PLACEHOLDERS[st.type].name;
      nm.title = "The short name you pick from the dropdown";

      const vl = el("textarea", "pix-ddp-vl");
      vl.value = o.value;
      vl.rows = 1;
      vl.placeholder = PLACEHOLDERS[st.type].value;
      vl.title = "The value this entry sends out. It can run to several lines.";
      if (!readable(o.value, st.type)) vl.classList.add("bad");

      const warn = el("span", "pix-ddp-warn" + (readable(o.value, st.type) ? " hide" : ""), "⚠");
      warn.title = `This does not read as ${TYPE_LABELS[st.type].toLowerCase()}. It is kept as you typed it, and sends ${JSON.stringify(previewText(o.value, st.type))} until you change it.`;

      // The glyph is drawn by the ::before chip, so the button itself is empty.
      const ins = el("button", "pix-ddp-ins");
      ins.title = "Add a row below this one";
      const del = el("button", "pix-ddp-del", "✕");
      del.title = "Delete this row";

      row.append(grip, nm, vl, warn, ins, del);
      list.appendChild(row);
      autoGrow(vl);

      // Live edits write straight through; re-rendering on every keystroke would
      // destroy the field being typed in.
      nm.addEventListener("input", () => {
        const cur = readState(node);
        if (!cur.options[i]) return;
        cur.options[i].name = nm.value;
        writeState(node, { options: cur.options });
        fire();
      });
      vl.addEventListener("input", () => {
        const cur = readState(node);
        if (!cur.options[i]) return;
        cur.options[i].value = vl.value;
        writeState(node, { options: cur.options });
        autoGrow(vl);
        const ok = readable(vl.value, readState(node).type);
        vl.classList.toggle("bad", !ok);
        warn.classList.toggle("hide", ok);
        renderTypes();
        fire();
      });

      // Clicking a row selects it, so the panel doubles as the picker.
      row.addEventListener("pointerdown", (e) => {
        if (e.target.closest("input, textarea, button, .grip")) return;
        commit({ index: i });
      });

      ins.addEventListener("click", () => {
        const cur = readState(node);
        cur.options.splice(i + 1, 0, { name: "", value: "" });
        // Keep the selection on the SAME option: an insert above it shifts it.
        commit({ options: cur.options, index: cur.index > i ? cur.index + 1 : cur.index });
      });

      del.addEventListener("click", () => {
        const cur = readState(node);
        cur.options.splice(i, 1);
        // Deleting the selected row moves the selection to whatever took its
        // place (or the last row). Getting this wrong makes the node silently
        // send a different value than the name on its face.
        let idx = cur.index;
        if (i < idx) idx -= 1;
        else if (i === idx) idx = Math.min(i, cur.options.length - 1);
        commit({ options: cur.options, index: Math.max(0, idx) });
      });

      grip.addEventListener("dragstart", (e) => {
        dragFrom = i;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(i)); } catch {}
      });
      // ALWAYS clear the drag, however it ended. `drop` alone is not enough: a
      // drag released in the gap between rows, on the list padding, or outside
      // the panel never fires it, leaving dragFrom pointing at a row. The next
      // thing dropped on a row - a file, a text selection, anything at all,
      // since dragover/drop sit on the ROW and fire for any drag - would then
      // reorder the list as if that stale grip drag had been completed.
      // dragend fires AFTER drop, so a real reorder still gets its value first.
      grip.addEventListener("dragend", () => {
        dragFrom = -1;
        for (const el2 of list.querySelectorAll(".drop-above, .drop-below")) {
          el2.classList.remove("drop-above", "drop-below");
        }
      });
      row.addEventListener("dragover", (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const below = e.clientY > r.top + r.height / 2;
        row.classList.toggle("drop-below", below);
        row.classList.toggle("drop-above", !below);
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drop-above", "drop-below");
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drop-above", "drop-below");
        if (dragFrom < 0 || dragFrom === i) { dragFrom = -1; return; }
        const r = row.getBoundingClientRect();
        let to = e.clientY > r.top + r.height / 2 ? i + 1 : i;
        const cur = readState(node);
        const moved = cur.options[dragFrom];
        // Track the SELECTED option by identity across the move, so reordering
        // never changes what the node is sending.
        const selected = cur.options[cur.index];
        cur.options.splice(dragFrom, 1);
        if (dragFrom < to) to -= 1;
        cur.options.splice(to, 0, moved);
        dragFrom = -1;
        commit({ options: cur.options, index: Math.max(0, cur.options.indexOf(selected)) });
      });
    });
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  // NO "Add option" in the footer. Adding lives where the list is: the + on a
  // row inserts below it, and an empty list carries its own button. A third
  // route to the same action, parked away from the thing it acts on, was just
  // noise.

  const bExp = el("button", "pix-ddp-btn", "Export");
  bExp.title = "Save this list to a file you can load into another workflow";
  bExp.addEventListener("click", () => {
    const st = readState(node);
    const blob = new Blob([JSON.stringify(
      { pixaroma: "dropdown", version: 1, type: st.type, options: st.options }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dropdown-list.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  const bImp = el("button", "pix-ddp-btn", "Import");
  bImp.title = "Load a list from a file. It replaces what is here.";
  bImp.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const opts = Array.isArray(data?.options) ? data.options : null;
        if (!opts) { toast("That file does not hold a Dropdown list.", "error"); return; }
        const clean = opts
          .filter((o) => o && typeof o === "object" && !Array.isArray(o))
          .map((o) => ({
            name: typeof o.name === "string" ? o.name : "",
            value: typeof o.value === "string" ? o.value : (o.value == null ? "" : String(o.value)),
          }));
        if (!clean.length) { toast("That file has no entries in it.", "error"); return; }

        // An exported file always carries the type it was exported WITH, so an
        // Import can change this node's type - and therefore its output socket -
        // exactly as the type chips do. It has to cut the wires that no longer
        // fit for the same reason, or the node keeps a connection its socket no
        // longer supports and the mismatch only surfaces at run time, far from
        // the Import that caused it.
        const wasType = readState(node).type;
        commit({ options: clean, index: 0, type: data.type || wasType });
        syncOutput(node);
        const nowType = readState(node).type;
        // ONLY when the type actually changed. Cutting wires is destructive, and
        // importing a list of the same type must never touch a connection.
        const cut = nowType !== wasType ? dropIncompatibleLinks(node) : 0;

        const bits = [`Loaded ${clean.length} ${clean.length === 1 ? "entry" : "entries"}`];
        if (nowType !== wasType) bits.push(`and switched this node to ${TYPE_LABELS[nowType].toLowerCase()}`);
        if (cut) bits.push(`- ${cut} ${cut === 1 ? "wire that no longer fits was" : "wires that no longer fit were"} unplugged`);
        toast(bits.join(" ") + ".", cut ? "warn" : "info");
      } catch {
        toast("That file could not be read.", "error");
      }
    });
    inp.click();
  });

  const bDone = el("button", "pix-ddp-btn pix-ddp-push", "Done");
  bDone.addEventListener("click", closeDropdownPanel);

  foot.append(bExp, bImp, bDone);

  panel.append(title, body, foot);
  document.body.appendChild(panel);
  // MUST be recorded, and this was missed once. Without it, _panel stays null,
  // so closeDropdownPanel() removes nothing, outsideClose and escClose both
  // early-return, and every open stacks another panel on the page: after four
  // opens there were four live panels, each with handlers bound to its own
  // stale row indices, so a click could delete a row in a panel nobody could
  // see. A single open looked perfectly fine, which is why only opening it
  // TWICE finds this.
  _panel = panel;
  renderTypes();
  renderModes();
  renderList();
  placeBeside(panel, getNodeScreenRect(node));
  makeDraggable(panel, title);

  // Deferred, or the click that opened the panel immediately closes it.
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);

  return panel;
}
