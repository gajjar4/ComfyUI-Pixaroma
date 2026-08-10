// Save Video Pixaroma - node wiring.
//
// Save Image Pixaroma's face married to Save Mp4's player. State lives on
// node.properties.saveVideoState and is injected into the hidden SaveVideoState
// input at graphToPrompt time (Vue Compat #9).
//
// Save Mp4 is untouched and stays the quick one; this is the full one.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import {
  applyAdaptiveCanvasOnly,
  isVueNodes,
  installResizeFloor,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeSettings, installNodeAccent } from "../shared/node_settings.mjs";
import { applyFilenameTokenRefs } from "../shared/filename_tokens.mjs";
import {
  COMFY_CLASS,
  HIDDEN_INPUT_NAME,
  STATE_PROP,
  LAST_RUN_PROP,
  DEFAULT_STATE,
  FORMATS,
  formatDef,
  visibleFormats,
  formatDuration,
  readState,
  writeState,
  normalizePath,
  resolveDateTokens,
  expandNativeTokens,
  cleanInputName,
  sanitizePrefixMirror,
} from "./state.mjs";
import { injectCSS, buildRoot, el } from "./ui.mjs";
import { buildPlayer, applyVideoEntry, showClipMissing, refreshBar, getLive, buildVideoUrl } from "./player.mjs";
import { openSettingsPanel, closeSettingsPanelFor } from "./settings.mjs";

// User-measured: 474 wide keeps the button row (3 actions + 2 pill groups) on
// one line, matching Save Image so the pair looks like a pair.
const MIN_W = 474;
const DEFAULT_W = 474;
const DEFAULT_H = 700;
const PLAYER_MIN = 150;

// ── node body FLOOR (fill model: the player grows with the node) ─────────────
// NO custom computeSize and no getMaxHeight, so the player absorbs all free
// height in both renderers and the node can still shrink. The player is counted
// at its MINIMUM rather than its grown height (Load Image's count-at-min trick),
// or the node could never be dragged smaller once a video loaded.
//
// TWO states LIE and must not be measured at all, both inherited from Save
// Image, which measured them and paid for it:
//  - root not laid out or unmounted -> every offsetHeight reads 0. addDOMWidget
//    defaults hideOnZoom:true, so the element is unmounted on any zoom-out.
//  - root with NO REAL WIDTH -> the button row wraps and the sum explodes. This
//    is the only mechanism found that can reach ~1800, and it is exactly what
//    was measured here before this guard existed: a round trip through
//    loadGraphData brought a saved 474x700 node back as 474x2030.
// In those states reuse the last good reading rather than inventing one.
//
// FLOOR_CAP makes an inflated value unreachable for EVERY consumer (getMinHeight,
// computeLayoutSize, the resize-floor pin) without having to know which fitter
// misfired. Safe by construction: the clamp can only LOWER the floor, and the
// floor reaches node.size only through grow-only paths, so it can never grow a
// node or rewrite a clean saved size.
//
// ⚠️ The width guard is deliberately a SMALL ABSOLUTE number, not something
// derived from MIN_W. MEASURED: in Nodes 2.0 the DOM-widget root is NARROWER
// than the node (a 474-wide node gives a 353-wide root, because the Vue body has
// its own chrome), so a `clientWidth < MIN_W - 40` test was true FOREVER there -
// measureFloor never measured, always returned the 320 cache, and the flex:1
// player collapsed to a 0x0 video with the control bar still showing. The cap
// below is what actually stops the runaway; this guard only has to reject a root
// that is not laid out at all.
const FLOOR_CAP = DEFAULT_H;
const MEASURABLE_MIN_W = 120;
function measureFloor(ui) {
  const inner = ui?.inner;
  if (!inner) return 320;
  const root = ui.root;
  if (!root || !root.isConnected || root.clientWidth < MEASURABLE_MIN_W) {
    return ui._pixSvFloorCache || 320;
  }
  let h = 0;
  let n = 0;
  for (const ch of inner.children) {
    let oh = ch.offsetHeight;
    if (oh <= 0) continue;
    if (ch === ui.savedSec) {
      // count the PLAYER at its minimum, not its grown height
      oh = oh - (ui.stage ? ui.stage.offsetHeight : 0) + PLAYER_MIN;
    }
    h += oh;
    n++;
  }
  if (n === 0) return ui._pixSvFloorCache || 320; // pre-attach placeholder
  h += 16; // inner vertical padding (8 + 8)
  h += (n - 1) * 10; // flex gaps
  const out = Math.min(Math.max(200, h), FLOOR_CAP);
  ui._pixSvFloorCache = out;
  return out;
}

