// Info Pixaroma - the reading window.
//
// A floating window over the canvas showing one Info node's note: wide, larger
// text, scrolls, drags by its title bar, Esc or the X closes it. It does not
// block the canvas (you can read while you work), and one window serves every
// Info button: clicking another button swaps the note in.
//
// The note is drawn by Note Pixaroma's own renderContent + stylesheet, so a
// download button, an icon or a table looks exactly as the editor made it.

import { injectCSS as injectNoteCSS } from "../note/css.mjs";
import { renderContent } from "../note/render.mjs";
import { ensureIcons, injectIconCSS } from "../note/icons.mjs";
import { isLiveNode } from "../shared/live_node.mjs";
import { readCfg, writeCfg, findWidget, iconUrl, inkFor, READER_MIN } from "./core.mjs";

const CSS = [
  ".pix-info-reader{position:fixed;z-index:1400;display:flex;flex-direction:column;width:min(860px, calc(100vw - 32px));",
  "max-height:calc(100vh - 48px);background:#202020;border:1px solid #3d3d3d;border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.7);",
  "overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;color:#e6e6e6;}",
  ".pix-info-rbar{display:flex;align-items:center;gap:10px;padding:9px 10px 9px 14px;background:#2a2a2a;border-bottom:1px solid #3a3a3a;",
  "cursor:move;user-select:none;flex:none;touch-action:none;}",
  ".pix-info-rbub{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:none;}",
  ".pix-info-ric{width:19px;height:19px;display:block;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}",
  ".pix-info-rtt{font-weight:700;font-size:15px;color:#f2f2f2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".pix-info-rsp{flex:1;}",
  ".pix-info-rbtn{display:inline-flex;align-items:center;gap:6px;font:600 12px 'Segoe UI',system-ui,sans-serif;color:#ddd;cursor:pointer;",
  "border:1px solid #4a4a4a;border-radius:6px;padding:5px 11px;background:rgba(255,255,255,.04);}",
  ".pix-info-rbtn:hover{border-color:#f66744;color:#fff;}",
  ".pix-info-rbtn .pix-info-rbi{width:13px;height:13px;background:currentColor;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}",
  ".pix-info-rx{border:0;background:transparent;color:#aaa;font-size:17px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:6px;}",
  ".pix-info-rx:hover{color:#fff;background:rgba(255,255,255,.08);}",
  // Resize corner: two short diagonal strokes, the usual "drag me" mark.
  ".pix-info-rgrip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;z-index:2;",
  "background:linear-gradient(135deg,transparent 0 55%,#666 55% 61%,transparent 61% 72%,#666 72% 78%,transparent 78%);}",
  ".pix-info-rgrip:hover{background:linear-gradient(135deg,transparent 0 55%,#f66744 55% 61%,transparent 61% 72%,#f66744 72% 78%,transparent 78%);}",
  // The note itself: Note's body stylesheet, a size up for reading.
  ".pix-info-reader .pix-info-doc.pix-note-body{height:auto;flex:1 1 auto;min-height:80px;overflow-y:auto;padding:20px 32px 26px;",
  "font-size:14.5px;line-height:1.6;background:#1e1e1e;}",
  ".pix-info-reader .pix-info-doc.pix-note-body h1{font-size:22px;margin:2px 0 8px;}",
  ".pix-info-reader .pix-info-doc.pix-note-body h2{font-size:18px;margin:14px 0 6px;}",
  ".pix-info-reader .pix-info-doc.pix-note-body h3{font-size:16px;margin:14px 0 6px;}",
  ".pix-info-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:30px 10px;color:#aaa;font-size:14px;}",
  ".pix-info-empty button{font:600 13px 'Segoe UI',system-ui,sans-serif;color:#fff;background:#f66744;border:0;border-radius:6px;padding:7px 16px;cursor:pointer;}",
  ".pix-info-empty button:hover{filter:brightness(1.1);}",
].join("\n");
let _cssDone = false;
function injectReaderCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const s = document.createElement("style");
  s.setAttribute("data-pixaroma-info-reader", "1");
  s.textContent = CSS;
  document.head.appendChild(s);
}

