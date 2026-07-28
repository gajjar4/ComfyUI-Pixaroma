// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared - Node settings registry + accent colour     ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// ONE place that gives every Pixaroma node two things it used to have to build
// by hand:
//
//   1. A settings panel reachable from BOTH surfaces, with no per-node wiring:
//        - the right-click menu entry ("⚙ <Title> settings")
//        - the orange gear button in ComfyUI's node selection toolbar,
//          sitting next to the Pixaroma ? Help button
//      Both are driven by ONE central extension (js/help_toolbar/index.js) that
//      reads this registry, exactly like registerNodeHelp drives the ? button.
//
//   2. A per-node ACCENT COLOUR, so nobody is stuck with the Pixaroma orange.
//      The colour a node paints with resolves down this chain:
//
//        node.properties[prop]                 this one node's pick
//        -> Pixaroma.<Class>.AccentColor       default for new nodes of this type
//        -> Pixaroma.Accent.Default            master default for ALL Pixaroma nodes
//        -> #f66744                            the Pixaroma orange
//
// ── Adding the colour option to a node (the whole recipe) ────────────────────
//
//   import { registerNodeAccent, accentOf, applyAccent } from "../shared/index.mjs";
//
//   // 1. register (usually right after the node's help registration)
//   registerNodeAccent("PixaromaMyNode", {
//     title: "My Node",                 // used in the menu + panel header
//     onChange: (node) => repaint(node),// repaint the node face after a pick
//   });
//
//   // 2a. DOM-widget node: set the CSS var on the widget root once, and write
//   //     the node's scoped CSS against it:
//   applyAccent(root, node);            // sets --pix-acc on that element
//   //     ...and in the node's CSS string use ACC (exported below) instead of
//   //     a hardcoded #f66744:            ".pix-mn-btn:hover{border-color:" + ACC + ";}"
//   //     The var lives on the node's own root, so two nodes of the same type
//   //     can carry different colours off ONE injected stylesheet.
//
//   // 2b. canvas-painted node: read accentOf(node) inside draw() instead of BRAND.
//
// That is it - the right-click entry, the toolbar gear, the picker, the two
// "save as default" buttons and the persistence all come for free.
//
// A node that already owns a richer settings panel registers it directly with
// registerNodeSettings(class, { title, open(node), ownMenuItem: true }) - the
// ownMenuItem flag tells the central menu hook to stay out of the way because
// that node already adds its own "⚙ ..." line among its other menu entries.
//
// State rules (these are load-bearing, do not "tidy" them away):
//   - The accent is written to node.properties ONLY when the user actually picks
//     a colour. Never on the load path. A clean saved workflow must never open
//     "modified" just because a property key appeared (Vue Compat #18).
//   - Clearing the pick DELETES the key rather than writing the brand colour, so
//     the node goes back to following the defaults instead of freezing today's.
//   - The per-class and master defaults are UNREGISTERED settings (except the
//     master, which also gets a visible row in the Settings panel). ComfyUI
//     persists unregistered setting ids fine (Vue Compat #20).

import { app } from "/scripts/app.js";
import { isVueNodes } from "./nodes2.mjs";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "./color_picker.mjs";

export const BRAND = "#f66744";

// The CSS custom property a node's DOM root carries, and the ready-made
// var() string to paste into a node's scoped CSS in place of the hex.
export const ACCENT_VAR = "--pix-acc";
export const ACC = `var(${ACCENT_VAR},${BRAND})`;

// Master default: every Pixaroma node follows this unless it (or its node type)
// has been given its own colour. Registered as a visible row by the toolbar
// extension so it also shows up in ComfyUI's Settings panel.
export const GLOBAL_ACCENT_SETTING = "Pixaroma.Accent.Default";

// The node.properties key. Shared across nodes on purpose: one key means the
// accent survives a node being copied between graphs, and it reads the same in
// every workflow JSON. Nodes that already shipped their own key pass `prop`.
export const DEFAULT_ACCENT_PROP = "pixAccent";

// ── registry ─────────────────────────────────────────────────────────────────

const _defs = new Map(); // comfyClass -> def

// "PixaromaOutpaintStitch" -> "Pixaroma.OutpaintStitch.AccentColor".
// Matches the ids the nodes that predate this module already use, so their
// saved defaults keep working after they move onto the shared chain.
export function classAccentSetting(comfyClass) {
  const tail = String(comfyClass || "").replace(/^Pixaroma/, "") || "Node";
  return `Pixaroma.${tail}.AccentColor`;
}

// Tolerant read: ComfyUI's own "color" setting widget can hand back a bare
// "f66744" with no hash, so normalise before anything paints with it.
function readSetting(id) {
  try {
    const v = app.ui?.settings?.getSettingValue?.(id);
    if (typeof v === "string" && v.trim()) {
      const s = v.trim();
      return /^[0-9a-fA-F]{3,8}$/.test(s) ? "#" + s : s;
    }
  } catch {}
  return null;
}

