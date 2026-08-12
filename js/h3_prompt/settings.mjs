// Minimax H3 Prompt Pixaroma - the floating settings panel.
//
// One singleton panel, opened from the gear on the node face, the gear in the
// node selection toolbar, or the right-click entry. It follows its node as the
// canvas pans and zooms until the user drags it somewhere on purpose
// (convention #29); both that and the drag come from shared/node_panel.mjs, so
// the two bugs those carry fixes for are not re-rolled here.
//
// The formulas are edited in a FULLSCREEN editor, not in the panel: the longest
// is 12,299 characters and a 360px column would be miserable. The panel row is
// the index - name, character count, Edit, Reset.

import {
  createAccentSection, repaintAccent,
} from "../shared/node_settings.mjs";
import {
  followNode, getNodeScreenRect, makeDraggable, placeBeside,
} from "../shared/node_panel.mjs";
import { MODES, MODE_LABELS, readState, writeState } from "./core.mjs";
import { fetchAll, resetMode, saveDurations, saveFormula } from "./api.mjs";
import { cacheTiers } from "./ui.mjs";

let PANEL = null;
let PANEL_NODE = null;
let USER_MOVED = false;
let ON_CHANGE = null;
let DATA = { modes: {}, models: [] };

let _cssDone = false;
function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const style = document.createElement("style");
  style.id = "pixaroma-h3-panel-css";
  style.textContent = `
  .pix-h3p{
    position:fixed; z-index:1300; width:370px; max-height:82vh;
    display:flex; flex-direction:column;
    background:#2b2b2b; border:1px solid #555; border-radius:8px;
    box-shadow:0 8px 26px rgba(0,0,0,.45);
    font:12px 'Segoe UI', sans-serif; color:#ddd; overflow:hidden;
  }
  .pix-h3p *{ box-sizing:border-box; }
  .pix-h3p-head{
    display:flex; align-items:center; justify-content:space-between;
    padding:9px 12px; background:#333; border-bottom:1px solid #444;
    cursor:move; user-select:none; flex:none;
  }
  .pix-h3p-head span{ font-size:12px; color:#fff; }
  .pix-h3p-x{
    background:none; border:none; color:#999; cursor:pointer;
    font-size:15px; line-height:1; padding:0 2px;
  }
  .pix-h3p-x:hover{ color:#fff; }
  .pix-h3p-body{ padding:12px; overflow-y:auto; flex:1 1 auto; }
  .pix-h3p-sec{
    color:var(--pix-acc,#f66744); font-size:10px; letter-spacing:.5px;
    margin:0 0 7px;
  }
  .pix-h3p-sec:not(:first-child){ margin-top:14px; }
  .pix-h3p-row{
    display:flex; align-items:center; gap:8px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
    padding:7px 9px; margin-bottom:5px;
  }
  .pix-h3p-row.is-edited{ border-color:var(--pix-acc,#f66744); }
  .pix-h3p-row .name{ flex:1 1 auto; min-width:0; color:#ddd; font-size:11px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pix-h3p-row .cnt{ flex:none; color:#777; font-size:10px; }
  .pix-h3p-row.is-edited .cnt{ color:var(--pix-acc,#f66744); }
  .pix-h3p-icon{
    flex:none; width:15px; height:15px; padding:0; background:none;
    border:none; cursor:pointer; color:#aaa; font-size:12px; line-height:1;
  }
  .pix-h3p-icon:hover{ color:var(--pix-acc,#f66744); }
  .pix-h3p-icon:disabled{ color:#555; cursor:default; }

  .pix-h3p-pick{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px;
    padding:7px 9px; margin-bottom:6px; cursor:pointer;
  }
  .pix-h3p-pick:hover{ border-color:var(--pix-acc,#f66744); }
  .pix-h3p-pick .v{ flex:1 1 auto; min-width:0; color:#ccc; font-size:11px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pix-h3p-pick .c{ flex:none; color:var(--pix-acc,#f66744); font-size:9px; }
  .pix-h3p-missing{ color:#e08b6a; font-size:10px; margin:-2px 0 8px; }

  .pix-h3p-nums{ display:flex; gap:6px; margin-bottom:6px; }
  .pix-h3p-num{
    flex:1 1 0; min-width:0; display:flex; align-items:center; gap:6px;
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:5px 8px;
  }
  .pix-h3p-num label{ flex:none; color:var(--pix-acc,#f66744); font-size:10px; }
  .pix-h3p-num input{
    flex:1 1 auto; min-width:0; background:none; border:none; outline:none;
    color:#ccc; font:11px 'Segoe UI', sans-serif; text-align:right;
  }
  .pix-h3p-num:focus-within{ border-color:var(--pix-acc,#f66744); }

  .pix-h3p-adv{ color:#888; font-size:10px; cursor:pointer; user-select:none;
    margin-bottom:8px; }
  .pix-h3p-adv:hover{ color:#ccc; }

  .pix-h3p-tiers{ display:flex; gap:5px; flex-wrap:wrap; margin-bottom:6px; }
  .pix-h3p-tier{
    flex:1 1 60px; min-width:0; text-align:center; cursor:pointer;
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:6px 4px;
    color:#ddd; font:11px 'Segoe UI', sans-serif;
  }
  .pix-h3p-tier:hover{ border-color:var(--pix-acc,#f66744); }
  .pix-h3p-tier small{ display:block; color:#777; font-size:9px; margin-top:2px; }

  .pix-h3p-toggle{ display:flex; align-items:center; gap:8px; margin-bottom:6px;
    cursor:pointer; user-select:none; }
  .pix-h3p-sw{ flex:none; width:26px; height:14px; border-radius:7px;
    background:#444; position:relative; transition:background .12s; }
  .pix-h3p-sw i{ position:absolute; top:2px; left:2px; width:10px; height:10px;
    border-radius:50%; background:#888; transition:left .12s, background .12s; }
  .pix-h3p-toggle.is-on .pix-h3p-sw{ background:var(--pix-acc,#f66744); }
  .pix-h3p-toggle.is-on .pix-h3p-sw i{ left:14px; background:#fff; }
  .pix-h3p-toggle span{ color:#ccc; font-size:11px; }

  .pix-h3p-btns{ display:flex; gap:5px; flex-wrap:wrap; }
  .pix-h3p-btn{
    flex:1 1 auto; text-align:center; cursor:pointer;
    background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.15);
    border-radius:4px; padding:6px 8px; color:rgba(255,255,255,0.7);
    font:11px 'Segoe UI', sans-serif;
  }
  .pix-h3p-btn:hover{ background:var(--pix-acc,#f66744);
    border-color:var(--pix-acc,#f66744); color:#fff; }

  .pix-h3p-pop{
    position:fixed; z-index:1400; max-height:320px; overflow-y:auto;
    background:#1d1d1d; border:1px solid #555; border-radius:4px;
    box-shadow:0 6px 18px rgba(0,0,0,.5); padding:4px;
  }
  .pix-h3p-pop div{ padding:5px 9px; border-radius:3px; color:#ccc;
    font:11px 'Segoe UI', sans-serif; cursor:pointer;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pix-h3p-pop div:hover{ background:#2a2a2a; }
  .pix-h3p-pop div.is-on{ color:var(--pix-acc,#f66744); }

  /* Fullscreen formula editor */
  .pix-h3e-back{
    position:fixed; inset:0; z-index:1500; background:rgba(0,0,0,.72);
    display:flex; align-items:center; justify-content:center; padding:3vh 3vw;
  }
  .pix-h3e{
    display:flex; flex-direction:column; width:min(1100px,94vw); height:94vh;
    background:#2b2b2b; border:1px solid #555; border-radius:8px; overflow:hidden;
    font:12px 'Segoe UI', sans-serif;
  }
  .pix-h3e-head{ display:flex; align-items:center; gap:10px;
    padding:10px 14px; background:#333; border-bottom:1px solid #444; flex:none; }
  .pix-h3e-head b{ color:#fff; font-weight:400; font-size:13px; }
  .pix-h3e-head .cnt{ color:#777; font-size:11px; }
  .pix-h3e-head .sp{ flex:1 1 auto; }
  .pix-h3e textarea{
    flex:1 1 auto; margin:12px 14px; background:#1d1d1d; color:#ddd;
    border:1px solid #333; border-radius:4px; padding:10px 12px;
    font:12px/1.5 monospace; resize:none; outline:none;
  }
  .pix-h3e textarea:focus{ border-color:var(--pix-acc,#f66744); }
  .pix-h3e-foot{ display:flex; gap:6px; justify-content:flex-end;
    padding:0 14px 12px; flex:none; }
  `;
  document.head.appendChild(style);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------------------------------------------------------------------------