let _win = null;       // the window element
let _node = null;      // the node it shows
let _raw = null;       // the widget string it was drawn from
let _poll = null;
// WHERE the window sits is remembered in this browser (screens differ, so it
// is a per-viewer convenience: nothing breaks if storage is blocked). HOW BIG
// it is belongs to each Info button and is saved in the workflow
// (cfg.info.reader, the user's call 2026-10-01): a short note opens small, a
// long one big, the way its author sized it.
const POS_KEY = "pixaroma.info.reader.v1";
let _pos = null;       // { left, top }
try {
  const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
  if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) _pos = { left: p.left, top: p.top };
} catch (_e) { _pos = null; }
function savePos() {
  try { localStorage.setItem(POS_KEY, JSON.stringify(_pos || {})); } catch (_e) {}
}
const MIN_W = READER_MIN.w, MIN_H = READER_MIN.h;
let _onEdit = null;
let _keyOff = null;
let _pressInside = false;

// Moves that leave the window during a press that began in it (a text
// selection dragged past the edge). Installed once; idle unless a press began
// inside the reader.
if (typeof window !== "undefined" && !window._pixInfoReaderMoveGuard) {
  window._pixInfoReaderMoveGuard = true;
  window.addEventListener("pointermove", (e) => {
    if (!_pressInside) return;
    if (!(e.buttons & 1) || !_win || !_win.isConnected) { _pressInside = false; return; }
    if (!_win.contains(e.target)) e.stopPropagation();
  }, true);
  const release = () => { _pressInside = false; };
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
}

export function setReaderEditHandler(fn) { _onEdit = fn; }
export function readerNode() { return _win && _win.isConnected ? _node : null; }

