// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the floating frame                       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Not a node and not a DOM widget, so none of the Nodes 2.0 widget rules apply
// and it renders identically in both renderers.
//
// Like the Help window it STAYS OPEN across workflow switches, so anything it
// shows that depends on the open graph must be re-read on render rather than
// cached. And it writes NOTHING that gets serialized into a workflow, so
// opening it can never make a clean workflow ask "Save Changes?".
//
// The drag and rect behaviour is shared with the Help window
// (js/shared/floating_window.mjs) - do not hand-roll a second copy, the pointer
// capture and the buttons-are-up guard in there are what stop a panel sticking
// to the cursor when a mouse release goes missing.

import { globalAccent, BRAND } from "../shared/index.mjs";
import { el, makeRect, startDrag } from "../shared/floating_window.mjs";
import { injectWorkflowCSS } from "./css.mjs";

const RECT_SETTING = "Pixaroma.Workflows.Rect";

const MIN_W = 560;   // below this the three columns stop being three columns
const MIN_H = 340;
const PREF_W = 1040;
const PREF_H = 720;
const EDGE = 24;
const HOME_X = 80;
const HOME_Y = 60;

const SIDE_DEF = 190;
const SIDE_MIN = 120;
const SIDE_MAX_FRAC = 0.45;

const RECT = makeRect({
  settingKey: RECT_SETTING,
  minW: MIN_W, minH: MIN_H, prefW: PREF_W, prefH: PREF_H,
  edge: EDGE, homeX: HOME_X, homeY: HOME_Y,
  sideDef: SIDE_DEF, sideMin: SIDE_MIN, sideMaxFrac: SIDE_MAX_FRAC,
});
const { clampRect, readRect, saveRect, sideMax, floorY } = RECT;

export { el };