// A small dark dropdown. Never a native <select> - convention #14.
// ---------------------------------------------------------------------------
let POP = null;
function closePop() {
  POP?.remove();
  POP = null;
}
function openPop(anchor, values, current, onPick) {
  closePop();
  const pop = el("div", "pix-h3p-pop");
  if (!values.length) {
    const empty = el("div", null, "No text encoders found");
    empty.style.color = "#888";
    pop.appendChild(empty);
  }
  for (const v of values) {
    const row = el("div", v === current ? "is-on" : null, v);
    row.title = v;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      closePop();
      onPick(v);
    });
    pop.appendChild(row);
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(window.innerWidth - pop.offsetWidth - 6, r.left)) + "px";
  pop.style.width = Math.max(r.width, 200) + "px";
  const below = window.innerHeight - r.bottom;
  if (below > pop.offsetHeight + 8 || below > r.top) pop.style.top = r.bottom + 3 + "px";
  else pop.style.top = Math.max(6, r.top - pop.offsetHeight - 3) + "px";
  POP = pop;
}

// ---------------------------------------------------------------------------
// Fullscreen formula editor
// ---------------------------------------------------------------------------
let EDITOR = null;
function closeEditor() {
  EDITOR?.remove();
  EDITOR = null;
}

function openEditor(title, text, onSave) {
  closeEditor();
  const back = el("div", "pix-h3e-back");
  const box = el("div", "pix-h3e");
  const head = el("div", "pix-h3e-head");
  const name = el("b", null, title);
  const cnt = el("span", "cnt", "");
  head.append(name, cnt, el("span", "sp"));
  const ta = el("textarea");
  ta.value = text || "";
  ta.spellcheck = false;
  const foot = el("div", "pix-h3e-foot");
  const cancel = el("button", "pix-h3p-btn", "Cancel");
  cancel.style.flex = "0 0 auto";
  const save = el("button", "pix-h3p-btn", "Save");
  save.style.flex = "0 0 auto";
  foot.append(cancel, save);
  box.append(head, ta, foot);
  back.appendChild(box);

  const count = () => {
    cnt.textContent = ta.value.length.toLocaleString() + " characters";
  };
  count();
  ta.addEventListener("input", count);

  const done = () => { closeEditor(); };
  cancel.addEventListener("click", done);
  back.addEventListener("mousedown", (e) => { if (e.target === back) done(); });
  save.addEventListener("click", async () => {
    save.textContent = "Saving...";
    const ok = await onSave(ta.value);
    if (!ok) { save.textContent = "Save failed"; return; }
    done();
  });
  const esc = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    done();
    window.removeEventListener("keydown", esc, true);
  };
  window.addEventListener("keydown", esc, true);

  document.body.appendChild(back);
  EDITOR = back;
  ta.focus();
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function closeH3PanelFor(node) {
  if (node && PANEL_NODE !== node) return;
  closePop();
  closeEditor();
  // The document/window listeners are the leak that matters: a workflow load or
  // a node deletion closes the panel with no click, so removing them only on a
  // user-driven close orphans one pair per open.
  try { PANEL?._pixCleanup?.(); } catch (e) { /* already gone */ }
  PANEL?.remove();
  PANEL = null;
  PANEL_NODE = null;
  ON_CHANGE = null;
  // Reset on CLOSE, never on open: doing it on open would teach every new panel
  // to sit still wherever the last dragged one was.
  USER_MOVED = false;
}

