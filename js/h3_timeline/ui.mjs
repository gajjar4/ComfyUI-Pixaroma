// H3 Timeline Pixaroma - the node face (mockup D, 2026-10-22).
//
// ONE DOM widget in both renderers (the fill recipe of nodes2-preview-fill.md,
// the same structure as Layout Boxes): the root fills its row, all layout lives
// on an inner absolute layer, and the scene LIST is the part that grows with the
// node and scrolls when the node is shorter.
//
// Top: the time bar, one block per scene as wide as its length, tiled with the
// picture the video shows there (cut like the run cuts it), then a ruler and
// the sound lane. Then one row per scene: its picture, its length, the picture's
// role, its words. Then Add scene and the total.
//
// Height: getMinHeight is a CONSTANT (convention #39 E). The node grows by one
// row when YOU add a scene and shrinks when you remove one; the drag floor is
// measured live only while a resize handle is held.

import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installNativeTextMenu } from "../shared/native_text_menu.mjs";
import { installNodeAccent } from "../shared/node_settings.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { passComfyShortcut } from "../shared/text_shortcuts.mjs";
import {
  MAX_SCENES, ROLE_LOOK, ROLE_PERSON, SCENE_STEP_S, cleanLength, clipFrames, fmtS, newScene, readState,
  sceneLooks, sceneStarts, writeState,
} from "./core.mjs";
import { keptWindow, openCrop } from "./crop.mjs";
import { injectCSS } from "./css.mjs";
import { askFile, closePicker, openPicker, pictureFailed, pictureSize, pictureUrl, uploadPicture } from "./pictures.mjs";

export const WIDGET_NAME = "h3_timeline_ui";
export const WIDGET_TYPE = "pixaroma_h3_timeline";   // unique: a registered Vue type would swallow the DOM
export const FLOOR = 300;                       // the bar, one row and the footer
export const MIN_W = 480;                       // a row's top line still fits on two lines at most