const floorOf = (ui) => Math.round(measureFloor(ui) / 4) * 4;

// ── the live "Will save as" line ─────────────────────────────────────────────
function fpsOf(node) {
  const w = node.widgets?.find((x) => x.name === "fps");
  const v = parseFloat(w?.value);
  return isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : 24;
}

// The wired `name` input, resolved best-effort for the DISPLAY only - Python
// recomputes everything at save time, so a stale preview can never misname a
// file. `node.graph || app.graph` because app.graph holds only TOP-LEVEL nodes
// and this node may live inside a subgraph.
function resolveWiredName(node) {
  try {
    const slot = node.inputs?.find((i) => i.name === "name");
    if (!slot || slot.link == null) return "";
    const graph = node.graph || app.graph;
    let link = graph?.links?.[slot.link];
    if (!link && typeof graph?.links?.get === "function") link = graph.links.get(slot.link);
    if (!link) return "";
    const src = graph.getNodeById?.(link.origin_id);
    if (!src) return "";
    const w = src.widgets?.find((x) => typeof x.value === "string" && x.value);
    return cleanInputName(w?.value || "");
  } catch {
    return "";
  }
}

function cntKey(folder, name, digits) {
  // \x00 as a JS ESCAPE, never a raw control byte: a raw NUL makes ripgrep treat
  // the whole file as binary, so every future grep silently skips it - and the
  // Read tool still shows clean text, which hides it (save-image pattern #13h).
  return [folder || "", name || "", String(digits)].join("\x00");
}

function scheduleCounterFetch(node, folderRaw, nameWithExt, digits) {
  const key = cntKey(folderRaw, nameWithExt, digits);
  if (node._pixSvCntKey === key) return; // already fetched or in flight
  node._pixSvCntKey = key;
  clearTimeout(node._pixSvCntTimer);
  node._pixSvCntTimer = setTimeout(async () => {
    try {
      // Save Image's route, reused unchanged: it is generic over
      // folder/name/digits, so a second identical route would be pure
      // duplication. It mirrors the save-time folder-counter order too.
      const r = await fetch(
        pixApiUrl(
          "/pixaroma/api/save_image/next_counter?folder=" + encodeURIComponent(folderRaw) +
          "&name=" + encodeURIComponent(nameWithExt) +
          "&digits=" + encodeURIComponent(digits)
        )
      );
      const j = await r.json();
      if (node._pixSvCntKey !== key || !node._pixSvUI) return; // superseded
      node._pixSvCounterNum = (j && j.counter) || 1;
      node._pixSvCntResolved = (j && j.resolved) || "";
      node._pixSvCntResolvedFor = key;
      node._pixSvCntDenied = !!(j && j.denied);
      updatePreview(node);
    } catch {}
  }, 350);
}