async function writeSetting(id, value) {
  try {
    await app.ui.settings.setSettingValueAsync(id, value);
    return true;
  } catch {
    return false;
  }
}

// The master default (or null when the user has never set one).
export function globalAccent() {
  return readSetting(GLOBAL_ACCENT_SETTING);
}

/**
 * Register a node's own settings panel.
 *   def = {
 *     title:       "Outpaint",            // shown in the menu + toolbar tooltip
 *     open(node),                          // opens the panel
 *     closeFor?(node),                     // teardown when the node is removed
 *     ownMenuItem?: true,                  // node adds its own "⚙" menu line
 *     menuLabel?: "Outpaint settings",     // override the menu text
 *   }
 */
export function registerNodeSettings(comfyClass, def) {
  if (!comfyClass || !def || typeof def.open !== "function") return;
  _defs.set(comfyClass, { ...def, kind: def.kind || "custom" });
}

/**
 * Register a node for the generic accent-only panel. Everything is optional
 * except the class.
 *   opts = {
 *     title:        "Show Text",           // defaults to a de-camelled class name
 *     prop:         "pixAccent",           // node.properties key
 *     setting:      "Pixaroma.X.AccentColor",
 *     swatchLabel:  "Button colour",       // the row label in the panel
 *     swatchHint:   "This node only. ...", // the small grey line under it
 *     onChange(node),                      // repaint the node face after a pick
 *     ownMenuItem?: true,
 *   }
 */
export function registerNodeAccent(comfyClass, opts = {}) {
  if (!comfyClass) return;
  const def = {
    kind: "accent",
    title: opts.title || defaultTitle(comfyClass),
    prop: opts.prop || DEFAULT_ACCENT_PROP,
    setting: opts.setting || classAccentSetting(comfyClass),
    swatchLabel: opts.swatchLabel || "Button colour",
    swatchHint: opts.swatchHint || "This node only. Save it as a default below.",
    onChange: typeof opts.onChange === "function" ? opts.onChange : null,
    ownMenuItem: !!opts.ownMenuItem,
    menuLabel: opts.menuLabel || null,
    open: (node) => openAccentPanel(node),
    closeFor: (node) => closeNodeSettingsFor(node),
  };
  _defs.set(comfyClass, def);
}

export function getNodeSettings(comfyClass) {
  return comfyClass ? _defs.get(comfyClass) || null : null;
}

