// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the right-click menu                     ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// One menu, used by both the folder column and the workflow cards. Started life
// inside folders.mjs and moved out when the cards wanted the same thing: a
// second copy would have been a second set of the dismiss rules below to get
// subtly wrong.

import { el } from "./window.mjs";

let menuEl = null;
let cleanup = null;

export function closeContextMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
  if (cleanup) { cleanup(); cleanup = null; }
}

/**
 * @param items [{label, fn, disabled, danger}] - null entries draw a separator
 */
export function openContextMenu(x, y, items) {
  closeContextMenu();
  menuEl = el("div", "pixwb-menu");
  for (const it of items) {
    if (!it) { menuEl.append(el("div", "pixwb-menusep")); continue; }
    const b = el("button", it.danger ? "pixwb-menudanger" : null, it.label);
    b.type = "button";
    if (it.disabled) b.disabled = true;
    else b.addEventListener("click", () => { closeContextMenu(); it.fn(); });
    menuEl.append(b);
  }
  document.body.append(menuEl);

  // Keep it on screen: a menu opened near an edge must not run off it.
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.round(Math.max(6, Math.min(x, window.innerWidth - r.width - 8))) + "px";
  menuEl.style.top = Math.round(Math.max(6, Math.min(y, window.innerHeight - r.height - 8))) + "px";

  // CAPTURE phase. A menu action re-renders the panel, which detaches the
  // clicked element, so a bubble-phase "was this inside the menu" test would
  // already read false and dismiss things in the wrong order.
  const away = (e) => { if (menuEl && !menuEl.contains(e.target)) closeContextMenu(); };
  const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeContextMenu(); } };
  cleanup = () => {
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", esc, true);
  };
  // Deferred, or the very pointerdown that opened the menu closes it again.
  setTimeout(() => {
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
  }, 0);
}