function updatePreview(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  const st = readState(node);
  let s = String(st.pattern || DEFAULT_STATE.pattern);
  // function replacement so a wired name containing "$" patterns ($&, $$) is
  // inserted literally (JS string replacements interpret those)
  const wired = resolveWiredName(node);
  s = s.replace(/%input%/g, () => wired);
  s = resolveDateTokens(s);
  s = expandNativeTokens(s);
  s = applyFilenameTokenRefs(s); // %Seed Pixaroma.seed% and friends
  // fps is a live widget, so it can always resolve. frames and duration need
  // the batch size, which is only known after a run - before that they stay
  // visibly literal, exactly as %width% and %height% already do.
  s = s.replace(/%fps%/g, String(fpsOf(node)));
  const last = node._pixSvLastDims;
  if (last) {
    s = s
      .replace(/%width%/g, String(last.w))
      .replace(/%height%/g, String(last.h))
      .replace(/%frames%/g, String(last.frames))
      .replace(/%duration%/g, formatDuration(last.frames, fpsOf(node)));
  }
  s = s.replace(/%batch_num%/g, "0");
  // Shared mirror of the Python sanitizer, with this node's own fallback.
  s = sanitizePrefixMirror(s);
  if (!s) s = "Video_%counter%";

  const ext = formatDef(st.format).ext;
  const digits = Math.max(1, Math.min(8, parseInt(st.counterDigits, 10) || 3));
  scheduleCounterFetch(node, st.folder || "", s + ext, digits);
  let rel;
  if (node._pixSvCntResolved && node._pixSvCntResolvedFor === cntKey(st.folder || "", s + ext, digits)) {
    rel = node._pixSvCntResolved; // server-resolved (folder %counter% too)
  } else {
    const padded = String(node._pixSvCounterNum || 1).padStart(digits, "0");
    rel = s.replace(/%counter%/g, padded) + ext;
  }
  const folder = st.folder ? normalizePath(st.folder) : "";
  const display =
    (folder ? folder.replace(/\//g, "\\") : "…\\ComfyUI\\output") +
    "\\" +
    rel.split("/").filter(Boolean).join("\\");

  if (node._pixSvCntDenied && node._pixSvCntResolvedFor === cntKey(st.folder || "", s + ext, digits)) {
    ui.prevPath.textContent = "This folder is not approved - click Browse and pick it once";
    ui.prevPath.style.color = "#f66744";
    ui.prevPath.title =
      "Pixaroma only writes to ComfyUI's own folders and to folders you picked with " +
      "the Browse button. Pick this one once and it stays approved.";
  } else {
    ui.prevPath.textContent = display;
    ui.prevPath.style.color = "";
    ui.prevPath.title = display;
  }
}

// ── face sync ────────────────────────────────────────────────────────────────
function applyButtonVisibility(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  const st = readState(node);
  ui.btnOpen.style.display = st.showOpen === false ? "none" : "";
  ui.btnDownload.style.display = st.showDownload === false ? "none" : "";
  ui.btnFolder.style.display = st.showFolder === false ? "none" : "";
  const vis = visibleFormats(st);
  const active = formatDef(st.format);
  // Correct the STATE before painting, or hiding the active format leaves its
  // button on the face, unlit, until something else re-runs syncFace. The write
  // is the one thing in this DOM-only function that touches serialized state, so
  // it is gated on isGraphLoading (Vue Compat #18) - a workflow that arrives
  // with a hidden active format keeps it.
  if (!vis.some((v) => v.id === active.id) && !isGraphLoading()) {
    st.format = vis[0].id;
    writeState(node, st);
  }
  const activeId = formatDef(readState(node).format).id;
  let shown = 0;
  for (const f of FORMATS) {
    // the ACTIVE format's pill is always shown even when switched off, or
    // nothing on the face would say what you are saving as
    const on = st[f.key] !== false || f.id === activeId;
    ui.fmtBtns[f.id].style.display = on ? "" : "none";
    if (on) shown++;
  }
  // a one-option choice is not a choice - hide the whole group, the format is
  // still visible in the "Will save as" extension. Counts what is ACTUALLY on
  // screen, not the setting, or a forced-visible pill sits in a hidden group.
  ui.segFmt.style.display = shown > 1 ? "" : "none";
}

function syncFace(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  const st = readState(node);
  if (document.activeElement !== ui.folderInput) ui.folderInput.value = st.folder || "";
  if (document.activeElement !== ui.patternInput) ui.patternInput.value = st.pattern || "";
  const activeId = formatDef(st.format).id;
  for (const f of FORMATS) ui.fmtBtns[f.id].classList.toggle("on", f.id === activeId);
  ui.modeSave.classList.toggle("on", st.saveOnRun !== false);
  ui.modePreview.classList.toggle("on", st.saveOnRun === false);
  applyButtonVisibility(node);
  updateInfoLine(node);
}

function updateInfoLine(node) {
  const ui = node._pixSvUI;
  if (!ui) return;
  if (node._pixSvFlash) return;
  const s = node._pixSvSummary;
  ui.infoLine.textContent = s || "";
  ui.infoLine.title = node._pixSvFolderShown || "";
}

function flashStatus(node, text, ms = 2200) {
  const ui = node._pixSvUI;
  if (!ui) return;
  node._pixSvFlash = true;
  ui.infoLine.textContent = text;
  clearTimeout(node._pixSvFlashTimer);
  node._pixSvFlashTimer = setTimeout(() => {
    node._pixSvFlash = false;
    updateInfoLine(node);
  }, ms);
}

// ── fold ─────────────────────────────────────────────────────────────────────
// The height of the block that folding hides, measured from the LAYOUT (offsetTop
// is layout px, so this is zoom-immune in both renderers).
function settingsBlockH(ui) {
  if (!ui?.savedSec?.isConnected) return 0;
  const top = ui.topbar.offsetTop + ui.topbar.offsetHeight;
  return Math.max(0, ui.savedSec.offsetTop - top);
}

function setFoldDisplay(node, folded) {
  const ui = node._pixSvUI;
  const st = readState(node);
  const hideBar = folded && st.hideBarWhenFolded;
  ui.secFolder.style.display = folded ? "none" : "";
  ui.secName.style.display = folded ? "none" : "";
  ui.secBtns.style.display = hideBar ? "none" : "";
}

// DIRTY-ON-LOAD DISCIPLINE: with allowResize false this sets DOM display and the
// icon ONLY - it NEVER calls setSize or writeState. The resize happens only on a
// genuine user action, and even then is gated on isGraphLoading (Vue Compat #18).
function applyFold(node, allowResize) {
  const ui = node._pixSvUI;
  if (!ui?.inner?.isConnected) return;
  const st = readState(node);
  const folded = !!st.folded;
  const before = settingsBlockH(ui);
  const wasHidden = ui.secFolder.style.display === "none";
  setFoldDisplay(node, folded);
  ui.foldBtn.classList.toggle("folded", folded);
  ui.foldBtn.title = folded ? "Open the node back up" : "Fold the node down to just the video";
  const changing = wasHidden !== folded;
  if (allowResize && changing && !isGraphLoading()) {
    const after = settingsBlockH(ui);
    const delta = before - after;
    if (delta && node.setSize) {
      node.setSize([node.size[0], Math.max(120, node.size[1] - delta)]);
    }
    node.setDirtyCanvas?.(true, true);
  }
}

// ── run results ──────────────────────────────────────────────────────────────
// Which entry in a node's ui payload is our clip? Prefer our own key, then fall
// back to the standard `images` list, which carries the SAME entry when the save
// landed inside ComfyUI's folders. The fallback is what makes the player survive
// a HOST that relays only the ui keys it recognises and drops custom ones - there
// the file saves fine and the player just stays black, because the browser is
// never told the filename (save-mp4 pattern #9). Do NOT simplify this to one key.
function pickEntry(output) {
  const own = output?.pixaroma_save_video;
  if (own?.length) return own[0];
  const imgs = output?.images;
  if (!imgs?.length) return null;
  return imgs.find((e) => /^video\//.test(e?.format || "") || /\.mp4$/i.test(e?.filename || "")) || null;
}

function commitEntry(node, entry) {
  if (!node || !entry?.filename) return;
  node.properties = node.properties || {};
  node.properties[LAST_RUN_PROP] = {
    filename: entry.filename,
    subfolder: entry.subfolder || "",
    type: entry.type || "output",
    token: entry.token || "",
  };
  const st = entry._pixaroma_status;
  if (st) {
    node._pixSvLastDims = { w: st.w, h: st.h, frames: st.frames };
    node._pixSvFolderShown = st.folder || "";
    const bits = [`${st.w}x${st.h}`, `${st.frames} frames`, `${st.duration}s`];
    if (st.depth) bits.push(st.depth);
    bits.push(st.saved_to_disk ? "saved" : "preview only, not written to your folder");
    node._pixSvSummary = bits.join(" · ");
    if (st.note) node._pixSvSummary += ` · ${st.note}`;
    node._pixSvCntKey = null; // let the counter advance after a run
    updateInfoLine(node);
    updatePreview(node);
  }
  applyVideoEntry(node, entry);
}

// Restore after a Vue rebuild (workflow-tab switch). The clip is persisted on
// node.properties because a runtime node._xxx field is torn down by the switch.
// On a fresh add the <video> is not mounted yet when onNodeCreated/onConfigure
// run, so retry on animation frames until it exists.
function restoreLastRun(node, tries = 0) {
  if (tries === 0) {
    if (node._pixSvRestoring) return; // serialise the two kicks
    node._pixSvRestoring = true;
  }
  if (getLive(node)) {
    node._pixSvRestoring = false;
    const entry = node.properties?.[LAST_RUN_PROP];
    if (entry?.filename) applyVideoEntry(node, entry);
    else refreshBar(node);
    return;
  }
  if (tries > 60) {
    node._pixSvRestoring = false;
    return;
  }
  requestAnimationFrame(() => restoreLastRun(node, tries + 1));
}

// ── wiring ───────────────────────────────────────────────────────────────────
const CHIPS = [
  ["+ Input name", "%input%"],
  ["+ Date", null], // uses the dateStyle setting
  ["+ Time", "%date:hh-mm-ss%"],
  ["+ Counter", "%counter%"],
  ["+ Seed", null], // resolved to a %Node.widget% reference below
  ["+ Width", "%width%"],
  ["+ Height", "%height%"],
  ["+ Fps", "%fps%"],
  ["+ Duration", "%duration%"],
  ["+ Frames", "%frames%"],
];

function insertToken(node, token) {
  const ui = node._pixSvUI;
  const inp = ui.patternInput;
  const st = readState(node);
  const start = inp.selectionStart ?? inp.value.length;
  const end = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, start) + token + inp.value.slice(end);
  const caret = start + token.length;
  inp.setSelectionRange(caret, caret);
  st.pattern = inp.value;
  writeState(node, st);
  updatePreview(node);
  inp.focus();
}

function wireEvents(node, ui) {
  ui.folderInput.addEventListener("input", () => {
    const st = readState(node);
    st.folder = ui.folderInput.value;
    writeState(node, st);
    updatePreview(node);
  });
  ui.patternInput.addEventListener("input", () => {
    const st = readState(node);
    st.pattern = ui.patternInput.value;
    writeState(node, st);
    updatePreview(node);
  });

  // chips
  for (const [label, token] of CHIPS) {
    const chip = el("button", "pix-sv-chip", label);
    chip.type = "button";
    chip.onclick = () => {
      const st = readState(node);
      if (label === "+ Date") insertToken(node, `%date:${st.dateStyle || "yyyy-MM-dd"}%`);
      else if (label === "+ Seed") insertToken(node, "%Seed Pixaroma.seed%");
      else insertToken(node, token);
    };
    ui.chipsWrap.appendChild(chip);
  }
  // the two folder chips PREPEND, at the FRONT, rather than at the caret
  for (const [label, mk, title] of [
    ["+ Date folder", (st) => `%date:${st.dateStyle || "yyyy-MM-dd"}%/`,
      "Put every video in a folder named after today's date"],
    ["+ Input folder", () => "%input%/",
      "Put every video in a folder named after the wired name input"],
  ]) {
    const chip = el("button", "pix-sv-chip", label);
    chip.type = "button";
    chip.title = title;
    chip.onclick = () => {
      const st = readState(node);
      const seg = mk(st);
      if (!st.pattern.startsWith(seg)) {
        st.pattern = seg + st.pattern;
        writeState(node, st);
        ui.patternInput.value = st.pattern;
        updatePreview(node);
      }
    };
    ui.chipsWrap.appendChild(chip);
  }
  const clearChip = el("button", "pix-sv-chip", "✕ Clear");
  clearChip.type = "button";
  clearChip.title = "Empty the filename box";
  clearChip.onclick = () => {
    const st = readState(node);
    st.pattern = "";
    writeState(node, st);
    ui.patternInput.value = "";
    updatePreview(node);
  };
  ui.chipsWrap.appendChild(clearChip);
  const resetChip = el("button", "pix-sv-chip", "↺ Reset");
  resetChip.type = "button";
  resetChip.title = "Back to the default filename";
  resetChip.onclick = () => {
    const st = readState(node);
    st.pattern = DEFAULT_STATE.pattern;
    writeState(node, st);
    ui.patternInput.value = st.pattern;
    updatePreview(node);
  };
  ui.chipsWrap.appendChild(resetChip);

  // format + mode pills
  for (const f of FORMATS) {
    ui.fmtBtns[f.id].onclick = () => {
      const st = readState(node);
      st.format = f.id;
      writeState(node, st);
      syncFace(node);
      updatePreview(node);
    };
  }
  ui.modeSave.onclick = () => {
    const st = readState(node);
    st.saveOnRun = true;
    writeState(node, st);
    syncFace(node);
  };
  ui.modePreview.onclick = () => {
    const st = readState(node);
    st.saveOnRun = false;
    writeState(node, st);
    syncFace(node);
  };

  // fold + gear
  ui.foldBtn.onclick = () => {
    const st = readState(node);
    st.folded = !st.folded;
    writeState(node, st);
    applyFold(node, true);
  };
  ui.gearBtn.onclick = (e) => {
    e.stopPropagation();
    openSaveVideoPanel(node);
  };
  ui.gearBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  // Browse: the Load Images from Folder native-dialog route, which is generic -
  // it just pops the OS picker and hands back a path.
  ui.browseBtn.addEventListener("click", async () => {
    ui.browseLbl.textContent = "…";
    let res;
    try {
      const r = await fetch(
        pixApiUrl(`/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(readState(node).folder || "")}`)
      );
      res = await r.json();
    } catch (e) {
      res = { ok: false, message: String(e) };
    }
    ui.browseLbl.textContent = "Browse";
    if (res?.ok && res.path) {
      const st = readState(node);
      st.folder = normalizePath(res.path);
      writeState(node, st);
      ui.folderInput.value = st.folder;
      node._pixSvCntKey = null;
      updatePreview(node);
    } else if (!res?.cancelled) {
      flashStatus(node, "Folder dialog unavailable - paste the path instead", 3200);
    }
  });

  ui.btnOpen.addEventListener("click", () => {
    const entry = node.properties?.[LAST_RUN_PROP];
    if (!entry?.filename) return flashStatus(node, "Run the workflow first");
    window.open(buildVideoUrl(entry), "_blank");
  });

  ui.btnDownload.addEventListener("click", () => {
    const entry = node.properties?.[LAST_RUN_PROP];
    if (!entry?.filename) return flashStatus(node, "Run the workflow first");
    const a = document.createElement("a");
    a.href = buildVideoUrl(entry);
    a.download = entry.filename.split("/").pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  ui.btnFolder.addEventListener("click", async () => {
    try {
      const r = await fetch(pixApiUrl("/pixaroma/api/save_image/open_folder"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: readState(node).folder || "" }),
      });
      const j = await r.json();
      if (!j?.ok) flashStatus(node, j?.message || "Could not open the folder", 3200);
    } catch {
      flashStatus(node, "Could not open the folder", 3200);
    }
  });
}

// ── state injection ──────────────────────────────────────────────────────────
function injectState(result) {
  const wf = result?.workflow;
  const out = result?.output;
  if (!out) return;
  const nodes = wf?.nodes || [];
  for (const n of nodes) {
    if (n?.type !== COMFY_CLASS) continue;
    const id = String(n.id);
    if (!out[id]) continue;
    out[id].inputs = out[id].inputs || {};
    let raw = n.properties?.[STATE_PROP];
    if (typeof raw !== "string" || !raw) raw = JSON.stringify(DEFAULT_STATE);
    // Resolve %NodeName.widget% references (e.g. %Seed Pixaroma.seed%) HERE, at
    // submit time, so the value baked in is the one this run uses.
    try {
      const st = JSON.parse(raw);
      if (typeof st.pattern === "string") {
        st.pattern = applyFilenameTokenRefs(st.pattern);
        raw = JSON.stringify(st);
      }
    } catch {}
    out[id].inputs[HIDDEN_INPUT_NAME] = raw;
  }
}

function installGraphToPromptHook() {
  if (app._pixSvGraphPatched) return;
  app._pixSvGraphPatched = true;
  const orig = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await orig(...args);
    try {
      injectState(result);
    } catch (e) {
      console.warn("[SaveVideo] graphToPrompt inject failed", e);
    }
    return result;
  };
}

// BOTH result-delivery paths (save-mp4 pattern #9): the global socket event AND
// ComfyUI's standard per-node hook. A host whose frontend hands results to nodes
// itself, instead of re-broadcasting the raw socket event, only reaches
// onExecuted. commitEntry is idempotent, so a host that fires both just
// re-applies the same clip.
function installExecutedListener() {
  if (app._pixSvExecPatched) return;
  app._pixSvExecPatched = true;
  api.addEventListener("executed", ({ detail }) => {
    const id = detail?.node;
    if (id == null) return;
    const graph = app.graph;
    const node = graph?.getNodeById?.(id) ?? graph?.getNodeById?.(parseInt(id, 10));
    // The gate that makes the `images` fallback safe: without it, a clip
    // reported by ANYONE else's node could match.
    if (!node || node.comfyClass !== COMFY_CLASS) return;
    const entry = pickEntry(detail?.output);
    if (entry) commitEntry(node, entry);
  });
}

function openSaveVideoPanel(node) {
  openSettingsPanel(node, () => {
    syncFace(node);
    updatePreview(node);
    applyFold(node, true);
  });
}

// ── extension ────────────────────────────────────────────────────────────────
app.registerExtension({
  name: "Pixaroma.SaveVideo",

  setup() {
    installGraphToPromptHook();
    installExecutedListener();
  },

  getNodeMenuItems(node) {
    if (!node || node.comfyClass !== COMFY_CLASS) return [];
    return [
      null,
      { content: "⚙ Save Video settings", callback: () => openSaveVideoPanel(node) },
      {
        content: "↺ Reset node size",
        callback: () => {
          const st = readState(node);
          if (st.folded) {
            st.folded = false;
            writeState(node, st);
            applyFold(node, false);
          }
          node.setSize?.([DEFAULT_W, DEFAULT_H]);
          node.setDirtyCanvas?.(true, true);
        },
      },
    ];
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== COMFY_CLASS) return;
    // hot-reload guard: without it every re-register re-wraps the prototype
    // hooks and leaks an installResizeFloor listener each time
    if (nodeType._pixSvPatched) return;
    nodeType._pixSvPatched = true;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure?.apply(this, arguments);
      queueMicrotask(() => {
        if (!this._pixSvUI) return;
        syncFace(this);
        updatePreview(this);
        restoreLastRun(this);
        applyFold(this, false); // display only; never resizes on load
      });
      return r;
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = origDraw?.apply(this, arguments);
      // The isGraphLoading gate is NOT optional (convention #7): node.size is
      // serialized and a draw hook runs on the very FIRST frame of a load,
      // earlier than any other clamp - so an ungated clamp is the one place that
      // can rewrite node.size on a clean open and flag an untouched workflow
      // modified. Nodes 2.0 has no live width clamp, so a node genuinely can be
      // saved narrower than MIN_W.
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return r;
    };

    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const r = origResize?.apply(this, arguments);
      // Gated the same way: onResize is NOT only a user drag - it also fires
      // from fit-to-content, the right-click Resize menu, node creation and
      // workflow restore.
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        closeSettingsPanelFor(this);
        this._pixSvFloorOff?.();
        this._pixSvEndDrag?.(); // release any window listeners the scrub added
        clearTimeout(this._pixSvCntTimer);
        clearTimeout(this._pixSvFlashTimer);
      } catch {}
      return origRemoved?.apply(this, arguments);
    };
  },
});

