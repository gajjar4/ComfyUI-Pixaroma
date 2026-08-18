// Music Prompt Pixaroma - the gear panel.
//
// The skeleton (open, drag, follow, outsideClose, Escape, wheel) is COPIED from
// AI Prompt's, which is itself copied from Video Prompt's. Every line of it was
// earned by a real bug, and the three that bite hardest are:
//   - pointerdown, not mousedown: LiteGraph preventDefaults the canvas
//     pointerdown, which suppresses the compatibility mouse events, so a
//     mousedown guard never fires on the canvas while working fine elsewhere;
//   - the gear must be EXEMPT from outsideClose, because that runs on
//     pointerdown while the button acts on click - so without it the press
//     closes and the click reopens, and the toggle looks dead;
//   - USER_MOVED resets on CLOSE, never on open, or one dragged panel teaches
//     every later one to sit still where the node is not (house convention #29).
//
// This panel is deliberately small. There is no formula to edit and no presets
// to manage - both wordings are baked in and measured - so all it carries is
// the model, what to do with it afterwards, and the accent.

import { fetchModels } from "../ai_prompt/api.mjs";
// Reused, not re-rolled. `openEditor` already carries installGraphUndoGuard,
// and it was the ONLY fullscreen editor in the pack without it until that was
// found and fixed (ai-prompt.md 19d) - a fresh copy would very likely repeat
// exactly that hole. There is no cycle: ai_prompt never imports music_prompt.
// If a third consumer turns up, that is when it moves to js/shared.
import { openEditor } from "../ai_prompt/settings.mjs";
import { followNode, getNodeScreenRect, makeDraggable, placeBeside } from "../shared/node_panel.mjs";
import {
  ACC,
  createAccentSection,
  registerNodeAccent,
  registerNodeSettings,
} from "../shared/node_settings.mjs";
import { CLASS, readState, writeState } from "./core.mjs";

const CSS_ID = "pixaroma-music-prompt-settings-css";