export function closeReader() {
  if (_poll) { clearInterval(_poll); _poll = null; }
  try { _keyOff?.(); } catch (_e) {}
  _keyOff = null;
  if (_win) { try { _win.remove(); } catch (_e) {} }
  _win = null; _node = null; _raw = null;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function fill(win, node) {
  const cfg = readCfg(node);
  const info = cfg.info;
  win.setAttribute("aria-label", info.title || "Info");
  win.querySelector(".pix-info-rbub").style.background = info.color;
  const ric = win.querySelector(".pix-info-ric");
  ric.style.setProperty("--i", `url("${iconUrl(info.icon)}")`);
  ric.style.background = inkFor(info.color);
  win.querySelector(".pix-info-rtt").textContent = info.title || "Info";
  const doc = win.querySelector(".pix-info-doc");
  if (!String(cfg.content || "").trim()) {
    doc.innerHTML = "";
    const box = el("div", "pix-info-empty");
    box.appendChild(el("div", null, "This note is empty."));
    const b = el("button", null, "Write it");
    b.type = "button";
    b.addEventListener("click", () => editFromReader());
    box.appendChild(b);
    doc.appendChild(box);
  } else {
    // renderContent writes node.color / node.bgcolor for Note's own canvas
    // body. Hand it a stand-in so it can never touch the real node.
    renderContent({ _noteCfg: cfg, bgcolor: "#000000" }, doc);
  }
  const bg = typeof cfg.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(cfg.backgroundColor) ? cfg.backgroundColor : "";
  doc.style.background = bg;
  _raw = findWidget(node)?.value ?? null;
}

function editFromReader() {
  const n = _node;
  closeReader();
  if (n && _onEdit) _onEdit(n, { reopenReader: true });
}

// The size this button's author gave its window, or the default (width from
// the stylesheet, height fitting the note). A saved size larger than this
// screen is clamped to it.
function applySize(win, node) {
  const r = node ? readCfg(node).info.reader : null;
  if (r) {
    win.style.width = `${Math.round(Math.max(MIN_W, Math.min(r.w, window.innerWidth - 16)))}px`;
    win.style.height = `${Math.round(Math.max(MIN_H, Math.min(r.h, window.innerHeight - 16)))}px`;
  } else {
    win.style.width = "";
    win.style.height = "";
  }
}

function place(win) {
  const w = win.offsetWidth, h = win.offsetHeight;
  let left, top;
  if (_pos) { left = _pos.left; top = _pos.top; }
  else { left = (window.innerWidth - w) / 2; top = Math.max(24, window.innerHeight * 0.08); }
  // Keep the WHOLE window on screen: each button opens at its own size, so a
  // taller note shown where a short one stood would otherwise run off the
  // bottom (measured: top 275 + 858 tall on a 906 px window). It moves up or
  // left just enough; the remembered spot itself is not changed.
  left = Math.max(8, Math.min(window.innerWidth - Math.min(w, window.innerWidth - 16) - 8, left));
  top = Math.max(8, Math.min(window.innerHeight - Math.min(h, window.innerHeight - 16) - 8, top));
  win.style.left = `${Math.round(left)}px`;
  win.style.top = `${Math.round(top)}px`;
}

// One pointer drag with BOTH defences of CLAUDE.md convention #20: pointer
// capture on the handle, and stopping as soon as the button is up (a lost
// release otherwise leaves the window stuck to the cursor).
function startDrag(handle, e, onMove, onEnd) {
  e.preventDefault();
  let ended = false;
  try { handle.setPointerCapture(e.pointerId); } catch (_e) {}
  const move = (ev) => {
    if (!(ev.buttons & 1)) { end(); return; }
    onMove(ev);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    try { handle.releasePointerCapture(e.pointerId); } catch (_e) {}
    onEnd?.();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
}

// Move by the title bar.
function wireDrag(win, bar) {
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const r = win.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    startDrag(bar, e, (ev) => {
      const left = Math.max(80 - r.width, Math.min(window.innerWidth - 80, ev.clientX - dx));
      const top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
      win.style.left = `${Math.round(left)}px`;
      win.style.top = `${Math.round(top)}px`;
      _pos = { left, top };
    }, savePos);
  });
}

// Save (or clear, with null) the window size on the button it belongs to.
// A user action, so it may flag the workflow modified - that is the point:
// the size travels with the workflow.
function saveSizeOnNode(node, size) {
  if (!node || !isLiveNode(node)) return;
  const cfg = readCfg(node);
  const info = { ...cfg.info };
  if (size) info.reader = { w: Math.round(size.w), h: Math.round(size.h) };
  else delete info.reader;
  const before = JSON.stringify(cfg.info.reader || null);
  if (JSON.stringify(info.reader || null) === before) return;
  writeCfg(node, { ...cfg, info });
  _raw = findWidget(node)?.value ?? null;   // our own write: no redraw needed
}

// Size by the bottom-right corner. Double-click it to go back to the default.
function wireResize(win, grip) {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = win.getBoundingClientRect();
    // Where in the corner the pointer landed, so the corner does not jump.
    const ox = e.clientX - r.right, oy = e.clientY - r.bottom;
    let size = null;
    const node = _node;
    startDrag(grip, e, (ev) => {
      const w = Math.max(MIN_W, Math.min(ev.clientX - ox - r.left, window.innerWidth - r.left - 8));
      const h = Math.max(MIN_H, Math.min(ev.clientY - oy - r.top, window.innerHeight - r.top - 8));
      win.style.width = `${Math.round(w)}px`;
      win.style.height = `${Math.round(h)}px`;
      size = { w, h };
    }, () => { if (size && node === _node) saveSizeOnNode(node, size); });
  });
  grip.addEventListener("dblclick", () => {
    saveSizeOnNode(_node, null);
    applySize(win, _node);
    place(win);
  });
}