const SVG = {
  up: '<path d="M12 19V5M6 11l6-6 6 6"></path>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"></path>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"></path>',
  del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>',
  pic: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="M21 17l-5-5-9 8"></path>',
};
const icon = (k, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${SVG[k]}</svg>`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** The video's size, read LIVE from the node's own width / height widgets. */
export function videoSize(node) {
  const get = (n, d) => {
    const w = node.widgets?.find((x) => x.name === n);
    const v = Number(w?.value);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return { w: get("width", 480), h: get("height", 864) };
}

const modeOf = (node) => node.widgets?.find((x) => x.name === "mode")?.value || "Sing";

// ── changes: the ONE path that writes the state ────────────────────────────
function change(node, fn, structural = false) {
  const scenes = readState(node).scenes;
  fn(scenes);
  writeState(node, scenes);
  notifyGraphChanged();
  renderFace(node, structural, true);
}

const selOf = (node) => node._pixH3tSel ?? -1;
function select(node, i) {
  node._pixH3tSel = i;
  syncSelection(node);
}

async function uploadInto(node, i, file) {
  if (!file) return;
  try {
    const name = await uploadPicture(file);
    if (name) change(node, (s) => { if (s[i]) { s[i].picture = name; s[i].x = 0.5; s[i].y = 0.5; } }, true);
  } catch (e) {
    console.error("[Pixaroma.H3Timeline] upload failed", e);
  }
}

function pickFor(node, i, anchor) {
  const sc = readState(node).scenes[i];
  openPicker(anchor, {
    current: sc?.picture,
    canRemove: !!sc?.picture && i > 0,
    onPick: (name) => change(node, (s) => {
      if (!s[i]) return;
      s[i].picture = name;
      s[i].x = 0.5;
      s[i].y = 0.5;
    }, true),
    onUpload: async () => uploadInto(node, i, await askFile()),
  });
}

function cropFor(node, i) {
  const sc = readState(node).scenes[i];
  const size = sc?.picture && pictureSize(sc.picture);
  if (!size) return;
  openCrop({
    title: `Scene ${i + 1} picture`, picture: sc.picture, size, video: videoSize(node), scene: sc,
    onDone: ({ x, y, fit }) => change(node, (s) => { if (s[i]) Object.assign(s[i], { x, y, fit }); }),
  });
}

// ── build ──────────────────────────────────────────────────────────────────
export function buildFace(node) {
  injectCSS();
  const root = el("div", "pix-h3t-root");
  const inner = el("div", "pix-h3t-inner");
  const bar = el("div", "pix-h3t-bar");
  const strip = el("div", "pix-h3t-strip");
  const ruler = el("div", "pix-h3t-ruler");
  const lane = el("div", "pix-h3t-lane");
  bar.append(strip, ruler, lane);
  const list = el("div", "pix-h3t-list");
  const foot = el("div", "pix-h3t-foot");
  const add = el("button", "pix-h3t-add", "+ Add scene");
  add.title = "Add a scene after the last one (it keeps the look until you give it a picture)";
  add.onclick = () => {
    const n = readState(node).scenes.length;
    if (n >= MAX_SCENES) return;
    change(node, (s) => s.push(newScene()), true);
    select(node, n);
    requestAnimationFrame(() => node._pixH3tFace?.list.lastElementChild?.scrollIntoView({ block: "nearest" }));
  };
  const total = el("span", "pix-h3t-total");
  foot.append(add, total);
  inner.append(bar, list, foot);
  root.appendChild(inner);

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => FLOOR,
  });
  // BOTH flags: options.serialize keeps it out of the PROMPT, widget.serialize
  // keeps it out of the saved WORKFLOW's widgets_values.
  widget.serialize = false;
  widget.computeLayoutSize = () => ({ minHeight: FLOOR, minWidth: 1 });
  applyAdaptiveCanvasOnly(widget);
  installCanvasZoomPassthrough(root);
  installNativeTextMenu(root);
  installNodeAccent(node, root);

  const face = { root, inner, bar, strip, ruler, lane, list, foot, add, total, widget };
  node._pixH3tFace = face;
  face.floorOff = installResizeFloor(root, () => contentMin(node));
  face.ro = new ResizeObserver(() => renderStrip(node));
  face.ro.observe(strip);
  return widget;
}

/** The bar, one full row and the footer: measured, for the DRAG floor only. */
export function contentMin(node) {
  const f = node._pixH3tFace;
  if (!f) return FLOOR;
  const cs = getComputedStyle(f.inner);
  const gap = parseFloat(cs.rowGap) || 8;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const row = f.list.firstElementChild?.offsetHeight || 130;
  return Math.max(FLOOR, Math.ceil(pad + 2 * gap + f.bar.offsetHeight + row + f.foot.offsetHeight));
}

const listWant = (f) => f.list.scrollHeight;

function growBy(node, dy) {
  if (!dy || isGraphLoading() || !node?.size) return;
  node.setSize?.([node.size[0], Math.max(node.size[1] + dy, 0)]);
  node.setDirtyCanvas?.(true, true);
}

/** Re-sync everything; rebuild the rows on a structural change. `userAction` is
 *  what allows the node to change size - the load path never passes it. */
export function renderFace(node, structural = true, userAction = false) {
  const f = node._pixH3tFace;
  if (!f) return;
  // A body that is not laid out (off screen, zoomed far out, a hidden tab) has no
  // real heights: never resize from it (convention #39).
  const laidOut = f.root.offsetWidth >= 100;
  const before = listWant(f);
  const st = readState(node);
  if (structural) renderRows(node, st);
  else syncRows(node, st);
  renderStrip(node, st);
  renderFoot(node, st);
  if (structural && userAction && laidOut) {
    const after = listWant(f);
    if (before > 0 && after !== before) growBy(node, Math.max(-400, Math.min(400, after - before)));
  }
}

export function destroyFace(node) {
  const f = node._pixH3tFace;
  if (!f) return;
  closePicker();
  try { f.ro?.disconnect(); } catch {}
  try { f.floorOff?.(); } catch {}
  node._pixH3tFace = null;
}

// ── the time bar ───────────────────────────────────────────────────────────
function tileStyle(t, look, tw) {
  t.style.width = tw + "px";
  if (!look?.picture || pictureFailed(look.picture)) return;
  t.style.backgroundImage = `url("${pictureUrl(look.picture)}")`;
  t.style.backgroundSize = look.fit === "fit" ? "contain" : "cover";
  t.style.backgroundPosition = `${look.x * 100}% ${look.y * 100}%`;
}

export function renderStrip(node, st = readState(node)) {
  const f = node._pixH3tFace;
  if (!f) return;
  const W = f.strip.clientWidth;
  const H = f.strip.clientHeight || 64;
  const { starts, total } = sceneStarts(st.scenes);
  const looks = sceneLooks(st.scenes);
  const v = videoSize(node);
  const tw = Math.max(12, Math.round(H * v.w / v.h));
  const sel = selOf(node);
  f.strip.replaceChildren();
  st.scenes.forEach((s, i) => {
    const b = el("div", "pix-h3t-block");
    const L = looks[i];
    if (!L.own) b.classList.add("carried");
    if (i === sel) b.classList.add("sel");
    b.style.left = `${(starts[i] / total) * 100}%`;
    b.style.width = `calc(${(s.length / total) * 100}% - 3px)`;
    const tiles = el("div", "pix-h3t-tiles");
    const bw = W ? (W * s.length) / total : 0;
    const n = W && L.look?.picture ? Math.min(40, Math.ceil(bw / (tw + 1)) + 1) : 0;
    for (let k = 0; k < n; k++) {
      const t = el("div", "pix-h3t-tile");
      tileStyle(t, L.look, tw);
      tiles.appendChild(t);
    }
    b.appendChild(tiles);
    b.appendChild(el("span", "pix-h3t-badge", `${i + 1} · ${fmtS(s.length)}`));
    if (!L.own && i > 0) b.appendChild(el("span", "pix-h3t-tag", "same look"));
    else if (L.entering) b.appendChild(el("span", "pix-h3t-tag", "+ person"));
    b.title = `Scene ${i + 1}: ${fmtS(starts[i])} to ${fmtS(starts[i] + s.length)}`;
    b.onclick = () => {
      select(node, i);
      f.list.children[i]?.scrollIntoView({ block: "nearest" });
    };
    f.strip.appendChild(b);
  });
  // ruler: round ticks (5 s, 10 s...), about five of them, and the end
  f.ruler.replaceChildren();
  const step = [1, 2, 5, 10, 15, 20, 30, 60].find((x) => total / x <= 6) || 120;
  const ticks = [];
  for (let t = 0; t < total - step * 0.4; t += step) ticks.push(t);
  ticks.push(total);
  ticks.forEach((t, k) => {
    const last = k === ticks.length - 1;
    const sp = el("span", k === 0 ? "first" : last ? "last" : "", k === 0 ? "0 s" : fmtS(t));
    sp.style.left = `${(t / total) * 100}%`;
    f.ruler.appendChild(sp);
  });
  // sound lane
  f.lane.replaceChildren();
  const run = node._pixH3tRun;
  const act = modeOf(node) === "Act";
  const wave = el("div", "wave" + (act ? " off" : ""));
  let note;
  if (act) note = el("span", "note", "Act: no audio, H3 makes the sound");
  else if (run?.audio) note = el("span", "note " + (/fits/.test(run.audio) ? "ok" : "warn"),
    run.audio.charAt(0).toUpperCase() + run.audio.slice(1));
  else note = el("span", "note", `${modeOf(node)}: the audio length is checked when you run`);
  note.title = note.textContent;
  f.lane.append(wave, note);
}

// ── the rows ───────────────────────────────────────────────────────────────
function stopKeys(field, blur) {
  field.addEventListener("keydown", (e) => {
    if (passComfyShortcut(e, field, { blur })) return;
    e.stopPropagation();
  });
}

function captionFor(node, i, s, L) {
  const cap = el("button", "pix-h3t-cap");
  cap.type = "button";
  if (!s.picture) {
    if (i === 0) {
      cap.textContent = "needed";
      cap.classList.add("cut");
      cap.title = "Scene 1 needs a picture: the start picture";
      cap.onclick = (e) => pickFor(node, i, e.currentTarget.previousSibling);
    } else cap.textContent = "keeps the look";
    return cap;
  }
  if (i > 0 && s.role === ROLE_PERSON) {
    cap.textContent = "kept whole";
    cap.title = "A person's picture is never cut: H3 keeps its whole shape";
    return cap;
  }
  const size = pictureSize(s.picture, () => syncRows(node, readState(node)));
  if (pictureFailed(s.picture)) {
    cap.textContent = "not found";
    cap.classList.add("cut");
    cap.title = "This picture is not in the input folder any more. Click the picture to pick it again.";
    return cap;
  }
  if (!size) { cap.textContent = "…"; return cap; }
  const v = videoSize(node);
  const k = keptWindow(size.w, size.h, v.w, v.h, s.x, s.y);
  if (s.fit === "fit") {
    cap.textContent = k ? "fit inside" : "nothing cut";
    cap.classList.add(k ? "link" : "ok");
  } else if (!k) {
    cap.textContent = "nothing cut";
    cap.classList.add("ok");
  } else {
    cap.textContent = `cut: ${k.side === "the sides" ? "sides" : "top, bottom"}`;
    cap.classList.add("cut");
  }
  cap.title = "Click to see what the video keeps of this picture, and move the cut";
  cap.onclick = () => cropFor(node, i);
  return cap;
}

function pictureButton(node, i, s, L) {
  const v = videoSize(node);
  const h = Math.max(40, Math.min(120, Math.round(60 * v.h / v.w)));
  const person = i > 0 && s.role === ROLE_PERSON;
  const b = el("button", "pix-h3t-pic");
  b.type = "button";
  b.style.height = h + "px";
  if (!s.picture) {
    b.classList.add("empty");
    b.innerHTML = icon("pic", 18) + "<span>+ picture</span>";
    b.setAttribute("aria-label", `Add a picture to scene ${i + 1}`);
    b.title = i === 0 ? "Pick the start picture (or drop one here)" : "Give this scene its own picture (or drop one here)";
  } else {
    b.style.backgroundImage = `url("${pictureUrl(s.picture)}")`;
    if (person || s.fit === "fit") b.classList.add("fit");
    else b.style.backgroundPosition = `${s.x * 100}% ${s.y * 100}%`;
    b.setAttribute("aria-label", `Scene ${i + 1} picture: ${s.picture}. Click to change it`);
    b.title = `${s.picture}\nClick to change it (or drop another picture here)`;
  }
  b.onclick = () => pickFor(node, i, b);
  return b;
}

function renderRows(node, st) {
  const f = node._pixH3tFace;
  const keepScroll = f.list.scrollTop;
  f.list.replaceChildren();
  const looks = sceneLooks(st.scenes);
  const n = st.scenes.length;
  st.scenes.forEach((s, i) => {
    const row = el("div", "pix-h3t-row");
    row.dataset.i = String(i);
    row.addEventListener("pointerdown", () => { if (selOf(node) !== i) select(node, i); }, true);
    // drop a picture file on a row
    row.addEventListener("dragover", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.add("drop");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop"));
    row.addEventListener("drop", (e) => {
      const file = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
      row.classList.remove("drop");
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      uploadInto(node, i, file);
    });

    const pc = el("div", "pix-h3t-piccol");
    const pb = pictureButton(node, i, s, looks[i]);
    pc.append(pb, captionFor(node, i, s, looks[i]));

    const main = el("div", "pix-h3t-main");
    const top = el("div", "pix-h3t-top");
    top.appendChild(el("span", "pix-h3t-num", String(i + 1)));
    const len = el("span", "pix-h3t-len");
    const minus = el("button", "pix-h3t-step", "−");
    minus.setAttribute("aria-label", `Scene ${i + 1} shorter`);
    minus.title = "Half a second shorter (4 s at least)";
    const lenIn = el("input", "pix-h3t-lenin");
    lenIn.value = fmtS(s.length);
    lenIn.setAttribute("aria-label", `Scene ${i + 1} length in seconds`);
    lenIn.title = "How long this scene lasts, in seconds (4 to 120)";
    const plus = el("button", "pix-h3t-step", "+");
    plus.setAttribute("aria-label", `Scene ${i + 1} longer`);
    plus.title = "Half a second longer";
    const setLen = (v) => change(node, (sc) => { if (sc[i]) sc[i].length = cleanLength(v); });
    minus.onclick = () => setLen(readState(node).scenes[i].length - SCENE_STEP_S);
    plus.onclick = () => setLen(readState(node).scenes[i].length + SCENE_STEP_S);
    lenIn.addEventListener("change", () => {
      const v = parseFloat(String(lenIn.value).replace(",", "."));
      if (Number.isFinite(v)) setLen(v);
      else lenIn.value = fmtS(readState(node).scenes[i].length);
    });
    lenIn.addEventListener("keydown", (e) => { if (e.key === "Enter") lenIn.blur(); });
    stopKeys(lenIn, true);
    len.append(minus, lenIn, plus);
    top.appendChild(len);

    if (i === 0) {
      const chip = el("span", "pix-h3t-chip", "Start picture");
      chip.title = "Scene 1's picture is the first frame and the look of the video";
      top.appendChild(chip);
    } else if (s.picture) {
      const seg = el("span", "pix-h3t-seg");
      for (const [role, label, tip] of [
        [ROLE_LOOK, "New look", "The same shot with a change (a hat, another dress): it becomes the look from here on, and fades in"],
        [ROLE_PERSON, "Add person", "Someone who joins: any photo, kept whole. They can walk in"],
      ]) {
        const b = el("button", s.role === role ? "on" : "", label);
        b.title = tip;
        b.setAttribute("aria-pressed", String(s.role === role));
        b.onclick = () => change(node, (sc) => { if (sc[i]) sc[i].role = role; }, true);
        seg.appendChild(b);
      }
      top.appendChild(seg);
    }
    // the four row buttons wrap TOGETHER, never one alone on a line
    const tools = el("span", "pix-h3t-tools");
    top.appendChild(tools);
    const tool = (k, label, enabled, fn) => {
      const b = el("button", "pix-h3t-icon");
      b.innerHTML = icon(k);
      b.setAttribute("aria-label", label);
      b.title = label;
      b.disabled = !enabled;
      b.onclick = fn;
      tools.appendChild(b);
    };
    tool("up", `Move scene ${i + 1} earlier`, i > 0, () => {
      change(node, (sc) => { [sc[i - 1], sc[i]] = [sc[i], sc[i - 1]]; }, true);
      select(node, i - 1);
    });
    tool("down", `Move scene ${i + 1} later`, i < n - 1, () => {
      change(node, (sc) => { [sc[i + 1], sc[i]] = [sc[i], sc[i + 1]]; }, true);
      select(node, i + 1);
    });
    tool("dup", `Duplicate scene ${i + 1}`, n < MAX_SCENES, () => {
      change(node, (sc) => { sc.splice(i + 1, 0, { ...sc[i] }); }, true);
      select(node, i + 1);
    });
    tool("del", `Delete scene ${i + 1}`, n > 1, () => {
      change(node, (sc) => { sc.splice(i, 1); }, true);
      select(node, Math.min(i, n - 2));
    });

    const words = el("textarea", "pix-h3t-words");
    words.value = s.words;
    words.placeholder = i === 0 ? "What happens: sings softly with her hands clasped" : "What happens in this scene";
    words.setAttribute("aria-label", `What happens in scene ${i + 1}`);
    words.spellcheck = true;
    words.addEventListener("input", () => {
      const sc = readState(node).scenes;
      if (!sc[i]) return;
      sc[i].words = words.value;
      writeState(node, sc);
    });
    words.addEventListener("change", () => notifyGraphChanged());
    stopKeys(words, true);
    main.append(top, words);
    row.append(pc, main);
    f.list.appendChild(row);
  });
  f.list.scrollTop = keepScroll;
  syncSelection(node);
}

/** Light refresh (no rebuild): captions and pictures may have changed after a
 *  picture's size arrived or the video size changed. Rebuilding would drop the
 *  caret from a field being typed in, so only the picture column is redone. */
function syncRows(node, st) {
  const f = node._pixH3tFace;
  if (!f) return;
  if (f.list.children.length !== st.scenes.length) { renderRows(node, st); return; }
  const looks = sceneLooks(st.scenes);
  st.scenes.forEach((s, i) => {
    const row = f.list.children[i];
    const pc = row?.querySelector(".pix-h3t-piccol");
    if (!pc) return;
    pc.replaceChildren(pictureButton(node, i, s, looks[i]), captionFor(node, i, s, looks[i]));
    const lenIn = row.querySelector(".pix-h3t-lenin");
    if (lenIn && document.activeElement !== lenIn) lenIn.value = fmtS(s.length);
  });
  syncSelection(node);
}

function syncSelection(node) {
  const f = node._pixH3tFace;
  if (!f) return;
  const sel = selOf(node);
  [...f.list.children].forEach((r, i) => r.classList.toggle("sel", i === sel));
  [...f.strip.children].forEach((b, i) => b.classList.toggle("sel", i === sel));
}

function renderFoot(node, st) {
  const f = node._pixH3tFace;
  const n = st.scenes.length;
  const frames = clipFrames(st.scenes.map((s) => s.length));
  f.total.textContent = `Total ${fmtS(frames / 24)} · ${frames} frames · ${n} scene${n === 1 ? "" : "s"}`;
  f.add.disabled = n >= 12;
  f.add.title = n >= 12 ? "12 scenes at most" : "Add a scene after the last one (it keeps the look until you give it a picture)";
}
