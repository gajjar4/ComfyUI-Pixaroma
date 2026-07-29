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

// The size it opens at on a screen with room for it. Most people are on a big
// monitor, and at this size two columns of cards and a full article both read
// comfortably without anyone having to resize it first. On a smaller screen it
// shrinks to fit rather than hanging off the edge (see defaultRect).
const PREF_W = 980;
const PREF_H = 756;
// Breathing room kept between the window and the edge of the browser, so the
// canvas is still visible around it and the corner grip is never flush.
const EDGE = 24;
// Where it opens from, when there is room. Top left rather than centred: this
// is a panel you read while you work on the canvas to the right of it.
const HOME_X = 60;
const HOME_Y = 70;

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// The size to open at when nothing has been saved yet: the roomy size on a big
// screen, shrunk to whatever actually fits on a small one, and never below the
// minimum. Read fresh each time rather than baked in as a constant, because the
// same person may open ComfyUI on a laptop tomorrow.
function defaultRect() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(PREF_W, vw - EDGE * 2));
  const h = Math.max(MIN_H, Math.min(PREF_H, vh - EDGE * 2));
  return {
    x: Math.max(EDGE, Math.min(HOME_X, vw - w - EDGE)),
    y: Math.max(EDGE, Math.min(HOME_Y, vh - h - EDGE)),
    w, h,
  };
}

// Bring a saved rect back onto a screen that may be a different size than the
// one it was saved on. It SHRINKS to fit rather than only keeping a sliver of
// the title bar reachable: a window saved on a wide monitor and reopened on a
// laptop used to hang off the right edge with its resize grip out of reach.
function clampRect(r) {
  const d = defaultRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.round(Math.max(MIN_W, Math.min(r?.w ?? d.w, vw - EDGE)));
  const h = Math.round(Math.max(MIN_H, Math.min(r?.h ?? d.h, vh - EDGE)));
  return {
    x: Math.round(Math.max(0, Math.min(r?.x ?? d.x, vw - w))),
    y: Math.round(Math.max(0, Math.min(r?.y ?? d.y, vh - h))),
    w, h,
  };
}

function readRect() {
  const raw = nodeSetting(RECT_SETTING, null);
  if (raw && typeof raw === "object") return clampRect(raw);
  if (typeof raw === "string") {
    try { return clampRect(JSON.parse(raw)); } catch { /* fall through to the default */ }
  }
  return defaultRect();
}

// Debounced so a drag does not write a setting on every pointermove.
let saveTimer = null;
function saveRect(rect) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { setNodeSetting(RECT_SETTING, rect); } catch { /* never break the UI over a saved rect */ }
  }, 350);
}

export function createHelpWindow({ onRender, onClose }) {
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

  // ── footer bar (filled by index.js) ──
  // Part of the FRAME, not of the home screen, so the version and the places to
  // ask are visible on every page. It used to live at the bottom of the home
  // screen only, which meant a page telling someone to include their version
  // had to send them to another screen to find it.
  const foot = el("div", "pixhb-foot");

  const grip = el("div", "pixhb-grip");
  win.append(title, bar, body, foot, grip);
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
    // Where inside the grip the pointer actually landed. Without this the
    // corner jumps to sit exactly under the cursor the moment you grab it,
    // which reads as the window twitching. The title drag already does this.
    const ox = e.clientX - (left + win.offsetWidth);
    const oy = e.clientY - (top + win.offsetHeight);
    startDrag(grip, e, (ev) => {
      rect.w = Math.max(MIN_W, Math.min(ev.clientX - ox - left, window.innerWidth - left));
      rect.h = Math.max(MIN_H, Math.min(ev.clientY - oy - top, window.innerHeight - top));
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
    el: win, bar, side, main, title, foot,
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
    close() {
      win.style.display = "none";
      // Clear the search box, or reopening shows a leftover query above an
      // unrelated article and the next keystroke jumps back to old results.
      const q = bar.querySelector("input");
      if (q) q.value = "";
      onClose?.();
    },
    toggle() { api.isOpen() ? api.close() : api.open(); },
    destroy() { win.remove(); },
  };

  closeBtn.addEventListener("click", () => api.close());
  return api;
}