function outsideClose(e) {
  if (!PANEL) return;
  // The colour picker and the shared option popup live on <body> too, and this
  // guard is capture-phase so it runs first. Without these exemptions picking a
  // colour dismisses the panel underneath it (node-settings-accent invariant 3).
  //
  // .pix-h3-gear is exempt for a different reason: it is what OPENS the panel,
  // and this handler runs on mousedown while the button acts on click. Without
  // the exemption the gear closed the panel and then immediately reopened it,
  // so clicking it a second time appeared to do nothing at all. Exempting it
  // here is exact - the gear's own handler decides - whereas suppressing the
  // reopen on a timer would guess, and would swallow a legitimate open when
  // somebody clicked the canvas and then the gear in quick succession.
  if (e.target?.closest?.(".pix-h3p, .pix-h3p-pop, .pix-h3e-back, .pix-h3-gear, .pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop")) {
    return;
  }
  closeH3PanelFor(null);
}

function escClose(e) {
  if (e.key !== "Escape" || !PANEL) return;
  if (EDITOR) return;                 // the editor handles its own Escape
  closeH3PanelFor(null);
}

function changed(node) {
  ON_CHANGE?.(node);
}

export async function openH3Panel(node, onChange) {
  injectCSS();
  if (PANEL && PANEL_NODE === node) { closeH3PanelFor(node); return; }
  closeH3PanelFor(null);
  PANEL_NODE = node;
  ON_CHANGE = onChange;

  const panel = el("div", "pix-h3p");
  const head = el("div", "pix-h3p-head");
  head.append(el("span", null, "Minimax H3 Prompt settings"));
  const x = el("button", "pix-h3p-x", "✕");
  x.addEventListener("click", () => closeH3PanelFor(null));
  head.appendChild(x);
  const body = el("div", "pix-h3p-body");
  panel.append(head, body);
  document.body.appendChild(panel);
  PANEL = panel;

  placeBeside(panel, getNodeScreenRect(node));
  // ignoreSelector is NOT optional when a control lives inside the drag handle.
  // makeDraggable calls preventDefault() and takes pointer capture on
  // pointerdown, so without this the ✕ never receives its click and the panel
  // cannot be closed by the one control that exists to close it. Save Image and
  // Save Video both pass their own close-button selector for the same reason.
  makeDraggable(panel, head, {
    onUserMove: () => { USER_MOVED = true; },
    ignoreSelector: ".pix-h3p-x",
  });
  followNode(panel, node, {
    isCurrent: () => PANEL === panel && PANEL_NODE === node,
    isUserMoved: () => USER_MOVED,
  });
  setTimeout(() => {
    document.addEventListener("mousedown", outsideClose, true);
    window.addEventListener("keydown", escClose, true);
  }, 0);
  panel._pixCleanup = () => {
    document.removeEventListener("mousedown", outsideClose, true);
    window.removeEventListener("keydown", escClose, true);
  };

  body.textContent = "Loading...";
  DATA = await fetchAll();
  // The panel may have been closed while the request was in flight.
  if (PANEL !== panel) return;
  for (const mode of MODES) {
    const names = (DATA.modes?.[mode]?.durations || []).map((t) => t.name);
    cacheTiers(mode, names);
  }
  renderPanel(node, body);
  changed(node);
}

