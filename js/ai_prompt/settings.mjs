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
    .pix-app-form { background:#191919; border:1px solid #343436; border-radius:4px;
      padding:8px 9px; font:11px monospace; line-height:1.5; color:#c2bfba;
      min-height:58px; max-height:96px; overflow:hidden; white-space:pre-wrap;
      overflow-wrap:anywhere; }
    .pix-app-form.empty { color:#5c5a57; }
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
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Dropdown. Never a native <select> - convention #14.
// ---------------------------------------------------------------------------
/** Mirror of the vision test people rely on: a filename with "vl" in it.
 *  Marked, never blocked - a renamed VL file is legitimate, and a text-only
 *  model is the RIGHT choice for a rewrite step in a chain. */
function looksVision(name) {
  return /vl/i.test(String(name || ""));
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
      const row = el("div", (value === current ? "is-on" : "") +
                            (vision ? "" : " is-blind"), label);
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
let PRESETS = { ok: true, shipped: [], user: [] };

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

function safeFileStem(node) {
  const raw = String(node?.title || "AI Prompt").trim() || "AI Prompt";
  const stem = raw.replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, "-").slice(0, 48);
  return (stem || "ai-prompt") + "-formula";
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

  const exp = el("button", "pix-app-btn", "Export");
  exp.title = "Save this formula as a plain .txt file.";
  exp.disabled = !st.formula.trim();
  exp.addEventListener("click", () => {
    // Plain text, not JSON: a formula is prose, so it should be readable and
    // pasteable by somebody who does not have this plugin.
    const blob = new Blob([readState(node).formula], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileStem(node) + ".txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  const imp = el("button", "pix-app-btn", "Import");
  imp.title = "Load a formula from a .txt file.";
  imp.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.md,text/plain";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Replacing something the user wrote deserves a question. Reset asks in
      // every other panel; Import did not, and that was a reported bug there.
      if (readState(node).formula.trim() &&
          !window.confirm("Replace this node's formula with the contents of "
            + file.name + "?")) return;
      try {
        const text = await file.text();
        writeState(node, { formula: text });
        changed(node);
        refreshAIPromptPanel(node);
      } catch (e) {
        window.alert("Could not read that file.");
      }
    });
    input.click();
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
  const all = PRESETS.shipped.concat(PRESETS.user);
  const userNames = new Set(PRESETS.user.map((p) => p.name.toLowerCase()));

  // The row shows the preset that is on the node, so reopening the panel tells
  // you what you are looking at without having to remember.
  const loaded = all.find((p) => p.formula === st.formula);
  body.appendChild(pickRow(
    loaded ? loaded.name : (all.length ? "Load a preset…" : "No presets yet"),
    (anchor) => {
      // Each row carries its model in the hover, so you can see what a preset
      // was measured with BEFORE you load it, without cluttering the list.
      const rows = all.map((p) => [p.name, p.name,
        p.name
        // Which of the two kinds this is, because "where did my preset go" and
        // "does my friend already have this one" are the same question asked
        // from either end, and the list itself cannot show it.
        + (userNames.has(p.name.toLowerCase())
             ? "\nYour own preset" : "\nShips with Pixaroma")
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
        if (readState(node).formula.trim() &&
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
  saveBtn.title = "Save this node's formula and settings as a preset you can reuse.";
  saveBtn.disabled = !st.formula.trim();
  saveBtn.addEventListener("click", async () => {
    const current = readState(node);
    const name = (window.prompt("Save this formula and its settings as:",
      node.title && node.title !== "AI Prompt Pixaroma" ? node.title : "") || "").trim();
    if (!name) return;
    const settings = {};
    for (const key of SETTING_KEYS) settings[key] = current[key];
    const res = await savePreset({
      name,
      formula: current.formula,
      settings,
      model_hint: slotConnected(node, "clip") ? "" : current.model,
    });
    if (!res.ok) { window.alert(res.message || "Could not save that preset."); return; }
    PRESETS = await fetchPresets();
    refreshAIPromptPanel(node);
  });

  const delBtn = el("button", "pix-app-btn", "Delete");
  delBtn.title = PRESETS.user.length
    ? "Delete one of your own presets. The ones that ship with Pixaroma stay."
    : "You have no presets of your own yet.";
  delBtn.disabled = !PRESETS.user.length;
  delBtn.addEventListener("click", () => {
    openPop(delBtn, PRESETS.user.map((p) => [p.name, p.name]), null, async (name) => {
      if (!window.confirm("Delete your preset \"" + name + "\"?")) return;
      const res = await deletePreset(name);
      if (!res.ok) { window.alert(res.message || "Could not delete that preset."); return; }
      PRESETS = await fetchPresets();
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
  }, 0);
  panel._pixCleanup = () => {
    document.removeEventListener("pointerdown", outsideClose, true);
    document.removeEventListener("keydown", escClose, true);
  };

  body.textContent = "Loading...";
  // Land it in a LOCAL first and publish only after the staleness guard.
  // Writing the module singleton before the check let a slow request for a
  // closed panel clobber the list a newer panel had already rendered from, so
  // the next re-render in that newer panel showed the older node's models.
  const [fetched, presets] = await Promise.all([fetchModels(), fetchPresets()]);
  if (PANEL !== panel) return;
  MODELS = fetched;
  PRESETS = presets;
  renderPanel(node, body);
}
