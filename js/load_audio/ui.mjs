// Load Audio Pixaroma - the node face.
//
// Convention #12 for the labelled number field, #13 for the interaction states
// (hover = accent border, never a fill), #14 for the file picker (our dark
// popup, never a native <select>), #27 for sizing that popup with the canvas
// zoom, and #20 for the drag.

import { ACC, accentOf } from "../shared/node_settings.mjs";
import { canvasBackingScale } from "../shared/nodes2.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { WAVE_H, fmtTime, readState, writeState } from "./core.mjs";
import { audioFileUrl, listAudioFiles, uploadAudio } from "./api.mjs";
import { drawWave, forgetPeaks, loadPeaks, makePlayer } from "./waveform.mjs";

const ROOT = "pix-la-root";
let _cssDone = false;
let _popup = null;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT}{
    box-sizing:border-box; width:100%; height:100%; display:flex; flex-direction:column;
    gap:5px; padding:0 8px 4px; font:12px 'Segoe UI',sans-serif; color:#ddd;
    background:transparent; overflow:hidden;
  }
  .${ROOT} .row{ display:flex; gap:6px; align-items:stretch; }
  .${ROOT} .file{
    flex:1; min-width:0; box-sizing:border-box; display:flex; align-items:center;
    justify-content:space-between; gap:6px; background:#1d1d1d; border:1px solid #444;
    border-radius:4px; padding:5px 8px; cursor:pointer; color:#ddd; font-size:11px;
  }
  .${ROOT} .file:hover{ border-color:${ACC}; color:#fff; }
  .${ROOT} .file .nm{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .${ROOT} .file .ar{ color:${ACC}; font-size:9px; flex:none; }
  .${ROOT} .btn{
    box-sizing:border-box; background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.14); border-radius:4px;
    color:rgba(255,255,255,0.65); font-size:11px; padding:5px 9px; cursor:pointer;
    user-select:none; flex:none;
  }
  .${ROOT} .btn:hover{ border-color:${ACC}; color:#fff; }
  /* Convention #28: the BUNDLED gear svg as a mask, never the emoji. An emoji
     is drawn by the operating system, so it is a different shape on Windows,
     Mac and Linux and sits on its own baseline. */
  .${ROOT} .gear{ display:flex; align-items:center; justify-content:center; padding:5px 7px; }
  .${ROOT} .gear::before{
    content:""; display:block; width:14px; height:14px; background:#bbb;
    -webkit-mask:url(${pixAsset("icons/note/gear.svg")}) center/contain no-repeat;
    mask:url(${pixAsset("icons/note/gear.svg")}) center/contain no-repeat;
  }
  .${ROOT} .gear:hover::before{ background:${ACC}; }
  .${ROOT} .wavebox{
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:6px;
    display:flex; flex-direction:column; gap:4px; flex:1 1 auto; min-height:0;
  }
  .${ROOT} .wave{
    width:100%; flex:1 1 auto; min-height:${WAVE_H}px; display:block;
    cursor:ew-resize; touch-action:none;
  }
  .${ROOT} .times{ display:flex; justify-content:space-between; font-size:10px; color:#777; }
  .${ROOT} .times .sel{ color:${ACC}; }
  .${ROOT} .num{
    box-sizing:border-box; display:flex; align-items:center; justify-content:space-between;
    background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:5px 8px; min-height:26px;
  }
  .${ROOT} .num:focus-within{ border-color:${ACC}; }
  .${ROOT} .num .lb{ font-size:11px; letter-spacing:.4px; color:${ACC}; }
  .${ROOT} .num .rt{ display:flex; align-items:center; gap:7px; }
  .${ROOT} .num input{
    width:64px; background:none; border:none; outline:none; text-align:right;
    color:${ACC}; font:12px 'Segoe UI',sans-serif; line-height:1.2;
  }
  .${ROOT} .spin{ display:flex; flex-direction:column; line-height:.85; align-self:stretch;
    justify-content:center; }
  .${ROOT} .spin b{ font-size:8px; color:${ACC}; cursor:pointer; font-weight:400; }
  .${ROOT} .spin b:hover{ filter:brightness(1.4); }
  .${ROOT} .out{
    background:rgba(0,0,0,0.25); border-radius:4px; padding:5px 8px; font-size:11px;
    color:#aaa; line-height:1.5; display:flex; align-items:center; gap:7px;
  }
  .${ROOT} .out .play{
    flex:none; width:0; height:0; border-style:solid; border-width:5px 0 5px 8px;
    border-color:transparent transparent transparent ${ACC}; cursor:pointer;
  }
  .${ROOT} .out .stop{
    flex:none; width:9px; height:9px; background:${ACC}; cursor:pointer; border-radius:1px;
  }
  .${ROOT} .out .tx{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .${ROOT} .out .warn{ color:#f2b134; }
  .${ROOT} .out .bad{ color:#e05252; }

  .pix-la-pop{
    position:fixed; z-index:10900; background:#232323; border:1px solid #555;
    border-radius:6px; box-shadow:0 10px 30px rgba(0,0,0,0.5); overflow:auto;
    font-family:'Segoe UI',sans-serif; padding:0.25em 0;
  }
  .pix-la-pop .it{
    padding:0.4em 0.8em; cursor:pointer; font-size:1em; color:#ddd;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .pix-la-pop .it:hover{ background:#2f2f2f; }
  .pix-la-pop .it.on{ color:${ACC}; }
  .pix-la-pop .em{ padding:0.5em 0.8em; font-size:0.92em; color:#888; }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

export function closePopup() {
  try { _popup?.remove(); } catch (_e) { /* already gone */ }
  _popup = null;
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("wheel", onWheel, true);
  document.removeEventListener("keydown", onEsc, true);
}

function outside(e) {
  if (_popup && !_popup.contains(e.target)) closePopup();
}
function onWheel(e) {
  // Gate on containment or scrolling a long list closes it (Load Image #14).
  if (_popup && !_popup.contains(e.target)) closePopup();
}
function onEsc(e) {
  if (e.key === "Escape" && _popup) { e.stopPropagation(); closePopup(); }
}

async function openPicker(node, anchor, onPick) {
  closePopup();
  const pop = document.createElement("div");
  pop.className = "pix-la-pop";
  const loading = document.createElement("div");
  loading.className = "em";
  loading.textContent = "reading the input folder...";
  pop.appendChild(loading);
  document.body.appendChild(pop);
  _popup = pop;
  placeZoomedPopup(pop, anchor, { baseFontPx: 12, minWidthPx: 160 });
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("wheel", onWheel, true);
  document.addEventListener("keydown", onEsc, true);

  // Re-listed on EVERY open, so a file dropped into input/ shows up without
  // pressing R (which cannot reach a custom popup) or restarting.
  const { files, error } = await listAudioFiles();
  if (_popup !== pop) return;            // closed while we were waiting
  pop.textContent = "";
  if (error || !files.length) {
    const em = document.createElement("div");
    em.className = "em";
    em.textContent = error
      ? "could not read the input folder"
      : "no sound files in ComfyUI's input folder";
    pop.appendChild(em);
  } else {
    const cur = readState(node).file;
    for (const name of files) {
      const it = document.createElement("div");
      it.className = "it" + (name === cur ? " on" : "");
      it.textContent = name;
      it.title = name;
      it.addEventListener("click", () => { closePopup(); onPick(name); });
      pop.appendChild(it);
    }
  }
  placeZoomedPopup(pop, anchor, { baseFontPx: 12, minWidthPx: 160 });
}

/** The length of the window the face should DRAW, in seconds. */
function windowSeconds(node, st, duration) {
  // Only Python sees a wired duration, so before the first run there is nothing
  // truthful to draw but the fallback. `_pixLaRun` is runtime-only on purpose:
  // writing a run result to node.properties would flag a clean workflow
  // modified on every execution (Vue Compat #18).
  const wired = node?._pixLaRun?.wired ? node._pixLaRun.length : null;
  if (wired != null && wired > 0) return wired;
  if (st.whenUnwired === "length" && st.length > 0) return st.length;
  return Math.max(0, duration - st.start);
}

export function buildFace(node, openPanel) {
  injectCSS();
  const root = document.createElement("div");
  root.className = ROOT;

  const fileRow = document.createElement("div");
  fileRow.className = "row";
  const file = document.createElement("div");
  file.className = "file";
  const nm = document.createElement("span");
  nm.className = "nm";
  const ar = document.createElement("span");
  ar.className = "ar";
  ar.textContent = "▼";
  file.append(nm, ar);
  file.title = "Choose a sound file from ComfyUI's input folder";
  file.addEventListener("click", () => openPicker(node, file, (name) => {
    writeState(node, { file: name, start: 0 });
    node._pixLaDur = 0;
    renderFace(node);
  }));

  const up = document.createElement("div");
  up.className = "btn";
  up.textContent = "Upload";
  up.title = "Copy a sound file into ComfyUI's input folder";
  up.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "audio/*,.wav,.mp3,.flac,.ogg,.opus,.m4a,.aac,.aiff";
    inp.addEventListener("change", async () => {
      const f = inp.files?.[0];
      if (!f) return;
      nm.textContent = "uploading...";
      try {
        const name = await uploadAudio(f);
        // Same name, new bytes: the cached picture would be of the old file.
        forgetPeaks(name);
        writeState(node, { file: name, start: 0 });
        node._pixLaDur = 0;
      } catch (_e) {
        nm.textContent = "upload failed";
        return;
      }
      renderFace(node);
    });
    inp.click();
  });

  // The readout can say "length from settings", so there has to be a visible
  // way to reach them. Right-click worked but nothing advertised it.
  const gear = document.createElement("div");
  gear.className = "btn gear";
  gear.title = "Settings for this node";
  gear.addEventListener("click", (e) => { e.stopPropagation(); openPanel?.(node); });

  fileRow.append(file, up, gear);

  const wavebox = document.createElement("div");
  wavebox.className = "wavebox";
  const wave = document.createElement("canvas");
  wave.className = "wave";
  const times = document.createElement("div");
  times.className = "times";
  const tA = document.createElement("span");
  const tSel = document.createElement("span");
  tSel.className = "sel";
  const tB = document.createElement("span");
  times.append(tA, tSel, tB);
  wavebox.append(wave, times);

  const num = document.createElement("div");
  num.className = "num";
  const lb = document.createElement("span");
  lb.className = "lb";
  lb.textContent = "START AT";
  const rt = document.createElement("span");
  rt.className = "rt";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.title = "Where in the file the window begins, in seconds";
  const spin = document.createElement("span");
  spin.className = "spin";
  const upB = document.createElement("b");
  upB.textContent = "▲";
  const dnB = document.createElement("b");
  dnB.textContent = "▼";
  spin.append(upB, dnB);
  rt.append(inp, spin);
  num.append(lb, rt);

  const nudge = (by) => {
    const st = readState(node);
    writeState(node, { start: Math.max(0, Math.round((st.start + by) * 100) / 100) });
    renderFace(node);
  };
  upB.addEventListener("click", () => nudge(0.5));
  dnB.addEventListener("click", () => nudge(-0.5));
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();                       // or the canvas eats the typing
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
  });
  inp.addEventListener("change", () => {
    const v = parseFloat(inp.value);
    writeState(node, { start: Number.isFinite(v) ? Math.max(0, v) : 0 });
    renderFace(node);
  });

  const out = document.createElement("div");
  out.className = "out";
  const play = document.createElement("span");
  play.className = "play";
  play.title = "Play the selected part";
  const tx = document.createElement("span");
  tx.className = "tx";
  out.append(play, tx);
  play.addEventListener("click", () => togglePlay(node));

  root.append(fileRow, wavebox, num, out);

  node._pixLaEls = { root, nm, wave, tA, tSel, tB, inp, tx, play };
  node._pixLaDur = 0;
  attachDrag(node, wave);
  attachSettings(node, file, openPanel);

  // The canvas has to be repainted at whatever size it ACTUALLY ends up, and
  // node.onResize is not a reliable signal for a DOM widget (Vue Compat #13).
  // A ResizeObserver fires for every real size change whatever caused it: node
  // resize, workflow tab switch, and - the case that bit here - the wrapper
  // going from display:none back to visible when the node scrolls into view.
  try {
    const ro = new ResizeObserver(() => {
      if (wave.clientWidth <= 0) return;
      const st = readState(node);
      const c = node._pixLaPeaks;
      // SELF-HEAL: if a file is set but we have no picture of it, do the full
      // render (which decodes) rather than painting an empty box. That is the
      // state a node lands in after its element is rebuilt - a renderer flip or
      // a workflow tab switch - and without this it silently shows "click
      // Upload" for a file that is loaded perfectly well.
      // Safe from recursion: renderFace changes the canvas BACKING size, never
      // its CSS box, so it cannot re-trigger this observer.
      if (st.file && (!c || c.file !== st.file)) renderFace(node);
      else repaintWave(node);
    });
    ro.observe(wave);
    node._pixLaRO = ro;
  } catch (_e) { /* no ResizeObserver: the node still works, it just needs a nudge */ }

  return root;
}

/** Right-click the file row is a shortcut to the gear, like other nodes. */
function attachSettings(node, el, openPanel) {
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel?.(node);
  });
}

/** Drag anywhere on the waveform to move the window's start. */
function attachDrag(node, wave) {
  wave.addEventListener("pointerdown", (e) => {
    const dur = node._pixLaDur || 0;
    if (dur <= 0) return;
    e.stopPropagation();
    e.preventDefault();
    try { wave.setPointerCapture(e.pointerId); } catch (_x) { /* mouse only */ }

    const apply = (ev) => {
      const r = wave.getBoundingClientRect();
      if (!r.width) return;
      const frac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const st = readState(node);
      const len = windowSeconds(node, st, dur);
      // Grab the MIDDLE of the window, which is what the cursor is pointing at.
      const start = Math.max(0, Math.min(dur, frac * dur - len / 2));
      writeState(node, { start: Math.round(start * 100) / 100 });
      renderFace(node);
    };
    apply(e);

    const move = (mv) => {
      // Convention #20: a lost release must not leave the window following the
      // cursor forever. Synthetic events never reproduce it; real mice do.
      if (!(mv.buttons & 1)) { end(); return; }
      apply(mv);
    };
    const end = () => {
      wave.removeEventListener("pointermove", move);
      try { wave.releasePointerCapture(e.pointerId); } catch (_x) { /* fine */ }
    };
    wave.addEventListener("pointermove", move);
    wave.addEventListener("pointerup", end, { once: true });
    wave.addEventListener("pointercancel", end, { once: true });
    wave.addEventListener("lostpointercapture", end, { once: true });
  });
}

function togglePlay(node) {
  const els = node._pixLaEls;
  const st = readState(node);
  if (!els || !st.file) return;
  if (node._pixLaAudio) { stopPlay(node); return; }
  const el = makePlayer(audioFileUrl(st.file));
  node._pixLaAudio = el;
  const len = windowSeconds(node, st, node._pixLaDur || 0);
  el.currentTime = st.start;
  const stopAt = st.start + (len > 0 ? len : Infinity);
  const watch = () => { if (el.currentTime >= stopAt) stopPlay(node); };
  el.addEventListener("timeupdate", watch);
  el.addEventListener("ended", () => stopPlay(node));
  el.play().catch(() => stopPlay(node));
  els.play.className = "stop";
  els.play.title = "Stop";
}

export function stopPlay(node) {
  const el = node?._pixLaAudio;
  if (el) {
    try { el.pause(); el.src = ""; } catch (_e) { /* already torn down */ }
  }
  node._pixLaAudio = null;
  const els = node?._pixLaEls;
  if (els) { els.play.className = "play"; els.play.title = "Play the selected part"; }
}

/** Draw everything from what we already know. No fetching, no decoding. */
function paint(node, peaks, dur, error) {
  const els = node?._pixLaEls;
  // Guard on the ELEMENTS, NOT on isConnected: the first render comes from a
  // queueMicrotask in onNodeCreated, before ComfyUI has attached the widget
  // element, so an isConnected gate silently skips it. destroyFace nulls _els,
  // which is the real protection against painting into a dead widget.
  if (!els) return;
  const st = readState(node);
  node._pixLaDur = dur;

  const len = windowSeconds(node, st, dur);
  const sel = dur > 0 && len > 0
    ? { from: st.start / dur, to: Math.min(1, (st.start + len) / dur) }
    : null;
  // Pass the CSS size: canvasBackingScale caps the backing buffer against it,
  // and calling it bare lets a zoomed-in node allocate a needlessly huge canvas.
  drawWave(els.wave, peaks, sel, accentOf(node),
    canvasBackingScale(els.wave.clientWidth, els.wave.clientHeight));
  els.tA.textContent = dur > 0 ? "0:00" : "";
  els.tB.textContent = dur > 0 ? fmtTime(dur) : "";
  els.tSel.textContent = dur > 0 && len > 0
    ? `${fmtTime(st.start)} – ${fmtTime(Math.min(dur, st.start + len))}`
    : "";

  let text = "";
  let cls = "";
  if (error) { text = "could not read that file"; cls = "bad"; }
  // Name the BUTTON, not the action. "Pick a file" left people hunting for
  // where, when Upload was sitting right there unread.
  else if (!st.file) text = "click Upload, or choose a file above";
  else {
    const run = node._pixLaRun;
    const src = run?.wired ? "length from the wire" : (st.whenUnwired === "length"
      ? "length from settings" : "whole file from here");
    text = `taking ${len.toFixed(2)}s · ${src}`;
    if (dur > 0 && st.start + len > dur + 0.01) {
      text = `${len.toFixed(2)}s wanted, file ends first · `
        + (st.whenShort === "loop" ? "will loop" : "will pad with silence");
      cls = "warn";
    }
  }
  els.tx.textContent = text;
  els.tx.className = "tx " + cls;
}

/**
 * Repaint from the cached decode. This is what the ResizeObserver calls.
 *
 * It exists because node.onResize does NOT reliably fire for a DOM widget
 * (Vue Compat #13), and a canvas that was measured while its wrapper was
 * display:none keeps that size forever. ComfyUI hides the wrapper whenever the
 * node is off-screen or the canvas is zoomed well out, so "drop the node, pan
 * away, pan back" left a 2x2 canvas and an empty box - measured, not guessed.
 */
export function repaintWave(node) {
  const st = readState(node);
  const c = node?._pixLaPeaks;
  const fresh = c && c.file === st.file;
  paint(node, fresh ? c.peaks : null, fresh ? c.duration : 0, fresh ? c.error : false);
}

export function renderFace(node) {
  const els = node?._pixLaEls;
  if (!els) return;
  const st = readState(node);

  els.nm.textContent = st.file || "choose a sound file";
  els.nm.style.color = st.file ? "#ddd" : "rgba(255,255,255,0.45)";
  els.inp.value = st.start.toFixed(2);

  if (!st.file) { paint(node, null, 0, false); return; }

  // Draw what we already have first so a re-render never blanks the box, then
  // paint again when the decode lands.
  repaintWave(node);

  const token = (node._pixLaToken = (node._pixLaToken || 0) + 1);
  loadPeaks(st.file, audioFileUrl(st.file)).then((res) => {
    // A stale decode must not paint over a newer selection: pick file A then
    // quickly file B, and A's slower decode would otherwise land last. The
    // _pixLaEls check catches the node being deleted mid-decode.
    if (node._pixLaToken !== token || !node._pixLaEls) return;
    node._pixLaPeaks = { file: st.file, ...res };
    paint(node, res.peaks, res.duration, res.error);
  });
}

export function destroyFace(node) {
  stopPlay(node);
  closePopup();
  try { node?._pixLaRO?.disconnect(); } catch (_e) { /* already gone */ }
  if (node) {
    node._pixLaRO = null;
    node._pixLaEls = null;
    node._pixLaPeaks = null;
  }
}