function numField(label, value, onCommit, opts) {
  const wrap = el("div", "pix-h3p-num");
  wrap.append(el("label", null, label));
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(value);
  input.title = opts?.title || "";
  const commit = () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) { input.value = String(value); return; }
    onCommit(n);
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  wrap.appendChild(input);
  return wrap;
}

function toggleRow(label, on, onFlip, title) {
  const row = el("div", "pix-h3p-toggle" + (on ? " is-on" : ""));
  const sw = el("span", "pix-h3p-sw");
  sw.appendChild(document.createElement("i"));
  row.append(sw, el("span", null, label));
  if (title) row.title = title;
  row.addEventListener("click", () => onFlip(!on));
  return row;
}

function renderPanel(node, body) {
  body.replaceChildren();
  const st = readState(node);
  const set = (patch) => {
    writeState(node, patch);
    renderPanel(node, body);
    changed(node);
  };

  if (!DATA.ok) {
    const err = el("div", "pix-h3p-missing",
      "Could not reach the server, so the formulas cannot be shown. " +
      "The node will still run with whatever is on disk.");
    body.appendChild(err);
  }

  // ---- model -------------------------------------------------------------
  body.appendChild(el("div", "pix-h3p-sec", "MODEL"));
  const models = Array.isArray(DATA.models) ? DATA.models : [];
  const pick = el("div", "pix-h3p-pick");
  pick.append(el("span", "v", st.model), el("span", "c", "▼"));
  pick.title = st.model;
  pick.addEventListener("click", (e) => {
    e.stopPropagation();
    openPop(pick, models, st.model, (v) => set({ model: v }));
  });
  body.appendChild(pick);
  if (models.length && !models.includes(st.model)) {
    body.appendChild(el("div", "pix-h3p-missing",
      "That file is not in your text_encoders folder. Pick one from the list."));
  }

  const nums = el("div", "pix-h3p-nums");
  nums.append(
    numField("TEMP", st.temperature, (v) => set({ temperature: v }),
      { title: "0.3 is what these formulas were measured at. Higher makes the model paste the formula's own example words." }),
    numField("MAX LEN", st.max_length, (v) => set({ max_length: Math.trunc(v) }),
      { title: "Token budget for the answer. 512 is enough for every tier." }),
  );
  body.appendChild(nums);

  const adv = el("div", "pix-h3p-adv",
    (node._pixH3AdvOpen ? "▼" : "▶") + " Advanced sampling");
  adv.addEventListener("click", () => {
    node._pixH3AdvOpen = !node._pixH3AdvOpen;
    renderPanel(node, body);
  });
  body.appendChild(adv);
  if (node._pixH3AdvOpen) {
    const a = el("div", "pix-h3p-nums");
    a.append(
      numField("TOP K", st.top_k, (v) => set({ top_k: Math.trunc(v) })),
      numField("TOP P", st.top_p, (v) => set({ top_p: v })),
    );
    const b = el("div", "pix-h3p-nums");
    b.append(
      numField("MIN P", st.min_p, (v) => set({ min_p: v })),
      numField("REP", st.repetition_penalty, (v) => set({ repetition_penalty: v })),
    );
    body.append(a, b);
  }

  // ---- formulas ----------------------------------------------------------
  body.appendChild(el("div", "pix-h3p-sec", "FORMULAS"));
  for (const mode of MODES) {
    const info = DATA.modes?.[mode] || {};
    const row = el("div", "pix-h3p-row" + (info.edited ? " is-edited" : ""));
    row.append(el("span", "name", MODE_LABELS[mode] || mode));
    const chars = Number(info.chars) || 0;
    row.append(el("span", "cnt",
      chars.toLocaleString() + (info.edited ? " · edited" : "")));

    const edit = el("button", "pix-h3p-icon", "✎");
    edit.title = "Edit this formula";
    edit.disabled = !DATA.ok;
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor(MODE_LABELS[mode] || mode, info.formula || "", async (text) => {
        const ok = await saveFormula(mode, text);
        if (!ok) return false;
        DATA = await fetchAll();
        renderPanel(node, body);
        changed(node);
        return true;
      });
    });

    const reset = el("button", "pix-h3p-icon", "↺");
    reset.title = info.edited
      ? "Put the shipped formula back"
      : "This is the shipped formula";
    reset.disabled = !info.edited;
    reset.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!window.confirm("Put the shipped " + (MODE_LABELS[mode] || mode) +
        " formula back? Your edits to it are lost.")) return;
      await resetMode(mode);
      DATA = await fetchAll();
      for (const m of MODES) {
        cacheTiers(m, (DATA.modes?.[m]?.durations || []).map((t) => t.name));
      }
      renderPanel(node, body);
      changed(node);
    });

    row.append(edit, reset);
    body.appendChild(row);
  }

  // ---- duration tiers ----------------------------------------------------
  body.appendChild(el("div", "pix-h3p-sec", "DURATION TIERS"));
  const activeMode = MODES.includes(node._pixH3TierMode)
    ? node._pixH3TierMode
    : MODES[0];
  const modeRow = el("div", "pix-h3p-pick");
  modeRow.append(el("span", "v", MODE_LABELS[activeMode]), el("span", "c", "▼"));
  modeRow.title = "Which mode's tiers to edit";
  modeRow.addEventListener("click", (e) => {
    e.stopPropagation();
    openPop(modeRow, MODES.map((m) => MODE_LABELS[m]), MODE_LABELS[activeMode],
      (label) => {
        node._pixH3TierMode = MODES.find((m) => MODE_LABELS[m] === label) || MODES[0];
        renderPanel(node, body);
      });
  });
  body.appendChild(modeRow);

  const tiers = DATA.modes?.[activeMode]?.durations || [];
  const tierBox = el("div", "pix-h3p-tiers");
  tiers.forEach((tier, i) => {
    const chip = el("button", "pix-h3p-tier");
    chip.append(document.createTextNode(tier.name));
    // The WORD TARGET, not a line count. The checklist items inside a tier are
    // semicolon-separated inside one long sentence, so counting sentences gave
    // the same number for every tier and told you nothing. The word target is
    // the number that actually differs and the one that drives the result.
    const words = /about\s+(\d+)\s+words/i.exec(String(tier.value || ""));
    chip.appendChild(el("small", null,
      words ? "~" + words[1] + " words" : String(tier.value || "").length + " chars"));
    chip.title = "Edit the length block for " + tier.name;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor(MODE_LABELS[activeMode] + " · " + tier.name,
        tier.value || "", async (text) => {
          const next = tiers.map((t, j) => (j === i ? { ...t, value: text } : t));
          const ok = await saveDurations(activeMode, next);
          if (!ok) return false;
          DATA = await fetchAll();
          renderPanel(node, body);
          changed(node);
          return true;
        });
    });
    tierBox.appendChild(chip);
  });
  if (!tiers.length) {
    tierBox.appendChild(el("div", "pix-h3p-missing", "No tiers on disk."));
  }
  body.appendChild(tierBox);

  // ---- behaviour ---------------------------------------------------------
  body.appendChild(el("div", "pix-h3p-sec", "BEHAVIOUR"));
  body.appendChild(toggleRow(
    "Hint when 5s meets a speaking idea", st.speech_hint,
    (v) => set({ speech_hint: v }),
    "The 5 second tier reliably drops the spoken line. This marks it rather than blocking it.",
  ));
  body.appendChild(toggleRow(
    "Release the model after each run", st.release_model,
    (v) => set({ release_model: v }),
    "Frees the VRAM the text encoder holds. Leave it off unless you are short of memory: the next run has to load it again.",
  ));

  // ---- backup ------------------------------------------------------------
  body.appendChild(el("div", "pix-h3p-sec", "BACKUP"));
  const btns = el("div", "pix-h3p-btns");
  const exportBtn = el("button", "pix-h3p-btn", "Export");
  exportBtn.title = "Save every formula and tier to one file";
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const payload = { version: 1, modes: {} };
    for (const mode of MODES) {
      const info = DATA.modes?.[mode] || {};
      payload.modes[mode] = {
        formula: info.formula || "",
        durations: info.durations || [],
      };
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "minimax-h3-formulas.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  const importBtn = el("button", "pix-h3p-btn", "Import");
  importBtn.title = "Load formulas from a file";
  importBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      let payload = null;
      try {
        payload = JSON.parse(await file.text());
      } catch (err) {
        window.alert("That file is not a formula export.");
        return;
      }
      const incoming = payload?.modes;
      if (!incoming || typeof incoming !== "object") {
        window.alert("That file is not a formula export.");
        return;
      }
      for (const mode of MODES) {
        const m = incoming[mode];
        if (!m) continue;
        if (typeof m.formula === "string" && m.formula.trim()) {
          await saveFormula(mode, m.formula);
        }
        if (Array.isArray(m.durations) && m.durations.length) {
          await saveDurations(mode, m.durations);
        }
      }
      DATA = await fetchAll();
      for (const m of MODES) {
        cacheTiers(m, (DATA.modes?.[m]?.durations || []).map((t) => t.name));
      }
      renderPanel(node, body);
      changed(node);
    });
    input.click();
  });

  const resetAll = el("button", "pix-h3p-btn", "Reset all");
  resetAll.title = "Put every shipped formula and tier back";
  resetAll.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!window.confirm(
      "Put every shipped formula and tier back? All of your edits are lost.")) return;
    for (const mode of MODES) await resetMode(mode);
    DATA = await fetchAll();
    for (const m of MODES) {
      cacheTiers(m, (DATA.modes?.[m]?.durations || []).map((t) => t.name));
    }
    renderPanel(node, body);
    changed(node);
  });

  btns.append(exportBtn, importBtn, resetAll);
  body.appendChild(btns);

  // ---- accent ------------------------------------------------------------
  const accent = createAccentSection(node, {
    onChange: () => {
      repaintAccent(node);
      changed(node);
    },
  });
  if (accent) body.appendChild(accent);
}

/** True while this node's panel is the open one, so index.js can decide whether
 *  a repaint has anything to refresh. */
export function panelIsOpenFor(node) {
  return !!PANEL && PANEL_NODE === node;
}