let PANEL = null;
let PANEL_NODE = null;
let ON_CHANGE = null;
let USER_MOVED = false;
let POP = null;
let CP_HANDLE = null;
let MODELS = { ok: false, models: [], error: null };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .pix-mps { position:fixed; z-index:1300; width:340px; max-height:76vh;
      display:flex; flex-direction:column;
      background:#232323; border:1px solid #3a3a3a; border-radius:8px;
      box-shadow:0 10px 34px rgba(0,0,0,.5);
      font:12px 'Segoe UI', sans-serif; color:#ddd; }
    .pix-mps-head { display:flex; align-items:center; gap:8px; flex:0 0 auto;
      padding:9px 11px; border-bottom:1px solid #333; cursor:move;
      user-select:none; font-size:12.5px; }
    .pix-mps-head b { font-weight:600; color:#eee; }
    .pix-mps-x { margin-left:auto; background:none; border:none; color:#888;
      font-size:13px; cursor:pointer; padding:0 2px; line-height:1; }
    .pix-mps-x:hover { color:${ACC}; }
    /* A scrolling body, so a long model list can never push the accent section
       off the bottom of the screen. */
    .pix-mps-body { flex:1 1 auto; overflow-y:auto; padding:11px; }
    .pix-mps-body::-webkit-scrollbar { width:9px; }
    .pix-mps-body::-webkit-scrollbar-thumb { background:#3a3a3a; border-radius:5px; }

    .pix-mps-lbl { font-size:10px; letter-spacing:.09em; text-transform:uppercase;
      color:${ACC}; margin:0 0 5px; }
    .pix-mps-note { font-size:10.5px; color:#7d7a76; line-height:1.45;
      margin:6px 0 0; }
    .pix-mps-note.is-warn { color:#e0a33a; }
    .pix-mps-rule { height:1px; background:#333; margin:13px 0; }

    /* The Pixaroma custom dark dropdown, NEVER a native <select>: the OS chrome
       (a blue highlight on the open list) clashes with the theme, and the user
       rejected it outright (node UI convention #14). */
    .pix-mps-pick { display:flex; align-items:center; gap:7px; cursor:pointer;
      background:#1d1d1d; border:1px solid #444; border-radius:4px;
      padding:6px 9px; }
    .pix-mps-pick:hover { border-color:${ACC}; }
    .pix-mps-pick .v { flex:1 1 auto; min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; color:#ddd; font-size:11.5px; }
    .pix-mps-pick .c { color:${ACC}; font-size:9px; flex:0 0 auto; }

    .pix-mps-pop { position:fixed; z-index:1400; max-height:340px; overflow-y:auto;
      background:#1d1d1d; border:1px solid #444; border-radius:4px;
      box-shadow:0 8px 26px rgba(0,0,0,.55); padding:4px; }
    .pix-mps-pop::-webkit-scrollbar { width:9px; }
    .pix-mps-pop::-webkit-scrollbar-thumb { background:#3a3a3a; border-radius:5px; }
    .pix-mps-filter { width:100%; box-sizing:border-box; background:#161616;
      border:1px solid #3a3a3a; border-radius:3px; color:#ddd;
      font:11.5px 'Segoe UI', sans-serif; padding:5px 7px; margin-bottom:4px;
      outline:none; }
    .pix-mps-filter:focus { border-color:${ACC}; }
    .pix-mps-item { padding:5px 8px; border-radius:3px; cursor:pointer;
      font-size:11.5px; color:#ccc; white-space:nowrap; overflow:hidden;
      text-overflow:ellipsis; }
    .pix-mps-item:hover { background:#2a2a2a; color:#fff; }
    .pix-mps-item.on { background:${ACC}; color:#fff; }
    .pix-mps-empty { padding:7px 8px; font-size:11px; color:#7d7a76; }

    .pix-mps-row { display:flex; align-items:center; gap:9px; margin-top:9px; }
    .pix-mps-row .t { flex:1 1 auto; min-width:0; font-size:11.5px; color:#ccc; }
    .pix-mps-tog { flex:0 0 auto; width:34px; height:18px; border-radius:9px;
      background:#3a3a3a; position:relative; cursor:pointer;
      transition:background .12s; }
    .pix-mps-tog .knob { position:absolute; top:2px; left:2px; width:14px;
      height:14px; border-radius:50%; background:#999; transition:left .12s; }
    .pix-mps-tog.on { background:${ACC}; }
    .pix-mps-tog.on .knob { left:18px; background:#fff; }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// The model popup
// ---------------------------------------------------------------------------
function closePop() {
  POP?.remove();
  POP = null;
}

function openPop(anchor, values, current, onPick) {
  closePop();
  const pop = el("div", "pix-mps-pop");
  const r = anchor.getBoundingClientRect();
  pop.style.left = r.left + "px";
  pop.style.top = (r.bottom + 3) + "px";
  pop.style.minWidth = r.width + "px";

  const filter = el("input", "pix-mps-filter");
  filter.placeholder = "Type to narrow the list";
  const list = el("div");
  pop.append(filter, list);

  let shown = [];
  const paint = () => {
    const q = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = values.filter((v) => {
      const hay = String(v.label || v.value).toLowerCase();
      return q.every((word) => hay.includes(word));
    });
    list.textContent = "";
    if (!shown.length) {
      list.appendChild(el("div", "pix-mps-empty", "Nothing matches"));
      return;
    }
    for (const v of shown) {
      const it = el("div", "pix-mps-item" + (v.value === current ? " on" : ""),
                    v.label || v.value);
      it.title = v.title || v.label || v.value;
      it.addEventListener("click", (e) => { e.stopPropagation(); closePop(); onPick(v.value); });
      list.appendChild(it);
    }
  };
  paint();
  filter.addEventListener("input", paint);
  filter.addEventListener("keydown", (e) => {
    // ComfyUI binds keys on the document, including Ctrl+V to paste NODES, so a
    // field inside a floating panel has to keep its typing to itself.
    e.stopPropagation();
    // A filter you type into and then have to reach for the mouse is half a
    // control (ai-prompt.md 19b).
    if (e.key === "Enter" && shown.length === 1) {
      e.preventDefault();
      closePop();
      onPick(shown[0].value);
    }
    if (e.key === "Escape") { e.preventDefault(); closePop(); }
  });

  document.body.appendChild(pop);
  // Keep it on screen once it has a real size.
  const pr = pop.getBoundingClientRect();
  if (pr.bottom > window.innerHeight - 8) {
    pop.style.top = Math.max(8, r.top - pr.height - 3) + "px";
  }
  if (pr.right > window.innerWidth - 8) {
    pop.style.left = Math.max(8, window.innerWidth - pr.width - 8) + "px";
  }
  POP = pop;
  setTimeout(() => filter.focus(), 0);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderPanel(node, body) {
  body.textContent = "";
  const st = readState(node);

  // ---- model ---------------------------------------------------------------
  body.appendChild(el("div", "pix-mps-lbl", "Model"));
  const pick = el("div", "pix-mps-pick");
  const val = el("span", "v", st.model || "None - your text passes through");
  val.title = st.model || "";
  pick.append(val, el("span", "c", "▼"));
  pick.addEventListener("click", (e) => {
    e.stopPropagation();
    const values = [{ value: "", label: "None - pass the text through" }];
    for (const m of MODELS.models) values.push({ value: m, label: m });
    openPop(pick, values, st.model, (v) => {
      writeState(node, { model: v });
      ON_CHANGE?.();
      renderPanel(node, body);
    });
  });
  body.appendChild(pick);

  if (!MODELS.ok) {
    // An empty folder and a failed scan must never look identical.
    body.appendChild(el("div", "pix-mps-note is-warn",
      "The list of models could not be read: " + (MODELS.error || "unknown error")));
  } else if (!MODELS.models.length) {
    body.appendChild(el("div", "pix-mps-note is-warn",
      "There is nothing in your ComfyUI/models/text_encoders folder yet."));
  } else {
    body.appendChild(el("div", "pix-mps-note",
      "This node only reads and writes words, so it does NOT need a vision "
      + "model. Both formulas were measured on qwen3.5_4b_int8_convrot."));
  }

  body.appendChild(el("div", "pix-mps-rule"));

  // ---- free vram -----------------------------------------------------------
  const row = el("div", "pix-mps-row");
  row.appendChild(el("span", "t", "Unload the model when this node finishes"));
  const tog = el("div", "pix-mps-tog" + (st.release_model ? " on" : ""));
  tog.appendChild(el("span", "knob"));
  tog.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = !readState(node).release_model;
    writeState(node, { release_model: next });
    tog.classList.toggle("on", next);
    ON_CHANGE?.();
  });
  row.appendChild(tog);
  body.appendChild(row);
  body.appendChild(el("div", "pix-mps-note",
    "The same switch as Free VRAM on the node. In a chain it belongs only on "
    + "the last node using that model, and it is skipped entirely when the "
    + "model arrived on the clip wire - that one is not this node's to unload."));

  body.appendChild(el("div", "pix-mps-rule"));

  // ---- accent --------------------------------------------------------------
  body.appendChild(createAccentSection(node, {
    onPickerOpen: (h) => { CP_HANDLE = h; },
  }));
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------
function outsideClose(e) {
  if (!PANEL) return;
  // The full-screen editor sits ON TOP, so a press inside it must not close the
  // panel underneath. This has to come FIRST - the popup check below would
  // otherwise take the list down with it.
  if (e.target?.closest?.(".pix-ape-back")) return;
  if (POP && !POP.contains(e.target) && !e.target?.closest?.(".pix-mps-pick")) {
    closePop();
  }
  if (PANEL.contains(e.target)) return;
  // These live on <body> too and this guard is capture-phase, so it runs before
  // their own handlers. Without the exemptions, picking a colour dismisses the
  // panel underneath (node-settings-accent invariant 3). `.pix-mp-gear` is
  // exempt for a different reason: it is what OPENS the panel, and this fires on
  // pointerdown while the button acts on click.
  if (e.target?.closest?.(
    ".pix-mps-pop, .pix-ape-back, .pix-mp-gear, .pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop"
  )) return;
  closeMusicPromptPanelFor(null);
}

function escClose(e) {
  if (e.key !== "Escape" || !PANEL) return;
  // The editor and the popup own Escape while they are up.
  if (document.querySelector(".pix-ape-back")) return;
  if (POP) { e.stopPropagation(); closePop(); return; }
  e.stopPropagation();
  closeMusicPromptPanelFor(null);
}

function wheelClose(e) {
  if (!PANEL) return;
  if (PANEL.contains(e.target) || POP?.contains(e.target)) return;
  closeMusicPromptPanelFor(null);
}

export function closeMusicPromptPanelFor(node) {
  if (node && PANEL_NODE !== node) return;
  closePop();
  try { CP_HANDLE?.close?.(); } catch (_) { /* already gone */ }
  CP_HANDLE = null;
  try { PANEL?._pixCleanup?.(); } catch (_) { /* already gone */ }
  PANEL?.remove();
  PANEL = null;
  PANEL_NODE = null;
  ON_CHANGE = null;
  // Reset on CLOSE, never on open, or one dragged panel teaches every later one
  // to sit still where the node is not.
  USER_MOVED = false;
}

export async function openMusicPromptPanel(node, onChange) {
  injectCSS();
  // A second press on the gear TOGGLES rather than stacking.
  if (PANEL && PANEL_NODE === node) { closeMusicPromptPanelFor(node); return; }
  closeMusicPromptPanelFor(null);
  PANEL_NODE = node;
  ON_CHANGE = onChange;

  const panel = el("div", "pix-mps");
  const head = el("div", "pix-mps-head");
  head.appendChild(el("b", null, "Music Prompt settings"));
  const x = el("button", "pix-mps-x", "✕");
  x.addEventListener("click", () => closeMusicPromptPanelFor(null));
  head.appendChild(x);
  const body = el("div", "pix-mps-body");
  panel.append(head, body);
  document.body.appendChild(panel);
  PANEL = panel;

  placeBeside(panel, getNodeScreenRect(node));
  // ignoreSelector is NOT optional: makeDraggable preventDefaults and takes
  // pointer capture on pointerdown, so without it the ✕ inside the handle never
  // receives its click and the one control that closes the panel does nothing.
  makeDraggable(panel, head, {
    onUserMove: () => { USER_MOVED = true; },
    ignoreSelector: ".pix-mps-x",
  });
  followNode(panel, node, {
    isCurrent: () => PANEL === panel && PANEL_NODE === node,
    isUserMoved: () => USER_MOVED,
  });
  // Deferred, so the click that OPENED the panel does not immediately close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
    document.addEventListener("wheel", wheelClose, true);
  }, 0);
  panel._pixCleanup = () => {
    document.removeEventListener("pointerdown", outsideClose, true);
    document.removeEventListener("keydown", escClose, true);
    document.removeEventListener("wheel", wheelClose, true);
  };

  body.textContent = "Loading...";
  // Re-fetched on every open (house convention #18): a custom picker backed by
  // our own route gets NOTHING from ComfyUI's R refresh, so a session cache
  // would look permanently stale after somebody renames a file.
  //
  // Land it in a LOCAL and publish only after the staleness guard: writing the
  // module singleton first let a slow request for a CLOSED panel clobber the
  // list a newer panel had already rendered from.
  const fetched = await fetchModels();
  if (PANEL !== panel) return;
  MODELS = fetched;
  renderPanel(node, body);
  // Place it AGAIN now the content is in: the placement above ran while the
  // body still said "Loading..." and the panel was ~80px tall, so it was
  // clamped against the wrong height. followNode corrects it, but only on its
  // next frame, so without this the user sees the panel jump.
  if (!USER_MOVED) placeBeside(panel, getNodeScreenRect(node));
}

/** The Expand button: the idea in a full-screen box. */
export function openIdeaEditor(node, onSaved) {
  openEditor("Your idea", readState(node).idea, (text) => {
    writeState(node, { idea: text });
    onSaved?.();
    return true;
  }, { owner: node, spellcheck: true });
}

// One registration gives BOTH surfaces: the orange gear in the node selection
// toolbar and the central right-click entry. ownMenuItem stops the generic entry
// doubling the one this node adds itself.
registerNodeAccent(CLASS, { title: "Music Prompt" });
registerNodeSettings(CLASS, {
  open: (node) => openMusicPromptPanel(node, () => node._pixMpRender?.()),
  ownMenuItem: false,
});
