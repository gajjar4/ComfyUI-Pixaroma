// ╔═══════════════════════════════════════════════════════════════╗
// ║  Shared floating-panel plumbing (Help window, Workflows)       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// The parts of a floating Pixaroma panel that were EARNED rather than designed,
// pulled out of js/help_browser/window.mjs so a second panel cannot get them
// subtly wrong. Only behaviour lives here. Every panel keeps its own DOM, its
// own class names and its own stylesheet.
//
// What is shared, and why each one matters:
//
//   startDrag  - pointer capture AND the buttons-are-up guard. Listening for
//                pointermove/pointerup on `window` is not enough: with a real
//                mouse the release can go missing (the pointer leaves the
//                viewport, another element takes capture, a handler upstream
//                stops the event) and the panel then follows the cursor forever
//                and can never be put down. Synthetic events do NOT reproduce
//                this, which is why it survived a first round of testing.
//
//   makeRect   - a saved size and position brought back onto a screen that may
//                be a different one. It SHRINKS to fit rather than only keeping
//                a sliver of title bar reachable: a window sized on a wide
//                monitor and reopened on a laptop used to hang off the right
//                edge with its resize grip out of reach.
//
// Rects live in UNREGISTERED settings (Vue Compat #20: unregistered ids persist
// and add no rows to the Settings panel), and nothing here ever writes anything
// that gets serialized into a workflow, so opening a panel can never make a
// clean workflow ask "Save Changes?" (Vue Compat #18).

import { nodeSetting, setNodeSetting } from "./node_settings.mjs";

/** Tiny DOM helper. Shared only because every panel wants exactly this one. */
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * Start a pointer drag on `handle`.
 *
 * Both defences, always:
 *   1. setPointerCapture, so every event for this pointer goes to THIS element
 *      until we let go, even outside the window.
 *   2. the buttons-are-up guard js/align/index.js already relies on: a move
 *      arriving with no button held means the release was missed, so end the
 *      drag there and then.
 *
 * `end` is idempotent, because the guard can call it as well as a real release.
 *
 * @returns true when the drag actually started (left button, not a button click)
 */
export function startDrag(handle, e, onMove, onEnd) {
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
    onEnd?.();
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

/**
 * Size/position/sidebar-width persistence for one panel.
 *
 * `settingKey` must be unique per panel. Everything else has a sensible default
 * so a caller only states what it actually cares about.
 */
export function makeRect({
  settingKey,
  minW = 420, minH = 280,
  prefW = 980, prefH = 756,
  edge = 24, homeX = 60, homeY = 70,
  sideDef = 204, sideMin = 130, sideMaxFrac = 0.55,
  saveDelay = 350,
} = {}) {
  const sideMax = (winW) => Math.max(sideMin, Math.round(winW * sideMaxFrac));

  // Computed from the viewport on every open rather than baked in, because the
  // same person may open ComfyUI on a laptop tomorrow.
  function defaultRect() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(minW, Math.min(prefW, vw - edge * 2));
    const h = Math.max(minH, Math.min(prefH, vh - edge * 2));
    return {
      x: Math.max(edge, Math.min(homeX, vw - w - edge)),
      y: Math.max(edge, Math.min(homeY, vh - h - edge)),
      w, h, sw: sideDef,
    };
  }

  function clampRect(r) {
    const d = defaultRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.round(Math.max(minW, Math.min(r?.w ?? d.w, vw - edge)));
    const h = Math.round(Math.max(minH, Math.min(r?.h ?? d.h, vh - edge)));
    // Re-clamped against the CURRENT width, so a sidebar widened on a big
    // window cannot swallow the article after the window shrinks.
    const sw = Math.round(Math.max(sideMin, Math.min(r?.sw ?? d.sw, sideMax(w))));
    return {
      x: Math.round(Math.max(0, Math.min(r?.x ?? d.x, vw - w))),
      y: Math.round(Math.max(0, Math.min(r?.y ?? d.y, vh - h))),
      w, h, sw,
    };
  }

  function readRect() {
    const raw = nodeSetting(settingKey, null);
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
      try { setNodeSetting(settingKey, rect); } catch { /* never break the UI over a saved rect */ }
    }, saveDelay);
  }

  return { defaultRect, clampRect, readRect, saveRect, sideMax, minW, minH };
}