export function openReader(node) {
  if (!node) return;
  injectNoteCSS();
  injectReaderCSS();
  ensureIcons().then(() => injectIconCSS()).catch(() => {});

  // Another button's note: reuse the window where it stands.
  if (_win && _win.isConnected) {
    _node = node;
    fill(_win, node);
    // Each button opens at its own size, at the spot the user chose (a taller
    // note may have been nudged up to fit; a shorter one goes back).
    if (!_pos) _pos = { left: _win.offsetLeft, top: _win.offsetTop };
    applySize(_win, node);
    place(_win);
    return;
  }
  closeReader();
  const win = el("div", "pix-info-reader");
  win.setAttribute("role", "dialog");
  const bar = el("div", "pix-info-rbar");
  const bub = el("span", "pix-info-rbub");
  bub.appendChild(el("span", "pix-info-ric"));
  bar.appendChild(bub);
  bar.appendChild(el("span", "pix-info-rtt"));
  bar.appendChild(el("span", "pix-info-rsp"));
  const edit = el("button", "pix-info-rbtn");
  edit.type = "button";
  edit.title = "Edit this note and the button";
  const ei = el("span", "pix-info-rbi");
  ei.style.setProperty("--i", `url("${iconUrl("edit")}")`);
  edit.appendChild(ei);
  edit.appendChild(document.createTextNode("Edit"));
  edit.addEventListener("click", () => editFromReader());
  bar.appendChild(edit);
  const x = el("button", "pix-info-rx", "✕");
  x.type = "button";
  x.title = "Close (Esc)";
  x.addEventListener("click", () => closeReader());
  bar.appendChild(x);
  win.appendChild(bar);
  const doc = el("div", "pix-info-doc pix-note-body");
  win.appendChild(doc);
  const grip = el("div", "pix-info-rgrip");
  grip.title = "Drag to resize. Double-click for the default size.";
  win.appendChild(grip);
  // A press inside the window (dragging it, selecting text) must not reach
  // ComfyUI. MEASURED in Nodes 2.0: dragging the title bar ALSO moved the
  // selected node underneath, 44,60 for a 50,60 drag. The mover is Pixaroma
  // Align: its window pointermove listener takes ANY left-button move as a
  // drag of the selected node (Shift, which Align ignores, left the node put).
  // So the press, and every move until the release, stays in here: moves on
  // the window stop at the window; moves that wander off it are stopped at
  // the top (window capture) so neither Align nor the canvas acts on them.
  win.addEventListener("pointerdown", (e) => { _pressInside = true; e.stopPropagation(); });
  win.addEventListener("pointermove", (e) => { if (e.buttons) e.stopPropagation(); });
  document.body.appendChild(win);
  _win = win;
  _node = node;
  fill(win, node);
  applySize(win, node);
  place(win);
  wireDrag(win, bar);
  wireResize(win, grip);

  const onKey = (e) => {
    if (e.key !== "Escape" || !_win) return;
    // Esc in a text box elsewhere belongs to that box.
    const t = e.target;
    if (t && t !== document.body && !_win.contains(t) &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    // Leave Esc to anything open on top of us (a ComfyUI dialog, a menu).
    if (document.querySelector(".p-dialog-mask, .litecontextmenu, .pix-info-start")) return;
    e.preventDefault();
    e.stopPropagation();
    closeReader();
  };
  const onResize = () => { if (_win) { applySize(_win, _node); place(_win); } };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  _keyOff = () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
  };

  // Close when the node goes (deleted, workflow switched), and follow edits
  // made elsewhere (Ctrl+Z, a starter) by re-drawing when the saved note changes.
  _poll = setInterval(() => {
    if (!_node || !isLiveNode(_node) || !_node.graph) { closeReader(); return; }
    const raw = findWidget(_node)?.value ?? null;
    if (raw !== _raw && _win) { fill(_win, _node); applySize(_win, _node); place(_win); }
  }, 400);
}