export function createWorkflowWindow({ onRender, onClose }) {
  injectWorkflowCSS();

  const win = el("div", "pixwb-win");
  win.style.display = "none";

  // ── title ──
  const title = el("div", "pixwb-title");
  const name = el("div", "pixwb-name");
  const count = el("span", "pixwb-count", "");
  name.append(el("span", "pixwb-logo"), el("span", null, "Workflows"), count);
  const closeBtn = el("button", "pixwb-wbtn", "✕");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  title.append(name, el("div", "pixwb-sp"), closeBtn);

  // ── toolbar, folder column, grid, detail: filled by index.js ──
  const bar = el("div", "pixwb-bar");
  const body = el("div", "pixwb-body");
  const side = el("div", "pixwb-side");
  const sideGrip = el("div", "pixwb-sidegrip");
  sideGrip.title = "Drag to resize the list. Double-click to reset.";
  const main = el("div", "pixwb-main");
  const detail = el("div", "pixwb-detail");
  body.append(side, sideGrip, main, detail);

  const foot = el("div", "pixwb-foot");
  const grip = el("div", "pixwb-grip");
  win.append(title, bar, body, foot, grip);
  document.body.appendChild(win);

  let rect = readRect();
  const applyRect = () => {
    win.style.left = rect.x + "px";
    win.style.top = rect.y + "px";
    win.style.width = rect.w + "px";
    win.style.height = rect.h + "px";
    rect.sw = Math.max(SIDE_MIN, Math.min(rect.sw ?? SIDE_DEF, sideMax(rect.w)));
    side.style.width = rect.sw + "px";
    // The detail pane is the first thing to go on a narrow window: three
    // columns in 560px leaves the grid too thin to show anything.
    detail.classList.toggle("hidden", rect.w < 760);
  };
  applyRect();

  const onDragEnd = () => {
    title.classList.remove("pixwb-dragging");
    saveRect(rect);
  };

  title.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pixwb-wbtn")) return;
    const ox = e.clientX - win.offsetLeft;
    const oy = e.clientY - win.offsetTop;
    if (!startDrag(title, e, (ev) => {
      rect.x = Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - Math.min(rect.w, 160)));
      rect.y = Math.max(floorY(), Math.min(ev.clientY - oy, window.innerHeight - 40));
      applyRect();
    }, onDragEnd)) return;
    title.classList.add("pixwb-dragging");
  });

  grip.addEventListener("pointerdown", (e) => {
    const left = win.offsetLeft, top = win.offsetTop;
    // Where inside the grip the pointer landed, or the corner jumps under the
    // cursor the moment it is grabbed and the window looks like it twitched.
    const ox = e.clientX - (left + win.offsetWidth);
    const oy = e.clientY - (top + win.offsetHeight);
    startDrag(grip, e, (ev) => {
      rect.w = Math.max(MIN_W, Math.min(ev.clientX - ox - left, window.innerWidth - left));
      rect.h = Math.max(MIN_H, Math.min(ev.clientY - oy - top, window.innerHeight - top));
      applyRect();
      onRender?.({ resizeOnly: true });
    }, onDragEnd);
    e.stopPropagation();
  });

  sideGrip.addEventListener("pointerdown", (e) => {
    const bodyLeft = body.getBoundingClientRect().left;
    startDrag(sideGrip, e, (ev) => {
      rect.sw = Math.round(Math.max(SIDE_MIN, Math.min(ev.clientX - bodyLeft, sideMax(rect.w))));
      side.style.width = rect.sw + "px";
    }, onDragEnd);
    sideGrip.classList.add("pixwb-dragging");
    e.stopPropagation();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) =>
    sideGrip.addEventListener(t, () => sideGrip.classList.remove("pixwb-dragging")));
  sideGrip.addEventListener("dblclick", () => {
    rect.sw = SIDE_DEF;
    applyRect();
    saveRect(rect);
  });

  window.addEventListener("resize", () => {
    if (win.style.display === "none") return;
    rect = clampRect(rect);
    applyRect();
  });

  // Clicks inside must not reach the canvas, or browsing would deselect
  // whatever was selected before the panel was opened.
  win.addEventListener("pointerdown", (e) => e.stopPropagation());

  // ── toast ──
  let toastEl = null, toastTimer = null;
  function toast(message) {
    if (!toastEl) {
      toastEl = el("div", "pixwb-toast");
      body.appendChild(toastEl);          // inside the body, so it can never
    }                                     // land on top of the footer at any
    toastEl.textContent = message;        // footer height (help pattern #19)
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.display = "none"; }, 2600);
  }

  const api = {
    el: win, bar, side, main, detail, foot, title, count,
    isOpen: () => win.style.display !== "none",
    toast,
    setCount: (text) => { count.textContent = text; },
    isDetailVisible: () => !detail.classList.contains("hidden"),
    open() {
      // Re-read the accent each open, so the panel follows a colour changed
      // while it was shut.
      win.style.setProperty("--pix-acc", globalAccent() || BRAND);
      rect = clampRect(rect);
      applyRect();
      win.style.display = "flex";
      onRender?.();
      setTimeout(() => bar.querySelector("input")?.focus(), 20);
    },
    close() {
      win.style.display = "none";
      const q = bar.querySelector("input");
      if (q) q.value = "";
      if (toastEl) toastEl.style.display = "none";
      onClose?.();
    },
    toggle() { api.isOpen() ? api.close() : api.open(); },
    destroy() { win.remove(); },
  };

  // Esc closes, but only when focus is inside, or this would swallow Escape for
  // the whole app.
  win.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const q = bar.querySelector("input");
      // Escape clears a search first: losing a typed query AND the window in
      // one keystroke is the wrong amount of undo for one key.
      if (q && q.value && document.activeElement === q) {
        q.value = "";
        q.dispatchEvent(new Event("input", { bubbles: true }));
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      api.close();
    }
  });

  closeBtn.addEventListener("click", () => api.close());
  return api;
}
