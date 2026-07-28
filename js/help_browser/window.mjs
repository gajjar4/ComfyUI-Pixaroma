// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the floating window frame            ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// A draggable, resizable panel appended to document.body. It is NOT a node and
// NOT a DOM widget, so none of the Nodes 2.0 widget rules apply to it, and it
// renders identically in both renderers.
//
// Two deliberate behaviours, both different from js/shared/help.mjs's popup:
//
//   1. It STAYS OPEN across workflow switches. The small per-node popup closes
//      on loadGraphData because it belongs to one node; this window belongs to
//      the app. Anything it shows that depends on the open graph must therefore
//      be re-read on render, never cached across a switch.
//   2. It writes NOTHING that gets serialized into a workflow - no node.size,
//      no properties, no slots - so opening and closing it can never make a
//      clean workflow ask "Save Changes?" (Vue Compat #18).
//
// Position and size live in UNREGISTERED settings (Vue Compat #20: unregistered
// ids persist fine and add no rows to the Settings panel).

import { app } from "/scripts/app.js";
import { nodeSetting, setNodeSetting, globalAccent, BRAND, PIXAROMA_LOGO } from "../shared/index.mjs";
import { injectHelpBrowserCSS } from "./css.mjs";

const RECT_SETTING = "Pixaroma.Help.Rect";
const QUESTION_ICON = "/pixaroma/assets/icons/note/question-mark.svg";

const MIN_W = 420;
const MIN_H = 280;
const DEF_W = 720;
const DEF_H = 580;

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Clamp a rect so the title bar can always be grabbed, however the window was
// resized or the browser moved since the rect was saved.
function clampRect(r) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(r.w ?? DEF_W, vw));
  const h = Math.max(MIN_H, Math.min(r.h ?? DEF_H, vh));
  const x = Math.max(0, Math.min(r.x ?? 90, vw - Math.min(w, 160)));
  const y = Math.max(0, Math.min(r.y ?? 90, vh - 40));
  return { x, y, w, h };
}

function readRect() {
  const raw = nodeSetting(RECT_SETTING, null);
  if (raw && typeof raw === "object") return clampRect(raw);
  if (typeof raw === "string") {
    try { return clampRect(JSON.parse(raw)); } catch { /* fall through */ }
  }
  return clampRect({ x: 90, y: 90, w: DEF_W, h: DEF_H });
}

// Debounced so a drag does not write a setting on every pointermove.
let saveTimer = null;
function saveRect(rect) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { setNodeSetting(RECT_SETTING, rect); } catch { /* never break the UI over a saved rect */ }
  }, 350);
}

export function createHelpWindow({ onRender }) {
  injectHelpBrowserCSS();

  const win = el("div", "pixhb-win");
  win.style.display = "none";

  // ── title bar ──
  const title = el("div", "pixhb-title");
  // The Pixaroma logo mark rather than the crown emoji: this is an app panel,
  // not a node, so it should carry the brand rather than the node-menu icon.
  // Drawn as a mask so it takes the accent colour instead of being locked to
  // orange while everything around it recolours.
  const name = el("div", "pixhb-name");
  name.append(el("span", "pixhb-logo"), el("span", null, "Pixaroma Help"));
  const sp = el("div", "pixhb-sp");
  const closeBtn = el("button", "pixhb-wbtn", "✕");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  title.append(name, sp, closeBtn);

  // ── toolbar row (filled by content.mjs) ──
  const bar = el("div", "pixhb-bar");

  // ── body ──
  const body = el("div", "pixhb-body");
  const side = el("div", "pixhb-side");
  const main = el("div", "pixhb-main");
  body.append(side, main);

  const grip = el("div", "pixhb-grip");
  win.append(title, bar, body, grip);
  document.body.appendChild(win);

  let rect = readRect();
  const applyRect = () => {
    win.style.left = rect.x + "px";
    win.style.top = rect.y + "px";
    win.style.width = rect.w + "px";
    win.style.height = rect.h + "px";
  };
  applyRect();

  // ── dragging, for both the title bar and the resize grip ──
  //
  // Listening for pointermove/pointerup on `window` is NOT reliable here: with
  // a real mouse the release can go missing (the pointer leaves the viewport,
  // another element takes pointer capture, or a handler upstream stops the
  // event), and then the panel keeps following the cursor forever - it "sticks"
  // and can never be put down.
  //
  // Two defences, and we want both:
  //   1. setPointerCapture on the handle, so every event for this pointer is
  //      delivered to THAT element until we release it, even off-window.
  //   2. the buttons-are-up guard that js/align/index.js already relies on:
  //      if a move arrives with no button held, the release was missed, so end
  //      the drag there and then.
  function startDrag(handle, e, onMove) {
    if (e.button !== 0) return false;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      try { handle.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      title.classList.remove("pixhb-dragging");
      saveRect(rect);
    };
    const move = (ev) => {
      if (!(ev.buttons & 1)) { end(); return; }   // the release went missing
      onMove(ev);
    };
    try { handle.setPointerCapture(e.pointerId); } catch { /* older build: the guard still covers us */ }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    e.preventDefault();
    return true;
  }

  title.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pixhb-wbtn")) return;
    const ox = e.clientX - win.offsetLeft;
    const oy = e.clientY - win.offsetTop;
    if (!startDrag(title, e, (ev) => {
      rect.x = Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - Math.min(rect.w, 160)));
      rect.y = Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 40));
      applyRect();
    })) return;
    title.classList.add("pixhb-dragging");
  });

  grip.addEventListener("pointerdown", (e) => {
    const left = win.offsetLeft, top = win.offsetTop;
    startDrag(grip, e, (ev) => {
      rect.w = Math.max(MIN_W, Math.min(ev.clientX - left, window.innerWidth - left));
      rect.h = Math.max(MIN_H, Math.min(ev.clientY - top, window.innerHeight - top));
      applyRect();
    });
    e.stopPropagation();
  });

  // Keep the window reachable if the browser window shrinks under it.
  window.addEventListener("resize", () => {
    if (win.style.display === "none") return;
    rect = clampRect(rect);
    applyRect();
  });

  // Esc closes, but only when the focus is inside the window - otherwise this
  // would swallow Escape for the whole app.
  win.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); api.close(); }
  });

  // Clicks inside must not reach the canvas underneath (they would deselect the
  // very node the user is about to wire to).
  win.addEventListener("pointerdown", (e) => e.stopPropagation());

  const api = {
    el: win, bar, side, main, title,
    isOpen: () => win.style.display !== "none",
    open() {
      // Re-read the accent every open so the window follows a colour the user
      // changed while it was shut.
      win.style.setProperty("--pix-acc", globalAccent() || BRAND);
      rect = clampRect(rect);
      applyRect();
      win.style.display = "flex";
      onRender?.();
      // Focus something inside so Esc and typing land here, not on the canvas.
      setTimeout(() => bar.querySelector("input")?.focus(), 20);
    },
    close() { win.style.display = "none"; },
    toggle() { api.isOpen() ? api.close() : api.open(); },
    destroy() { win.remove(); },
  };

  closeBtn.addEventListener("click", () => api.close());
  return api;
}
