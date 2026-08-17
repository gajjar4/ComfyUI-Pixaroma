// AI Prompt Pixaroma - the settings panel and the full-screen text editor.
//
// The skeleton (open, drag, follow, outsideClose, Escape) is copied from the
// panels that already work rather than rebuilt from node_panel.mjs's function
// signatures - node-settings-accent.md says so in capitals, because writing
// one from scratch shipped three bugs in a single file that every other panel
// had already solved:
//   - the ✕ sits INSIDE the drag handle, so it needs ignoreSelector;
//   - the gear acts on click while outsideClose fires on pointerdown, so the
//     gear must be exempt or a second press looks like a no-op;
//   - LiteGraph preventDefaults the canvas pointerdown, which suppresses the
//     compatibility mouse events, so a `mousedown` guard NEVER fires for a
//     click on the canvas while working fine on DOM elsewhere.

import { createAccentSection } from "../shared/node_settings.mjs";
import { followNode, getNodeScreenRect, makeDraggable, placeBeside } from "../shared/node_panel.mjs";
import {
  ORDER_IDEA,
  ORDER_WIRED,
  SEP_OPTIONS,
  readState,
  slotConnected,
  writeState,
} from "./core.mjs";
import { deletePreset, fetchModels, fetchPresets, savePreset } from "./api.mjs";
import { DEFAULT_STATE, SETTING_KEYS } from "./core.mjs";
import { formatRecipe, parseRecipe, recipeFileStem } from "./recipe.mjs";