// "PixaromaLoadImageMini" -> "Load Image Mini"
function defaultTitle(comfyClass) {
  return String(comfyClass || "")
    .replace(/^Pixaroma/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim() || "Node";
}

export function openNodeSettings(node) {
  const def = getNodeSettings(node?.comfyClass);
  if (def) def.open(node);
}

// ── accent read / write ──────────────────────────────────────────────────────

function accentPropOf(comfyClass) {
  return getNodeSettings(comfyClass)?.prop || DEFAULT_ACCENT_PROP;
}

/**
 * The colour this node should paint with. Safe to call for a node that never
 * registered anything - it just falls through to the master default / brand.
 */
export function accentOf(node) {
  if (!node) return BRAND;
  const def = getNodeSettings(node.comfyClass);
  const own = node.properties?.[def?.prop || DEFAULT_ACCENT_PROP];
  if (typeof own === "string" && own.trim()) return own.trim();
  const perClass = readSetting(def?.setting || classAccentSetting(node.comfyClass));
  if (perClass) return perClass;
  return globalAccent() || BRAND;
}

/**
 * Store this node's own pick. A falsy hex DELETES the key so the node goes back
 * to following the defaults. Only ever call this from a real user action.
 */
export function setNodeAccent(node, hex) {
  if (!node) return;
  if (!node.properties) node.properties = {};
  const prop = accentPropOf(node.comfyClass);
  if (hex) node.properties[prop] = hex;
  else delete node.properties[prop];
}

/**
 * The node's accent as an rgba() string at the given alpha - for the translucent
 * washes a canvas paints behind a selected card. CSS can use
 * `color-mix(in srgb, var(--pix-acc,#f66744) 20%, transparent)` instead; a canvas
 * has no such option, hence this.
 * Falls back to the brand orange for any colour it cannot parse.
 */
export function accentRgba(node, alpha = 1) {
  const hex = String(accentOf(node) || BRAND).trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  let r = 246, g = 103, b = 68;
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Put the node's accent on a DOM element as the --pix-acc custom property. */
export function applyAccent(el, node) {
  if (el?.style) el.style.setProperty(ACCENT_VAR, accentOf(node));
}

/**
 * Wire a node's DOM roots to its accent. Call ONCE per root, right after
 * addDOMWidget - it paints the var now and remembers the element so a later
 * colour pick can repaint without the node having to hand us a callback.
 * A node with several widget rows may call it once per row.
 */
export function installNodeAccent(node, ...els) {
  if (!node) return;
  const keep = (node._pixAccentEls ||= []);
  for (const e of els) {
    if (e?.style && !keep.includes(e)) keep.push(e);
    applyAccent(e, node);
  }
}

// Every element that should carry the var for this node: the roots it handed us,
// plus any DOM widget element (covers nodes that never called installNodeAccent),
// plus the Nodes 2.0 node element so descendants inherit it.
function accentTargets(node) {
  const out = [];
  for (const e of node._pixAccentEls || []) if (e?.isConnected) out.push(e);
  for (const w of node.widgets || []) {
    const e = w.element || w.inputEl;
    if (e?.style && !out.includes(e)) out.push(e);
  }
  if (node.id != null) {
    const ne = document.querySelector(`[data-node-id="${node.id}"]`);
    if (ne && !out.includes(ne)) out.push(ne);
  }
  return out;
}

/**
 * Repaint one node after its colour changed: refresh the CSS var everywhere it
 * matters and ask for a canvas redraw (which is what a canvas-painted node needs,
 * since its draw() reads accentOf(node) live).
 */
export function repaintAccent(node) {
  if (!node) return;
  const a = accentOf(node);
  for (const e of accentTargets(node)) e.style.setProperty(ACCENT_VAR, a);
  try { node.setDirtyCanvas?.(true, true); } catch {}
}

/**
 * Repaint every node on the canvas. Used when a DEFAULT changes (the master
 * colour in the Settings panel, or a "save as default" press), because that can
 * move nodes which have no colour of their own.
 */
export function repaintAllAccents() {
  const nodes = app.graph?._nodes || app.graph?.nodes || [];
  for (const n of nodes) {
    if (n && getNodeSettings(n.comfyClass)) repaintAccent(n);
  }
  try { app.graph?.setDirtyCanvas(true, true); } catch {}
}

// ── the generic accent panel ─────────────────────────────────────────────────
//
// Same shape as the hand-built panels that came before it (Outpaint Stitch /
// Run Timer / Save Image): a themed card beside the node, draggable by its
// header, closing on outside click or Esc.

let _panel = null;
let _panelNode = null;
let _cpHandle = null;
let _loadWrapped = false;

const CSS_ID = "pix-nodeset-css";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = `
    .pix-nset { position:fixed; z-index:10010; width:340px; max-width:94vw; background:#1a1a1a;
      border:1px solid #3a3a3a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden; }
    .pix-nset-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; }
    .pix-nset-t .g { color:${ACC}; }
    .pix-nset-t .n { color:${ACC}; font-weight:600; }
    .pix-nset-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-nset-t .x:hover { color:#fff; }
    .pix-nset-b { padding:14px 12px; display:flex; flex-direction:column; gap:12px; }
    .pix-nset-sec { display:flex; flex-direction:column; gap:10px; }
    .pix-nset-acc { display:flex; align-items:center; gap:10px; }
    .pix-nset-acc .lab { font-size:12px; color:#cfcfcf; }
    .pix-nset-acc .sub { font-size:11px; color:#8a8a8a; margin-top:2px; }
    .pix-nset-sw { width:34px; height:24px; border-radius:5px; border:1px solid #555; cursor:pointer; flex:none; }
    .pix-nset-sw:hover { border-color:#fff; }
    .pix-nset-dt { font-size:11px; color:#8a8a8a; }
    .pix-nset-row { display:flex; gap:8px; flex-wrap:wrap; }
    .pix-nset-btn { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:5px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; box-sizing:border-box; }
    .pix-nset-btn:hover { border-color:${ACC}; color:#fff; }
    .pix-nset-f { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-nset-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

// Where the node sits on screen, so the panel can open beside it. Nodes 2.0
// gives us a real element; Classic needs the canvas transform by hand.
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
  const width = node.size[0] * sc;
  const height = (node.size[1] + titleH) * sc;
  return { left, top, right: left + width, bottom: top + height, width, height };
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
  // clicks inside the colour picker must not dismiss the panel behind it
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
  closeNodeSettingsPanel();
}

function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    e.stopPropagation();
    closeNodeSettingsPanel();
  }
}

export function closeNodeSettingsPanel() {
  try { _cpHandle?.close(); } catch {}
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch {} }
  _panel = null;
  _panelNode = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

/** Close the panel if it belongs to this node (call from the node's onRemoved). */
export function closeNodeSettingsFor(node) {
  if (_panelNode === node) closeNodeSettingsPanel();
}

// Safety net: any workflow load / tab switch / undo closes a stray panel. Wrapped
// once, lazily, the same way the Help popup protects itself.
function wrapLoadGraphData() {
  if (_loadWrapped || !app?.loadGraphData) return;
  _loadWrapped = true;
  const orig = app.loadGraphData.bind(app);
  app.loadGraphData = function (...args) {
    closeNodeSettingsPanel();
    return orig(...args);
  };
}

/**
 * The colour block as a drop-in element, so a node that already owns a richer
 * settings panel can offer the same colour option without rebuilding it:
 *
 *   body.appendChild(createAccentSection(node, { onChange: () => repaint(node) }));
 *
 * The host panel MUST let clicks inside the picker through its outside-close
 * guard, or picking a colour dismisses the panel underneath:
 *   if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
 *
 * opts = { title, label, hint, onChange(node), onPickerOpen(handle) }
 */
export function createAccentSection(node, opts = {}) {
  injectCSS();
  const def = getNodeSettings(node?.comfyClass);
  const title = opts.title || def?.title || defaultTitle(node?.comfyClass);
  const setting = def?.setting || classAccentSetting(node?.comfyClass);

  const wrap = el("div", "pix-nset-sec");
  wrap.style.setProperty(ACCENT_VAR, accentOf(node));

  const sw = el("div", "pix-nset-sw");
  sw.title = "Pick the colour this node paints with";
  sw.style.background = accentOf(node);

  const repaint = () => {
    const a = accentOf(node);
    wrap.style.setProperty(ACCENT_VAR, a);
    sw.style.background = a;
    repaintAccent(node);
    opts.onChange?.(node);
  };

  sw.addEventListener("click", () => {
    const handle = openPixaromaColorPickerPopup(sw, {
      initialColor: accentOf(node),
      swatches: BUTTON_PALETTE,
      wide: true,
      resetColor: BRAND,
      onPick: (c) => { setNodeAccent(node, c || BRAND); repaint(); },
    });
    opts.onPickerOpen?.(handle);   // so the host can close it on teardown
  });

  const row = el("div", "pix-nset-acc");
  const txt = el("div");
  txt.appendChild(el("div", "lab", opts.label || "Button colour"));
  txt.appendChild(el("div", "sub", opts.hint || "This node only. Save it as a default below."));
  row.append(sw, txt);

  const flash = (btn, text) => {
    const was = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = was; }, 1200);
  };

  const btns = el("div", "pix-nset-row");
  const bType = el("button", "pix-nset-btn", "New " + title + " nodes");
  bType.title = "Every new " + title + " node starts with this colour";
  bType.addEventListener("click", async () => {
    if (await writeSetting(setting, accentOf(node))) { flash(bType, "Saved"); repaintAllAccents(); }
  });
  const bAll = el("button", "pix-nset-btn", "Every Pixaroma node");
  bAll.title = "Every Pixaroma node follows this colour, unless it has been given one of its own";
  bAll.addEventListener("click", async () => {
    if (await writeSetting(GLOBAL_ACCENT_SETTING, accentOf(node))) { flash(bAll, "Saved"); repaintAllAccents(); }
  });
  btns.append(bType, bAll);

  wrap.append(row, el("div", "pix-nset-dt", "Use this colour as the default for"), btns);
  return wrap;
}

export function openAccentPanel(node) {
  const def = getNodeSettings(node?.comfyClass);
  if (!node) return;
  closeNodeSettingsPanel();
  injectCSS();
  wrapLoadGraphData();
  _panelNode = node;

  const title = def?.title || defaultTitle(node.comfyClass);

  const panel = el("div", "pix-nset");
  panel.style.setProperty(ACCENT_VAR, accentOf(node));

  const head = el("div", "pix-nset-t");
  head.append(el("span", "g", "⚙"), el("span", "n", title + " settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeNodeSettingsPanel);
  head.appendChild(x);

  // The whole body IS the shared colour block, so this panel and a node that
  // drops the block into its own richer panel behave identically.
  const body = el("div", "pix-nset-b");
  body.appendChild(createAccentSection(node, {
    title,
    label: def?.swatchLabel,
    hint: def?.swatchHint,
    onChange: () => {
      panel.style.setProperty(ACCENT_VAR, accentOf(node));  // the panel's own chrome
      def?.onChange?.(node);                                // whatever the node rebuilds
    },
    onPickerOpen: (h) => { _cpHandle = h; },                // so close() reaches it
  }));

  const foot = el("div", "pix-nset-f");
  const done = el("button", "pix-nset-btn pix-nset-push", "Done");
  done.addEventListener("click", closeNodeSettingsPanel);
  foot.appendChild(done);

  panel.append(head, body, foot);
  document.body.appendChild(panel);

  placeBeside(panel, getNodeScreenRect(node));
  makeDraggable(panel, head);

  // deferred so the click that opened the panel does not immediately close it
  setTimeout(() => {
    if (!_panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  _panel = panel;
}