function setupNode(node) {
  injectCSS();
  // ui.images is emitted so the Assets panel refreshes, but an mp4 is not an
  // image - stop ComfyUI painting its own preview panel underneath ours.
  try {
    Object.defineProperty(node, "imgs", {
      configurable: true,
      get() { return []; },
      set() {},
    });
  } catch {}

  const ui = buildRoot();
  node._pixSvUI = ui;
  node._pixSvRoot = ui.root;
  const player = buildPlayer(node);
  ui.stage.appendChild(player.media);
  ui.stage.appendChild(player.bar);
  Object.assign(node._pixSvUI, ui); // keep the face refs alongside the player's

  installCanvasZoomPassthrough(ui.root);
  installNodeAccent(node, ui.root);

  // The DOM widget is added AFTER the native `fps` widget, and must stay that
  // way: save and load index widgets_values DIFFERENTLY, and a serialize:false
  // widget placed BEFORE a native one leaves a hole on save that the sequential
  // load walks straight past, shifting every value (Vue Compat #23).
  const widget = node.addDOMWidget("pixaroma_save_video", "pixaroma_save_video", ui.root, {
    getValue: () => null,
    setValue: () => {},
    // FLOOR only: no getMaxHeight and no custom computeSize, so the player
    // absorbs all free height in both renderers. Coarse-rounded so font and
    // sub-pixel jitter cannot creep node.size bigger on every load.
    getMinHeight: () => floorOf(ui),
    serialize: false,
  });
  applyAdaptiveCanvasOnly(widget);
  node._pixSvWidget = widget;
  if (isVueNodes()) {
    widget.computeLayoutSize = () => ({ minHeight: floorOf(ui), minWidth: 1 });
  }

  wireEvents(node, ui);
  try {
    node._pixSvFloorOff = installResizeFloor(ui.root, () => measureFloor(ui));
  } catch {}

  // Default size on a FRESH drop only; configure() restores saved sizes.
  const fresh = !isGraphLoading();
  if (!node.size) node.size = [DEFAULT_W, DEFAULT_H];
  if (fresh) {
    node.size[0] = DEFAULT_W;
    if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
  }
  const snapFresh = () => {
    if (!node._pixSvUI) return;
    if (Math.abs(node.size[0] - DEFAULT_W) > 1 || Math.abs(node.size[1] - DEFAULT_H) > 1) {
      if (node.setSize) node.setSize([DEFAULT_W, DEFAULT_H]);
      else {
        node.size[0] = DEFAULT_W;
        node.size[1] = DEFAULT_H;
      }
      node.setDirtyCanvas?.(true, true);
    }
  };

  // deferred so configure()'s restored state lands first (Vue Compat #8)
  queueMicrotask(() => {
    syncFace(node);
    updatePreview(node);
    restoreLastRun(node);
    applyFold(node, false);
    if (fresh) {
      snapFresh();
      requestAnimationFrame(snapFresh);
    }
  });

  // ComfyUI's standard per-node result hook - the other half of pattern #9.
  const origExec = node.onExecuted;
  node.onExecuted = function (output) {
    const r = origExec?.apply(this, arguments);
    const entry = pickEntry(output);
    if (entry) commitEntry(this, entry);
    return r;
  };
}

// The toolbar gear + the central right-click entry (convention #19). ownMenuItem
// because this node adds its own richer entry above.
registerNodeSettings(COMFY_CLASS, {
  title: "Save Video",
  open: (node) => openSaveVideoPanel(node),
  ownMenuItem: true,
});