const CSS_ID = "pixaroma-ai-prompt-panel-css";

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
    /* border-box everywhere in the panel. Without it a flex row mixing a
       padded field with an unpadded sibling splits the space by CONTENT width
       and then adds the padding back, so the padded one comes out ~20px wider
       and the column stops lining up. */
    .pix-app, .pix-app * { box-sizing:border-box; }
    .pix-app { position:fixed; z-index:1300; width:374px; max-height:82vh;
      display:flex; flex-direction:column; background:#232325;
      border:1px solid #3a3a3c; border-radius:8px; color:#e0e0e0;
      font:12px 'Segoe UI', sans-serif; box-shadow:0 8px 28px rgba(0,0,0,.5); }
    .pix-app-head { display:flex; align-items:center; gap:8px; padding:9px 12px;
      background:#2a2a2c; border-bottom:1px solid #1c1c1e; cursor:move;
      border-radius:8px 8px 0 0; user-select:none; }
    .pix-app-head span { font-size:12.5px; font-weight:600; }
    .pix-app-x { margin-left:auto; background:none; border:none; color:#8b8b8e;
      font-size:14px; cursor:pointer; padding:0 2px; line-height:1; }
    .pix-app-x:hover { color:var(--pix-acc,#f66744); }
    .pix-app-body { padding:11px 12px 14px; overflow-y:auto; display:flex;
      flex-direction:column; gap:7px; }
    .pix-app-sec { font-size:10px; letter-spacing:.11em; text-transform:uppercase;
      color:var(--pix-acc,#f66744); margin-top:9px; }
    .pix-app-body > .pix-app-sec:first-child { margin-top:0; }
    .pix-app-pick { display:flex; align-items:center; gap:8px; background:#191919;
      border:1px solid #343436; border-radius:4px; padding:6px 9px; cursor:pointer; }
    .pix-app-pick:hover { border-color:var(--pix-acc,#f66744); }
    .pix-app-pick.is-locked { opacity:.45; cursor:default; }
    .pix-app-pick.is-locked:hover { border-color:#343436; }
    .pix-app-pick .v { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; font-size:11.5px; color:#ddd9d4; }
    .pix-app-pick .v.none { color:#e0a33a; }
    .pix-app-pick .c { color:var(--pix-acc,#f66744); font-size:9px; }
    .pix-app-note { font-size:10.5px; line-height:1.5; color:#e0a33a;
      background:rgba(224,163,58,.12); border-radius:4px; padding:5px 8px; }
    .pix-app-note.plain { color:#8b8b8e; background:rgba(255,255,255,.03); }
    .pix-app-nums { display:flex; gap:6px; }
    /* min-width:0 is load-bearing: a flex item defaults to min-width:auto, so
       without it these boxes refuse to shrink below their content and the two
       of them overflow the 374px panel - which showed up as a horizontal
       scrollbar and a MAX LEN value clipped to "51". */
    .pix-app-num { flex:1 1 0; min-width:0; display:flex; align-items:center;
      gap:8px; background:#191919; border:1px solid #343436; border-radius:4px;
      padding:5px 9px; min-height:26px; }
    .pix-app-num:focus-within { border-color:var(--pix-acc,#f66744); }
    .pix-app-num em { font-style:normal; font-size:9.5px; letter-spacing:.06em;
      color:var(--pix-acc,#f66744); flex:0 0 auto; }
    .pix-app-num input { flex:1; min-width:0; background:transparent; border:none;
      outline:none; color:#ddd9d4; font:11.5px monospace; text-align:right;
      line-height:1.2; padding:0; }
    .pix-app-adv { font-size:11px; color:#a4a09a; padding:3px 0; cursor:pointer;
      user-select:none; }
    .pix-app-adv:hover { color:var(--pix-acc,#f66744); }
    /* SCROLLS, and that is the point. It was overflow:hidden at 96px against a
       775px formula - 12% of it on screen, ~209 characters of 1704, with no
       scrollbar and no wheel. So the box showed text the reader could neither
       reach nor select, which is exactly how it was reported ("i can not seems
       to select the formula there"). A preview may be short; it may not be a
       dead end. cursor:text says the words are grabbable. */
    .pix-app-form { background:#191919; border:1px solid #343436; border-radius:4px;
      padding:8px 9px; font:11px monospace; line-height:1.5; color:#c2bfba;
      min-height:58px; max-height:150px; overflow-y:auto; overflow-x:hidden;
      white-space:pre-wrap; overflow-wrap:anywhere; cursor:text;
      scrollbar-width:thin; scrollbar-color:#4a4a4c transparent; }
    .pix-app-form::-webkit-scrollbar { width:8px; }
    .pix-app-form::-webkit-scrollbar-thumb { background:#4a4a4c; border-radius:4px; }
    .pix-app-form::-webkit-scrollbar-thumb:hover { background:var(--pix-acc,#f66744); }
    .pix-app-form::-webkit-scrollbar-track { background:transparent; }
    .pix-app-form.empty { color:#5c5a57; cursor:default; }
    .pix-app-row { display:flex; align-items:center; gap:6px; }
    .pix-app-row .cnt { margin-left:auto; font:10px monospace; color:#6f6c67; }
    .pix-app-btn { flex:1; background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.13); color:rgba(255,255,255,.62);
      border-radius:4px; padding:4px 9px; font-size:11px; cursor:pointer;
      font-family:'Segoe UI', sans-serif; }
    .pix-app-btn:hover { background:var(--pix-acc,#f66744);
      border-color:var(--pix-acc,#f66744); color:#fff; }
    .pix-app-btn.is-on { background:var(--pix-acc,#f66744);
      border-color:var(--pix-acc,#f66744); color:#fff; }
    .pix-app-btn:disabled { opacity:.35; cursor:default; }
    .pix-app-btn:disabled:hover { background:rgba(255,255,255,.05);
      border-color:rgba(255,255,255,.13); color:rgba(255,255,255,.62); }
    .pix-app-tog { display:flex; align-items:center; gap:9px; font-size:11.5px;
      color:#ccc9c5; padding:2px 0; cursor:pointer; user-select:none; }
    .pix-app-sw { width:26px; height:14px; border-radius:8px;
      background:rgba(255,255,255,.13); position:relative; flex:0 0 auto;
      transition:background .12s; }
    .pix-app-sw i { position:absolute; top:2px; left:2px; width:10px; height:10px;
      border-radius:50%; background:#8b8b8e; display:block; transition:left .12s; }
    .pix-app-sw.is-on { background:var(--pix-acc,#f66744); }
    .pix-app-sw.is-on i { left:14px; background:#fff; }

    .pix-app-pop { position:fixed; z-index:1400; max-height:320px; overflow-y:auto;
      background:#1d1d1d; border:1px solid #3a3a3c; border-radius:5px; padding:4px;
      color:#ddd; font:12px 'Segoe UI', sans-serif;
      box-shadow:0 10px 30px rgba(0,0,0,.55); }
    .pix-app-popfilter { width:100%; box-sizing:border-box; background:#141414;
      border:1px solid #343436; border-radius:4px; color:#ddd; padding:5px 8px;
      font:11.5px 'Segoe UI', sans-serif; outline:none; margin-bottom:4px; }
    .pix-app-popfilter:focus { border-color:var(--pix-acc,#f66744); }
    .pix-app-poplist > div { padding:5px 8px; border-radius:4px; cursor:pointer;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:11.5px; }
    .pix-app-poplist > div:hover { background:#2a2a2a; }
    .pix-app-poplist > div.is-on { color:var(--pix-acc,#f66744); }
    .pix-app-poplist > div.is-blind { color:#6d6d6d; }
    .pix-app-poplist > div.is-blind::after { content:" (no vision)"; font-size:10px; }
    /* Positive, and deliberately not greyed: this one can do MORE, and it is
       the only file in the list that can use the audio input at all. */
    .pix-app-poplist > div.is-ears::after { content:" (sees + hears)"; font-size:10px; opacity:.7; }

    .pix-ape-back { position:fixed; inset:0; z-index:1500; background:rgba(0,0,0,.72);
      display:flex; align-items:center; justify-content:center; }
    .pix-ape { width:min(1100px,94vw); height:94vh; display:flex; flex-direction:column;
      background:#232325; border:1px solid #3a3a3c; border-radius:8px;
      color:#e0e0e0; font:12px 'Segoe UI', sans-serif; }
    .pix-ape-head { display:flex; align-items:center; gap:10px; padding:10px 14px;
      border-bottom:1px solid #1c1c1e; }
    .pix-ape-head b { font-size:13px; }
    .pix-ape-head .cnt { font:11px monospace; color:#6f6c67; }
    .pix-ape-head .sp { flex:1; }
    .pix-ape textarea { flex:1; margin:0; background:#191919; border:none;
      border-top:1px solid #1c1c1e; border-bottom:1px solid #1c1c1e;
      color:#ddd9d4; font:12px/1.5 monospace; padding:12px 14px; outline:none;
      resize:none; }
    .pix-ape-foot { display:flex; gap:8px; justify-content:flex-end; padding:10px 14px; }
    .pix-ape-foot .pix-app-btn { flex:0 0 auto; padding:6px 18px; }

    /* The one-line question box (askName). Deliberately reuses .pix-ape-back
       for the backdrop: that class is in the panel's outsideClose exempt list,
       so asking a question cannot dismiss the panel underneath it. */
    .pix-apk { width:min(460px,92vw); display:flex; flex-direction:column;
      background:#232325; border:1px solid #3a3a3c; border-radius:8px;
      color:#e0e0e0; font:12px 'Segoe UI', sans-serif; }
    .pix-apk-msg { padding:12px 14px 0; font-size:12px; color:#b9b9b9; line-height:1.45; }
    .pix-apk-in { margin:10px 14px 2px; background:#1d1d1d; color:#e0e0e0;
      border:1px solid #333; border-radius:4px; padding:6px 8px;
      font:12px monospace; outline:none; }
    .pix-apk-in:focus { border-color:var(--pix-acc,#f66744); }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Dropdown. Never a native <select> - convention #14.
// ---------------------------------------------------------------------------
/** Does this filename look like a model that can SEE?
 *
 *  ⚠️ It used to be `/vl/i` alone, which called Gemma 4 blind - reported by a
 *  user who knew better. Gemma 4's tokenizer takes image, audio AND video
 *  (`comfy/text_encoders/gemma4.py` tokenize_with_weights), and Qwen3.5's
 *  takes image, and neither carries "vl" in its name.
 *
 *  ComfyUI itself decides this from the file's CONTENTS, not its name
 *  (`detect_te_model` reads the state dict), which a picker listing filenames
 *  cannot do - so this stays a hint, marked and never blocked. Being wrong in
 *  the direction of "no mark" is the safe way round: an unmarked text-only
 *  model wastes a run, a model wrongly marked blind is a thing the user is
 *  told not to use when it would have worked. */
function looksVision(name) {
  return /vl|gemma\W?4|qwen\W?3\.?5/i.test(String(name || ""));
}

/** ...and can it HEAR? Gemma 4 is the only text encoder in ComfyUI whose
 *  tokenizer accepts an `audio` argument - every Qwen3-VL takes the audio,
 *  ignores it and answers anyway. Worth marking POSITIVELY: this node has an
 *  audio input, and nothing else on screen says which of thirty files can use
 *  it. */
function looksAudio(name) {
  return /gemma\W?4/i.test(String(name || ""));
}

let POP = null;
function closePop() {
  POP?.remove();
  POP = null;
}

function openPop(anchor, values, current, onPick, opts) {
  closePop();
  const pop = el("div", "pix-app-pop");
  const mark = opts?.markVision !== false;
  let filter = null;
  const list = el("div", "pix-app-poplist");

  const paint = (q) => {
    list.replaceChildren();
    const needle = (q || "").trim().toLowerCase();
    // Every space-separated word must appear, so "vl 8b" finds the 8B VL build
    // whatever order the filename puts them in.
    const words = needle ? needle.split(/\s+/) : [];
    const hits = values.filter(([value, label]) => {
      const hay = (String(label) + " " + String(value)).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (!hits.length) {
      const none = el("div", null, values.length ? "Nothing matches" : "Nothing to choose");
      none.style.color = "#888";
      list.appendChild(none);
    }
    for (const [value, label, hoverTitle] of hits) {
      // The empty value is the "None" sentinel, not a file. Without this it got
      // marked "(no vision)" - nonsense for a state the node documents as a
      // working one - and because .is-blind is declared after .is-on at equal
      // specificity, its grey also beat the orange selected highlight, so the
      // most common state showed no selection at all.
      const vision = !mark || value === "" || looksVision(value);
      const ears = mark && value !== "" && looksAudio(value);
      const row = el("div", (value === current ? "is-on" : "") +
                            (vision ? "" : " is-blind") +
                            (ears ? " is-ears" : ""), label);
      // Marking matters more than it looks: every tokenizer in the chain ends
      // in **kwargs, so image= is accepted and IGNORED by a text-only model,
      // and .generate exists on the wrapper - so picking one is completely
      // silent and the node writes a confident caption for a picture the
      // model never saw.
      // A caller may supply its own hover text (the preset list uses it to say
      // which model each preset was measured with). Rows stay names-only -
      // secondary detail belongs in the title, not on the row (convention #27).
      row.title = hoverTitle || (vision ? label
        : label + "  -  does not look like a vision model, so it cannot see "
          + "pictures. Fine for a text step in a chain.");
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        closePop();
        onPick(value);
      });
      list.appendChild(row);
    }
  };

  if (values.length > 8) {
    filter = document.createElement("input");
    filter.type = "text";
    filter.className = "pix-app-popfilter";
    filter.placeholder = "Filter, e.g. vl 8b";
    filter.addEventListener("input", () => paint(filter.value));
    // Never let a keystroke reach the canvas: ComfyUI binds single letters to
    // commands, so typing "b" here would otherwise also toggle bypass.
    filter.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); closePop(); }
    });
    pop.appendChild(filter);
  }
  pop.appendChild(list);
  paint("");
  document.body.appendChild(pop);
  if (filter) setTimeout(() => filter.focus(), 0);

  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(window.innerWidth - pop.offsetWidth - 6, r.left)) + "px";
  pop.style.width = Math.max(r.width, 200) + "px";
  const below = window.innerHeight - r.bottom;
  if (below > pop.offsetHeight + 8 || below > r.top) pop.style.top = r.bottom + 3 + "px";
  else pop.style.top = Math.max(6, r.top - pop.offsetHeight - 3) + "px";
  POP = pop;
}

// ---------------------------------------------------------------------------
// Full-screen text box. Used for the formula here AND for the idea from the
// node face, so there is one editor rather than two that drift apart.
// ---------------------------------------------------------------------------
let EDITOR = null;
function closeEditor() {
  // Release the Escape listener HERE, not inside the key handler. Removing it
  // only on the Escape path leaves it bound after Cancel / Save / a backdrop
  // click - and because it is window+capture and calls stopPropagation, each
  // leaked one swallows the next Escape press for the whole app.
  try { EDITOR?._pixEscOff?.(); } catch (e) { /* already gone */ }
  EDITOR?.remove();
  EDITOR = null;
}

// ---------------------------------------------------------------------------
// A themed one-line question. REPLACES window.prompt, which was reported as
// "the save button doesn't work, in both renderers" (2026-08-16).
//
// Two independent ways the native dialog produced that report, both measured:
//  1. Electron (ComfyUI Desktop) does not implement window.prompt AT ALL - it
//     returns without ever showing anything, so `name` is empty, the handler
//     hits `if (!name) return` and the click does nothing with no feedback.
//     (alert and confirm ARE implemented there, which is why only prompt moved.)
//  2. Even where it works, the box opens EMPTY on a default-titled node, so
//     pressing Enter - the natural thing to do - silently cancels.
// #10 already records one false "doesn't seem to do much" report on this node
// caused by a native dialog; this is the same trap through a different door.
// ---------------------------------------------------------------------------
let ASKER = null;
function closeAsk() {
  try { ASKER?._pixEscOff?.(); } catch (e) { /* already gone */ }
  ASKER?.remove();
  ASKER = null;
}

export function askName(title, message, initial) {
  injectCSS();
  closeAsk();
  return new Promise((resolve) => {
    let settled = false;
    // Cancel, Escape and the backdrop can all fire for one dismissal, and a
    // second resolve would be silently ignored - but closeAsk() would then run
    // against whatever dialog is current, which could be a NEWER one.
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (ASKER === back) closeAsk();
      resolve(val);
    };
    const back = el("div", "pix-ape-back pix-apk-back");
    const box = el("div", "pix-apk");
    const head = el("div", "pix-ape-head");
    head.append(el("b", null, title));
    const msg = el("div", "pix-apk-msg", message || "");
    const input = el("input", "pix-apk-in");
    input.type = "text";
    input.value = initial || "";
    const foot = el("div", "pix-ape-foot");
    const cancel = el("button", "pix-app-btn", "Cancel");
    const ok = el("button", "pix-app-btn is-on", "Save");
    foot.append(cancel, ok);
    box.append(head, msg, input, foot);
    back.appendChild(box);

    // An empty box means "I changed my mind", same as Cancel - never a preset
    // literally called "".
    const accept = () => finish(input.value.trim() || null);
    cancel.addEventListener("click", () => finish(null));
    ok.addEventListener("click", accept);
    back.addEventListener("mousedown", (e) => { if (e.target === back) finish(null); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); accept(); }
    });
    // Same reasoning as the editor's: released in closeAsk, not on the Escape
    // path, or a Cancel leaves a window+capture listener that eats the next
    // Escape for the whole app.
    const esc = (e) => {
      if (e.key !== "Escape" || ASKER !== back) return;
      e.stopPropagation();
      finish(null);
    };
    window.addEventListener("keydown", esc, true);
    back._pixEscOff = () => window.removeEventListener("keydown", esc, true);

    document.body.appendChild(back);
    ASKER = back;
    input.focus();
    input.select();
  });
}

export function openEditor(title, text, onSave, opts) {
  injectCSS();
  closeEditor();
  const back = el("div", "pix-ape-back");
  const box = el("div", "pix-ape");
  const head = el("div", "pix-ape-head");
  const cnt = el("span", "cnt", "");
  head.append(el("b", null, title), cnt, el("span", "sp"));
  const ta = el("textarea");
  ta.value = text || "";
  ta.spellcheck = opts?.spellcheck === true;
  back._pixOwner = opts?.owner || null;

  const foot = el("div", "pix-ape-foot");
  const cancel = el("button", "pix-app-btn", "Cancel");
  const save = el("button", "pix-app-btn is-on", "Save");
  foot.append(cancel, save);
  box.append(head, ta, foot);
  back.appendChild(box);

  const count = () => {
    const n = ta.value.length;
    cnt.textContent = n.toLocaleString() + (n === 1 ? " character" : " characters");
  };
  count();
  ta.addEventListener("input", count);

  // Close THIS editor, not whatever is current: a slow save that resolves
  // after the user has opened a different one would otherwise close that one
  // and throw away their typing.
  const done = () => { if (EDITOR === back) closeEditor(); };
  cancel.addEventListener("click", done);
  back.addEventListener("mousedown", (e) => { if (e.target === back) done(); });
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    save.disabled = true;
    save.textContent = "Saving...";
    const ok = await onSave(ta.value);
    if (!ok) { save.textContent = "Save failed"; save.disabled = false; return; }
    done();
  });
  const esc = (e) => {
    if (e.key !== "Escape" || EDITOR !== back) return;
    e.stopPropagation();
    done();
  };
  window.addEventListener("keydown", esc, true);
  back._pixEscOff = () => window.removeEventListener("keydown", esc, true);

  document.body.appendChild(back);
  EDITOR = back;
  ta.focus();
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
let PANEL = null;
let PANEL_NODE = null;
let ON_CHANGE = null;
let USER_MOVED = false;
let CP_HANDLE = null;
let MODELS = { ok: true, models: [], error: null };
// ok starts FALSE: it means "a read has succeeded at least once", not "this
// object is fine".
let PRESETS = { ok: false, shipped: [], user: [], userError: false };

// Whether the LATEST attempt failed, which PRESETS.ok cannot tell you: once a
// good list is being kept on purpose, PRESETS.ok stays true no matter how many
// reads fail afterwards. So the panel needs its own signal to admit that what
// it is showing may be out of date, otherwise "keep the last good list" is
// just a quieter way of lying.
let PRESETS_STALE = false;

export function panelIsOpenFor(node) {
  return !!PANEL && PANEL_NODE === node;
}

export function closeAIPromptPanelFor(node) {
  // The idea editor opens from the node FACE, so it can be up with no panel at
  // all - in which case the early return below would leave a full-screen box
  // belonging to a node that no longer exists.
  if (node && EDITOR && EDITOR._pixOwner === node) closeEditor();
  if (node && PANEL_NODE !== node) return;
  closePop();
  closeEditor();
  try { CP_HANDLE?.close?.(); } catch (e) { /* already gone */ }
  CP_HANDLE = null;
  try { PANEL?._pixCleanup?.(); } catch (e) { /* already gone */ }
  // COMMIT a half-typed number before the panel goes. The numeric fields
  // commit on change/blur, and Chrome fires NEITHER when a focused element is
  // removed from the document - and outsideClose runs on capture-phase
  // pointerdown, before the browser moves focus. So typing 0.9 into TOP P and
  // clicking the canvas silently threw the value away.
  try {
    const active = document.activeElement;
    if (active && PANEL && PANEL.contains(active) && typeof active.blur === "function") {
      active.blur();
    }
  } catch (e) { /* not fatal */ }
  PANEL?.remove();
  PANEL = null;
  PANEL_NODE = null;
  ON_CHANGE = null;
  // Reset on CLOSE, never on open, or one dragged panel teaches every later
  // one to sit still where the node is not.
  USER_MOVED = false;
}

function outsideClose(e) {
  if (!PANEL) return;
  if (POP && !POP.contains(e.target) && !e.target?.closest?.(".pix-app-pick")) {
    closePop();
  }
  if (PANEL.contains(e.target)) return;
  // These live on <body> too and this guard is capture-phase, so it runs
  // before their own handlers. Without the exemptions, picking a colour or an
  // option dismisses the panel underneath (node-settings-accent invariant 3).
  // .pix-ap-gear is exempt for a different reason: it is what OPENS the panel,
  // and this fires on pointerdown while the button acts on click - so without
  // it the press closes and the click reopens, and the toggle looks dead.
  if (e.target?.closest?.(
    ".pix-app-pop, .pix-ape-back, .pix-ap-gear, .pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop"
  )) return;
  closeAIPromptPanelFor(null);
}

/** Zoom or pan the canvas and the PANEL moves, because it follows its node -
 *  but a popup lives on <body> and does not, so it was left hanging in mid-air
 *  over the graph, pointing at nothing. Reported after the placement fix, which
 *  is what made it obvious: the panel now moves further and more often.
 *
 *  It CLOSES rather than re-places, which is what every other Pixaroma popup
 *  does on a wheel (Load Image pattern #14): a list re-anchored mid-zoom under
 *  a moving cursor is its own kind of wrong, and the pick is one click away.
 *
 *  Scrolling INSIDE the popup is exempt, or a long model list could never be
 *  scrolled - that exact guard is the one Load Image's pattern calls out. */
function wheelClose(e) {
  if (!POP || POP.contains(e.target)) return;
  closePop();
}

function escClose(e) {
  if (e.key !== "Escape" || !PANEL) return;
  if (EDITOR) return;                     // the editor handles its own Escape
  // Close the DROPDOWN first. This handler is on document with capture, so it
  // runs before the event reaches the filter input inside the popup - whose
  // own Escape branch could otherwise never fire, and pressing Escape while
  // filtering models would dismiss the whole panel.
  if (POP) { e.stopPropagation(); closePop(); return; }
  e.stopPropagation();
  closeAIPromptPanelFor(null);
}

function changed(node) {
  ON_CHANGE?.(node);
}

/** Re-query the live body rather than repainting a captured one.
 *  Every open builds a FRESH body, so a captured reference is detached the
 *  moment the panel is closed and reopened - and a "is a panel open for this
 *  node" guard says yes in exactly that case (video-prompt.md #20). */
export function refreshAIPromptPanel(node) {
  if (!panelIsOpenFor(node)) return;
  const body = PANEL?.querySelector(".pix-app-body");
  if (body) renderPanel(node, body);
}

function numField(node, label, key, opts) {
  const wrap = el("div", "pix-app-num");
  const tag = el("em", null, label);
  const input = document.createElement("input");
  input.type = "text";
  // An <input> carries an intrinsic ~20-character width from its default size
  // attribute, which is what stopped the row shrinking to fit the panel.
  input.size = 1;
  const st = readState(node);
  const show = (v) => (opts?.int ? String(Math.trunc(v)) : String(v));
  input.value = show(st[key]);
  input.title = opts?.title || "";
  const commit = () => {
    const raw = parseFloat(input.value);
    if (Number.isFinite(raw)) {
      writeState(node, { [key]: opts?.int ? Math.trunc(raw) : raw });
      changed(node);
    }
    // Re-read so a clamped value shows immediately instead of leaving the
    // typed-but-rejected number sitting in the box.
    input.value = show(readState(node)[key]);
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => e.stopPropagation());
  wrap.append(tag, input);
  return wrap;
}

function toggleRow(label, on, onFlip, title) {
  const row = el("div", "pix-app-tog");
  const sw = el("span", "pix-app-sw" + (on ? " is-on" : ""));
  sw.appendChild(el("i"));
  row.append(sw, el("span", null, label));
  if (title) row.title = title;
  row.addEventListener("click", () => onFlip(!on));
  return row;
}

function pickRow(label, onOpen, opts) {
  const row = el("div", "pix-app-pick" + (opts?.locked ? " is-locked" : ""));
  const v = el("span", "v" + (opts?.none ? " none" : ""), label);
  row.append(v, el("span", "c", "▼"));
  if (opts?.title) row.title = opts.title;
  if (!opts?.locked) row.addEventListener("click", () => onOpen(row));
  return row;
}

/** Every preset the picker knows about, shipped first. */
function allPresets() {
  return PRESETS.shipped.concat(PRESETS.user);
}

/**
 * Re-read the list after a change, publishing ONLY a successful read.
 *
 * fetchPresets never rejects - it resolves { ok:false, shipped:[], user:[] } -
 * so assigning it unconditionally turned a momentary server hiccup into "every
 * preset you have, the shipped ones included, just disappeared", right after
 * an action the user took. The panel then reads "No presets yet" and offers
 * "Presets that ship with Pixaroma will appear here", which is a flat lie that
 * heals only on the next open. An empty library and a failed read must never
 * look identical. MODELS.ok was already checked this way; this was the odd one
 * out, and two reviewers found it independently.
 */
async function refreshPresets() {
  const next = await fetchPresets();
  PRESETS_STALE = !next.ok;
  if (next.ok) PRESETS = next;
  return next;
}

/** The preset a node is currently running, found by matching the formula, so
 *  it survives a reload and a duplicate with nothing extra stored. */
function loadedPreset(node) {
  const formula = readState(node).formula;
  return allPresets().find((p) => p.formula === formula) || null;
}

/** This node's whole recipe: the wording AND the settings that make it work. */
function currentRecipe(node) {
  const st = readState(node);
  const settings = {};
  for (const key of SETTING_KEYS) settings[key] = st[key];
  const known = loadedPreset(node);
  return {
    name: known?.name
      || (node?.title && node.title !== "AI Prompt Pixaroma" ? node.title : ""),
    note: known?.note || "",
    // A model that arrived on a wire belongs to the loader the user placed, not
    // to this recipe, so it is never written into the file.
    model: slotConnected(node, "clip") ? "" : st.model,
    settings,
    formula: st.formula,
  };
}

/** Label restore that caches the ORIGINAL once - a second click inside the
 *  window otherwise captures "Copied" as the original and the button reads it
 *  for the rest of the session. Copied from ui.mjs's flash, which learned it. */
function flashLabel(button, label) {
  if (!button) return;
  clearTimeout(button._pixFlashT);
  if (button._pixFlashOrig == null) button._pixFlashOrig = button.textContent;
  button.textContent = label;
  button._pixFlashT = setTimeout(() => {
    if (button._pixFlashOrig != null) button.textContent = button._pixFlashOrig;
  }, 900);
}

/** True if the text reached the clipboard.
 *
 *  navigator.clipboard is absent on a plain http LAN address, which is exactly
 *  how a lot of people reach their own ComfyUI, so the old execCommand path is
 *  a real fallback here and not legacy clutter (Seed Pixaroma made the same
 *  call for the same reason). */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to the old way */ }
  const ta = document.createElement("textarea");
  try {
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand("copy");
  } catch (e) {
    return false;
  } finally {
    // Removed even when select() or execCommand throws - and this branch only
    // runs on the old browsers and plain-http LAN addresses where they DO
    // throw. Left in the document it keeps focus and a selection, so every
    // later keystroke lands in an invisible box and ComfyUI's single-letter
    // shortcuts quietly stop working, with nothing on screen to explain it.
    ta.remove();
  }
}

/** Clipboard text, or null when the browser will not give it to us. There is
 *  no execCommand fallback for READING, so the caller must say so plainly and
 *  point at the file route instead of failing silently. */
async function readClipboard() {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch (e) {
    return null;
  }
}

/**
 * Put a recipe onto a node, from a file or a paste.
 *
 * A file with no header is a plain formula, exactly as Import always behaved,
 * so nothing that worked before stops working.
 */
async function applyRecipeText(node, raw, sourceName) {
  const recipe = parseRecipe(raw);
  if (!recipe.formula.trim()) {
    window.alert("There is nothing to import from " + sourceName + ".");
    return;
  }

  const hasSettings = Object.keys(recipe.settings).length > 0;
  const label = recipe.name ? "“" + recipe.name + "”" : sourceName;
  const known = allPresets().some(
    (p) => p.name.toLowerCase() === recipe.name.toLowerCase());
  // ...and the same guard on import: `known` is computed from the in-memory
  // list, so against a list that never loaded a recipe named after an existing
  // preset reads as new, the confirm promises it will be ADDED, and the server
  // replaces the real one. The recipe still lands on the node either way.
  const willSave = recipe.hadHeader && !!recipe.name && !known && PRESETS.ok;

  // Import KEEPS its confirm where Clear lost one: this replaces writing the
  // user did, and an unconfirmed import was a reported bug on Video Prompt.
  // The wording names everything that is about to change, so one dialog is
  // enough - including the fact that it joins their presets.
  if (readState(node).formula.trim()) {
    const what = hasSettings ? "formula and sampling settings" : "formula";
    if (!window.confirm(
      "Replace this node's " + what + " with " + label + "?"
      + (willSave ? "\n\nIt will also be added to your presets." : ""))) return;
  }

  const patch = { formula: recipe.formula };
  for (const key of SETTING_KEYS) {
    if (key in recipe.settings) patch[key] = recipe.settings[key];
  }
  // Same rule as loading a preset: a named model is applied only when it is
  // actually here and nothing is on the clip wire. Never point a node at a
  // file that does not exist on this machine.
  if (recipe.model && !slotConnected(node, "clip")
      && MODELS.models.includes(recipe.model)) {
    patch.model = recipe.model;
  }
  writeState(node, patch);
  changed(node);

  // Keeping it is the obvious intent for a recipe somebody deliberately
  // imported, and it is also what makes the model line appear: that line keys
  // off the preset list, so an unsaved import would explain nothing. Skipped
  // when the name is already taken, so the list can never show two identical
  // names - Save current is there for deliberately making a variant.
  if (willSave) {
    const res = await savePreset({
      name: recipe.name,
      note: recipe.note,
      model_hint: recipe.model,
      formula: recipe.formula,
      settings: recipe.settings,
    });
    // The confirm PROMISED this would join their presets. Swallowing the
    // failure leaves that promise broken silently, and quietly costs them the
    // model line, which reads off the preset list. Worded so it cannot be
    // mistaken for the import itself failing - that part already succeeded.
    if (!res.ok) {
      window.alert("The recipe is on the node, but it could not be added to "
        + "your presets.\n\n" + (res.message || ""));
    }
    // AWAITED. Without it the re-render one line down paints from the list as
    // it was BEFORE the save, so the preset just added is missing from the
    // picker and the model line it exists to feed never appears - and it
    // lands silently a moment later, with nothing on screen changing.
    await refreshPresets();
  }
  refreshAIPromptPanel(node);
}

function renderPanel(node, body) {
  body.replaceChildren();
  const st = readState(node);
  const clipWired = slotConnected(node, "clip");

  const set = (patch) => {
    writeState(node, patch);
    changed(node);
    renderPanel(node, body);
  };

  // ---- MODEL ---------------------------------------------------------------
  body.appendChild(el("div", "pix-app-sec", "Model"));
  const modelLabel = clipWired
    ? "Using the model on the clip wire"
    : (st.model || "None — pick one, or wire a clip");
  const modelRow = pickRow(modelLabel, (anchor) => {
    const values = [["", "None — pass text through"]]
      .concat(MODELS.models.map((m) => [m, m]));
    openPop(anchor, values, st.model, (v) => set({ model: v }));
  }, {
    locked: clipWired,
    none: !clipWired && !st.model,
    title: clipWired
      ? "A model is wired into the clip input, so it is used instead of this."
      : "Which model writes the text. Leave it as None and the node passes "
        + "your text straight through.",
  });
  body.appendChild(modelRow);

  if (!MODELS.ok) {
    body.appendChild(el("div", "pix-app-note",
      "Could not read your text_encoders folder, so this list may be incomplete."));
  } else if (clipWired) {
    body.appendChild(el("div", "pix-app-note plain",
      "Free VRAM is skipped while a model is wired in — that one belongs to the "
      + "node feeding it, so it is not this node's to unload."));
  } else if (!st.model) {
    body.appendChild(el("div", "pix-app-note",
      "Nothing chosen, so this node passes its text straight through. That is a "
      + "working state, not an error."));
  } else if (!MODELS.models.includes(st.model)) {
    body.appendChild(el("div", "pix-app-note",
      "\"" + st.model + "\" is not in your text_encoders folder. The node will "
      + "stop with a message until you pick one that is."));
  } else if (!looksVision(st.model)) {
    body.appendChild(el("div", "pix-app-note",
      "That does not look like a vision model, so it cannot see pictures. Fine "
      + "for a text step, wrong for an image one."));
  }

  // ---- MODEL SETTINGS ------------------------------------------------------
  body.appendChild(el("div", "pix-app-sec", "Model settings"));
  const nums = el("div", "pix-app-nums");
  nums.append(
    numField(node, "TEMP", "temperature", {
      title: "How adventurous the writing is. 0.7 is the default; lower is "
        + "steadier, higher is wilder.",
    }),
    numField(node, "MAX LEN", "max_length", {
      int: true,
      title: "The most tokens it may write. 512 is plenty for a prompt.",
    }),
  );
  body.appendChild(nums);

  // The disclosure and the Reset share one line, so neither costs a row.
  const advRow = el("div", "pix-app-row");
  const adv = el("div", "pix-app-adv",
    (node._pixApAdvOpen ? "▼" : "▶") + " Advanced sampling");
  adv.addEventListener("click", () => {
    node._pixApAdvOpen = !node._pixApAdvOpen;
    renderPanel(node, body);
  });
  // "Changed" means different from the node's own defaults, so the button is
  // dead until there is genuinely something to undo - which is also how the
  // user can see at a glance whether anything has been fiddled with.
  const drifted = SETTING_KEYS.filter((k) => st[k] !== DEFAULT_STATE[k]);
  const reset = el("button", "pix-app-btn", "Reset");
  reset.style.flex = "0 0 auto";
  reset.disabled = !drifted.length;
  reset.title = drifted.length
    ? "Put the sampling settings back to the defaults. Changed: "
      + drifted.join(", ") + ". The formula is left alone."
    : "The sampling settings are already at their defaults.";
  reset.addEventListener("click", () => {
    const patch = {};
    for (const key of SETTING_KEYS) patch[key] = DEFAULT_STATE[key];
    set(patch);
  });
  advRow.append(adv, el("span", "cnt", drifted.length ? drifted.length + " changed" : ""), reset);
  body.appendChild(advRow);

  if (node._pixApAdvOpen) {
    const r1 = el("div", "pix-app-nums");
    r1.append(
      numField(node, "TOP K", "top_k", { int: true, title: "How many candidate words it may choose from." }),
      numField(node, "TOP P", "top_p", { title: "Keeps only the likeliest words that add up to this share." }),
    );
    const r2 = el("div", "pix-app-nums");
    r2.append(
      numField(node, "MIN P", "min_p", { title: "Throws away words below this share of the best one." }),
      numField(node, "REP", "repetition_penalty", { title: "Higher discourages repeating itself." }),
    );
    const r3 = el("div", "pix-app-nums");
    r3.append(
      numField(node, "PRESENCE", "presence_penalty", { title: "Higher pushes it towards new subjects." }),
    );
    // The odd one out needs a partner or it stretches to the full width and
    // breaks the column the rows above it establish. The partner is an
    // IDENTICAL hidden field, not a bare div: a plain spacer left the real
    // field 10px wider, and neither box-sizing nor a shorter label fixed it -
    // two elements with the same class and the same content shape are the only
    // way to be sure the flex maths matches the rows that already line up.
    const spacer = el("div", "pix-app-num");
    spacer.style.visibility = "hidden";
    spacer.setAttribute("aria-hidden", "true");
    spacer.append(el("em", null, "REP"), document.createElement("input"));
    r3.appendChild(spacer);
    body.append(r1, r2, r3);
    body.appendChild(toggleRow("Sampling on", st.do_sample,
      (v) => set({ do_sample: v }),
      "Off makes it always pick the likeliest next word, so the same input "
      + "gives the same answer and the seed stops mattering."));
  }

  // ---- FORMULA -------------------------------------------------------------
  body.appendChild(el("div", "pix-app-sec", "Formula"));
  const preview = el("div", "pix-app-form" + (st.formula.trim() ? "" : " empty"),
    st.formula.trim()
      ? st.formula
      : "Empty. Press Edit and write the instruction this node should always "
        + "follow, for example: describe this photo as a short video prompt.");
  if (st.formula.trim()) {
    preview.title = "Scroll to read the whole thing, and select from it to copy. "
      + "Press Edit for the full-screen editor.";
  }
  body.appendChild(preview);

  const frow = el("div", "pix-app-row");
  const edit = el("button", "pix-app-btn is-on", "Edit");
  edit.title = "Write or change this node's instruction.";
  edit.addEventListener("click", () => {
    openEditor("Formula — " + (node.title || "AI Prompt"), readState(node).formula,
      (text) => {
        writeState(node, { formula: text });
        changed(node);
        refreshAIPromptPanel(node);
        return true;
      }, { spellcheck: false, owner: node });
  });

  // Export and Import carry the WHOLE recipe - the wording, the settings that
  // make it work, and the model it was measured with - because a formula
  // without its temperature is half a recipe and lands as something that looks
  // broken. The file is still readable text, so it can be pasted into a chat
  // message and read by somebody who does not have this plugin.
  const exp = el("button", "pix-app-btn", "Export");
  exp.title = "Save this recipe, or copy it ready to paste into a message. "
            + "It carries the formula, the settings and the model it was written for.";
  exp.disabled = !st.formula.trim();
  exp.addEventListener("click", () => {
    openPop(exp, [
      ["file", "Save as a file",
       "Writes a .txt you can keep, back up or send to somebody."],
      ["clip", "Copy to clipboard",
       "Puts the whole recipe on the clipboard as text, ready to paste into "
       + "Discord or a message."],
    ], null, async (which) => {
      const recipe = currentRecipe(node);
      const text = formatRecipe(recipe);
      if (which === "clip") {
        flashLabel(exp, await copyText(text) ? "Copied" : "Could not copy");
        return;
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = recipeFileStem(recipe.name, node?.title) + ".txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, { markVision: false });
  });

  const imp = el("button", "pix-app-btn", "Import");
  imp.title = "Load a recipe from a file or from something you have copied. "
            + "A plain .txt with no header still loads as the formula.";
  imp.addEventListener("click", () => {
    openPop(imp, [
      ["file", "Open a file", "Load a recipe or a plain formula from a .txt."],
      ["clip", "Paste from clipboard",
       "Load a recipe somebody sent you, straight from the clipboard."],
    ], null, async (which) => {
      if (which === "clip") {
        const text = await readClipboard();
        if (text == null) {
          // Honest about WHY: there is no fallback for reading a clipboard, and
          // this is the common case on a plain http LAN address.
          window.alert("This browser will not let a page read the clipboard "
            + "here. Save the recipe as a .txt and use Open a file instead.");
          return;
        }
        applyRecipeText(node, text, "the clipboard");
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".txt,.md,text/plain";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          applyRecipeText(node, await file.text(), file.name);
        } catch (e) {
          window.alert("Could not read that file.");
        }
      });
      input.click();
    }, { markVision: false });
  });

  const clear = el("button", "pix-app-btn", "Clear");
  clear.title = "Empty this node's formula, so it sends only your idea.";
  clear.disabled = !st.formula.trim();
  // INSTANT, no confirm - node UI convention #2, the same call Text Pixaroma
  // and Prompt Pack made. A confirm on a Clear is a sign the label is wrong,
  // not that a dialog is needed; and here the dialog was actively harmful,
  // because a native confirm is easy to dismiss without noticing, which made
  // a button that works look like a button that does nothing. Undo is Ctrl+Z,
  // and Export exists for anything worth keeping.
  clear.addEventListener("click", () => set({ formula: "" }));

  frow.append(edit, exp, imp, clear);
  frow.appendChild(el("span", "cnt", st.formula.length.toLocaleString()));
  body.appendChild(frow);

  // ---- PRESETS -------------------------------------------------------------
  // A preset is the formula AND the settings that make it work. Shipping the
  // Krea 2 wording without temperature 0.3 would ship something that reads as
  // broken, because the same words ramble and invent objects at 0.7.
  body.appendChild(el("div", "pix-app-sec", "Presets"));
  const all = allPresets();

  // The row shows the preset that is on the node, so reopening the panel tells
  // you what you are looking at without having to remember.
  const loaded = loadedPreset(node);
  body.appendChild(pickRow(
    loaded ? loaded.name : (all.length ? "Load a preset…" : "No presets yet"),
    (anchor) => {
      // Each row carries its model in the hover, so you can see what a preset
      // was measured with BEFORE you load it, without cluttering the list.
      const rows = all.map((p, i) => [p.name, p.name,
        p.name
        // Which of the two kinds this is, because "where did my preset go" and
        // "does my friend already have this one" are the same question asked
        // from either end, and the list itself cannot show it. By INDEX rather
        // than by name: shipped ones come first, so this stays correct even if
        // a user preset somehow shares a name with one.
        + (i < PRESETS.shipped.length
             ? "\nShips with Pixaroma" : "\nYour own preset")
        + (p.model_hint ? "\nMeasured with " + p.model_hint
                                 + (MODELS.models.includes(p.model_hint)
                                    ? " (you have it)" : " (you do NOT have it)")
                               : "\nNo model recorded")
        + (p.settings && p.settings.temperature != null
           ? "\nTemperature " + p.settings.temperature : "")
        + (p.note ? "\n\n" + p.note : "")]);
      openPop(anchor, rows, loaded ? loaded.name : null, (name) => {
        const preset = all.find((p) => p.name === name);
        if (!preset) return;
        // A dialog earns its place only when something would be LOST. Switching
        // away from a preset you have not edited loses nothing - the preset is
        // still in the list, one click away - so asking there is pure friction,
        // and a native confirm on a harmless action is exactly how a working
        // control comes to look broken. That is the Clear button's lesson two
        // rows up, reported by the user twice: once on Clear, and again as
        // "why can I not select the image preset". Wording you actually wrote
        // still gets the question.
        const current = readState(node).formula;
        const yourOwnWriting = current.trim() && !loadedPreset(node);
        if (yourOwnWriting &&
            !window.confirm("Replace this node's formula with \"" + name + "\"?")) return;
        const patch = { formula: preset.formula };
        // The user's choice: the wording alone, or the whole recipe.
        if (node._pixApPresetSettings !== false && preset.settings) {
          for (const key of SETTING_KEYS) {
            if (key in preset.settings) patch[key] = preset.settings[key];
          }
        }
        // A model hint is APPLIED when that file is actually here, and never
        // over a wired clip. When it is missing the panel SAYS so, on the line
        // under the picker, rather than popping a dialog - a preset shared from
        // another machine must not silently point this node at a model that
        // does not exist, but it must not nag either.
        const hint = preset.model_hint;
        if (hint && !slotConnected(node, "clip") && MODELS.models.includes(hint)) {
          patch.model = hint;
        }
        set(patch);
      }, { markVision: false });
    },
    { title: "Load a saved formula, with the settings it was measured at. "
             + "Hover a name to see which model it was written for." },
  ));

  const withSettings = node._pixApPresetSettings !== false;
  body.appendChild(toggleRow("Bring its settings too", withSettings,
    (v) => { node._pixApPresetSettings = v; renderPanel(node, body); },
    "On, a preset also sets temperature and the sampling values it was measured "
    + "at. Off, only the formula text is loaded and your own settings stay."));

  const prow = el("div", "pix-app-row");
  const saveBtn = el("button", "pix-app-btn", "Save current");
  // Refused while no read has EVER succeeded, and this is data loss, not
  // tidiness. Both guards below test the in-memory list: the shipped-name
  // check and the "you already have one called that" confirm are equally
  // blind against an EMPTY list, while the SERVER is perfectly happy and
  // replaces by name on disk. So a first-open fetch failure turned Save
  // current into a silent overwrite of a preset the panel could not see.
  // PRESETS.ok means "a read has succeeded at least once" - it was added for
  // exactly this and then read by nothing, which is how the hole survived.
  saveBtn.title = PRESETS.ok
    ? "Save this node's formula and settings as a preset you can reuse."
    : "Your presets could not be read, so saving is held back until they can - "
      + "otherwise this could replace one without being able to warn you.";
  saveBtn.disabled = !st.formula.trim() || !PRESETS.ok;
  saveBtn.addEventListener("click", async () => {
    const recipe = currentRecipe(node);
    // Tweaking a shipped preset and keeping it is the common case, so the name
    // is offered ready-made rather than suggesting one that is then refused.
    const known = loadedPreset(node);
    const shipped = !!known && PRESETS.shipped.some((p) => p.name === known.name);
    // Never offer an EMPTY box. currentRecipe returns "" for an untouched node
    // title on purpose (nobody wants a preset called "AI Prompt Pixaroma"), but
    // handing that to the dialog means Enter saves nothing and looks broken.
    const suggested = shipped ? recipe.name + " (mine)"
      : (recipe.name || "My formula");
    // The ONE overwrite that may pass without a question: re-saving the preset
    // you currently have loaded, and only when it is your own. Keying this on
    // the SUGGESTED STRING was wrong twice over, and both holes were real
    // silent loss. "<name> (mine)" is a name WE invent, so someone who already
    // owned "Krea 2 (mine)" lost it by pressing Enter; and the suggestion
    // falls back to the node TITLE, so a node renamed "My style" replaced an
    // unrelated preset called "My style". Identity, never a string we built.
    const quiet = known && !shipped ? known.name.toLowerCase() : null;
    let name = (await askName("Save preset",
      "Save this formula and its settings as:", suggested) || "").trim();
    if (!name) return;
    // A shipped preset cannot be replaced, so its name would put two
    // identical-looking rows in the list. Offer the name that WOULD work
    // rather than refusing into a dead end: the old alert sent you back with
    // nothing saved and nothing to click, and it fired most often on the very
    // case it was meant to help - an edited shipped preset, whose formula no
    // longer matches, so the prefill was empty and people typed the original.
    if (PRESETS.shipped.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      name = (await askName("That name is taken",
        "Pixaroma already ships a preset called “" + name
        + "”, and those cannot be replaced. Save yours as:",
        name + " (mine)") || "").trim();
      if (!name || PRESETS.shipped.some(
        (p) => p.name.toLowerCase() === name.toLowerCase())) return;
    }
    // Overwriting one of YOUR OWN presets is real loss: it is a file on disk,
    // so Ctrl+Z cannot bring it back, and Delete asks before doing exactly the
    // same damage. Saving under the name that was offered IS the deliberate
    // "update this preset" path, so that one stays quiet - which keeps this
    // from reintroducing the friction just removed from Clear and the picker.
    if (name.toLowerCase() !== quiet
        && PRESETS.user.some((p) => p.name.toLowerCase() === name.toLowerCase())
        && !window.confirm("You already have a preset called “" + name
          + "”. Replace it?")) return;
    const res = await savePreset({
      name,
      note: recipe.note,
      formula: recipe.formula,
      settings: recipe.settings,
      model_hint: recipe.model,
    });
    if (!res.ok) {
      // Re-read BEFORE the alert. A refusal usually means the file went
      // unreadable underneath us, and returning early left the panel still
      // listing presets the server can no longer read - teaching the user
      // "the list is fine, only saving is broken", which is the opposite of
      // true. This is what makes the amber note reachable when it matters.
      await refreshPresets();
      refreshAIPromptPanel(node);
      window.alert(res.message || "Could not save that preset.");
      return;
    }
    await refreshPresets();
    refreshAIPromptPanel(node);
  });

  const delBtn = el("button", "pix-app-btn", "Delete");
  delBtn.title = PRESETS.userError
    // Otherwise this flatly contradicts the amber note directly below it: the
    // user's presets exist, they just could not be read.
    ? "Your own presets could not be read, so they cannot be listed."
    : (PRESETS.user.length
      ? "Delete one of your own presets. The ones that ship with Pixaroma stay."
      : "You have no presets of your own yet.");
  delBtn.disabled = !PRESETS.user.length;
  delBtn.addEventListener("click", () => {
    openPop(delBtn, PRESETS.user.map((p) => [p.name, p.name]), null, async (name) => {
      if (!window.confirm("Delete your preset \"" + name + "\"?")) return;
      const res = await deletePreset(name);
      if (!res.ok) {
        await refreshPresets();          // same reason as Save current above
        refreshAIPromptPanel(node);
        window.alert(res.message || "Could not delete that preset.");
        return;
      }
      await refreshPresets();
      refreshAIPromptPanel(node);
    }, { markVision: false });
  });

  prow.append(saveBtn, delBtn);
  body.appendChild(prow);

  // ONE line about the loaded preset, not two. It answers the only question
  // worth answering here - which model this recipe was written for, and
  // whether that is what is about to run - and goes amber only when those
  // disagree in a way that will change the result.
  if (loaded) {
    const hint = loaded.model_hint;
    const wired = slotConnected(node, "clip");
    let line = "";
    let warn = false;
    if (!hint) {
      line = "No model was recorded with this preset.";
    } else if (wired) {
      line = "Written for " + hint + ". Your wired model is being used instead.";
    } else if (!MODELS.models.includes(hint)) {
      line = "Written for " + hint + ", which you do not have. Your own model "
           + "was left alone, so results may differ.";
      warn = true;
    } else if (st.model !== hint) {
      line = "Written for " + hint + ", but this node is set to "
           + (st.model || "none") + ".";
      warn = true;
    } else {
      line = "Written for " + hint + ", which is what this node is using.";
    }
    const note = el("div", "pix-app-note" + (warn ? "" : " plain"), line);
    // The preset's own description stays as hover text rather than a second
    // paragraph - it is background, not something you need on every open.
    if (loaded.note) note.title = loaded.note;
    body.appendChild(note);
  } else if (!all.length) {
    body.appendChild(el("div", "pix-app-note plain",
      "Presets that ship with Pixaroma will appear here."));
  }

  // Amber, and never silent: your own presets are still on disk, the file just
  // could not be read. Saving is refused while this is true rather than
  // overwriting a file we do not understand, so say why before you try.
  if (PRESETS.userError) {
    body.appendChild(el("div", "pix-app-note",
      "Your own presets could not be read, so only the ones that ship with "
      + "Pixaroma are listed. Nothing has been lost: saving is refused until "
      + "the file is readable again. It is ai_prompt_presets.json in "
      + "ComfyUI/user/pixaroma."));
  } else if (PRESETS_STALE) {
    // The list itself could not be fetched. Without this the panel presents an
    // empty library as a healthy one, which is indistinguishable from a fresh
    // install - and on a FIRST open there is no earlier list to fall back to,
    // so the guard alone cannot cover it.
    body.appendChild(el("div", "pix-app-note",
      "The preset list could not be read from the server, so what is shown "
      + "here may be out of date. Saving is best left until it comes back."));
  }

  // ---- WIRED TEXT ----------------------------------------------------------
  body.appendChild(el("div", "pix-app-sec", "Wired text"));
  const orderLabels = { [ORDER_IDEA]: "My idea first", [ORDER_WIRED]: "Wired text first" };
  body.appendChild(pickRow(orderLabels[st.order], (anchor) => {
    openPop(anchor, [[ORDER_IDEA, orderLabels[ORDER_IDEA]], [ORDER_WIRED, orderLabels[ORDER_WIRED]]],
      st.order, (v) => set({ order: v }), { markVision: false });
  }, {
    title: "Which comes first when text is wired in. The segment on the node "
      + "changes it too - this is where the node starts.",
  }));
  const sepLabel = (SEP_OPTIONS.find(([k]) => k === st.sep) || SEP_OPTIONS[0])[1];
  body.appendChild(pickRow("Separator — " + sepLabel.toLowerCase(), (anchor) => {
    openPop(anchor, SEP_OPTIONS, st.sep, (v) => set({ sep: v }), { markVision: false });
  }, { title: "What goes between your idea and the wired text." }));

  // ---- BEHAVIOUR -----------------------------------------------------------
  body.appendChild(el("div", "pix-app-sec", "Behaviour"));
  body.appendChild(toggleRow("Use the model's own template", st.use_default_template,
    (v) => set({ use_default_template: v }),
    "Most chat models have a built-in wrapper that tells them they are "
    + "answering a question. Off sends your words completely raw."));
  body.appendChild(toggleRow("Thinking mode, if the model has one", st.thinking,
    (v) => set({ thinking: v }),
    "Some models reason first and answer second. Slower, and not every model "
    + "supports it."));

  // ---- accent --------------------------------------------------------------
  body.appendChild(createAccentSection(node, {
    onChange: () => changed(node),
    onPickerOpen: (handle) => { CP_HANDLE = handle; },
  }));
}

export async function openAIPromptPanel(node, onChange) {
  injectCSS();
  if (PANEL && PANEL_NODE === node) { closeAIPromptPanelFor(node); return; }
  closeAIPromptPanelFor(null);
  PANEL_NODE = node;
  ON_CHANGE = onChange;

  const panel = el("div", "pix-app");
  const head = el("div", "pix-app-head");
  head.append(el("span", null, "AI Prompt settings"));
  const x = el("button", "pix-app-x", "✕");
  x.addEventListener("click", () => closeAIPromptPanelFor(null));
  head.appendChild(x);
  const body = el("div", "pix-app-body");
  panel.append(head, body);
  document.body.appendChild(panel);
  PANEL = panel;

  placeBeside(panel, getNodeScreenRect(node));
  // ignoreSelector is NOT optional: makeDraggable preventDefaults and takes
  // pointer capture on pointerdown, so without it the ✕ inside the handle
  // never receives its click and the one control that exists to close the
  // panel does nothing.
  makeDraggable(panel, head, {
    onUserMove: () => { USER_MOVED = true; },
    ignoreSelector: ".pix-app-x",
  });
  followNode(panel, node, {
    isCurrent: () => PANEL === panel && PANEL_NODE === node,
    isUserMoved: () => USER_MOVED,
  });
  // deferred so the click that OPENED the panel does not immediately close it
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
  // Land it in a LOCAL first and publish only after the staleness guard.
  // Writing the module singleton before the check let a slow request for a
  // closed panel clobber the list a newer panel had already rendered from, so
  // the next re-render in that newer panel showed the older node's models.
  const [fetched, presets] = await Promise.all([fetchModels(), fetchPresets()]);
  if (PANEL !== panel) return;
  MODELS = fetched;
  // Same guard as refreshPresets, and this was the site that kept the bug: a
  // failed read here wiped a list that had been good, so the panel offered
  // "No presets yet" AND both name-collision guards went blind, because they
  // test against a list that is now empty. Keeping the last good list is the
  // deliberate trade - a stale list beats a confident lie.
  PRESETS_STALE = !presets.ok;
  if (presets.ok) PRESETS = presets;
  renderPanel(node, body);
  // Place it AGAIN now the content is in. The placement above ran while the
  // body still said "Loading..." and the panel was 78px tall, so it was
  // clamped against the wrong height and the finished panel hung off the
  // bottom of the screen. followNode notices and corrects it, but only on its
  // next frame, and this panel fills after a network round trip - so without
  // this the user sees the panel jump. Belt and braces on the slowest path.
  if (!USER_MOVED) placeBeside(panel, getNodeScreenRect(node));
}
