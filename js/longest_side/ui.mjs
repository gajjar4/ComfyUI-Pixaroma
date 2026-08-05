// Longest Side Pixaroma - the node face.
//
// Three rows, and the whole point of the node is that it is only three:
//   band   the step button, the gear, and the size this node will send
//   sizes  the size tabs - one click, no typing
//   shapes the crop chips, each with a little rectangle in its true proportion
//
// The band is a plain CENTRED row under the slots, deliberately NOT floated up
// into the slot dead-space the way Portrait Landscape's is. Floating needs a
// measured offset in Classic, a parked copy in Nodes 2.0 and a self-heal poll
// for both; a normal row needs none of it and cannot drift.

import { pixAsset } from "../shared/api_url.mjs";
import { ACC } from "../shared/node_settings.mjs";
import {
  readState, writeState, nextStep, stepLabel, previewText, parseRatio,
} from "./core.mjs";

const PAD = 6;
const GAP = 4;
const BAND_H = 22;
const TAB_H = 24;
const CHIP_H = 26;

/** The DOM widget's fixed height. A CONSTANT, never a live measurement: a
 *  measured height comes back a pixel different between save and reload, which
 *  rewrites node.size and flags an untouched workflow "modified" (Vue Compat
 *  #18). Update it by hand if a row is added. */
export const WIDGET_H = PAD * 2 + BAND_H + TAB_H + CHIP_H + GAP * 2;

export const DEFAULT_W = 380;
export const MIN_W = 300;

// The longest edge of a shape swatch, and the thinnest it may get, so 21:9 is
// still a rectangle rather than a line.
const SWATCH_MAX = 13;
const SWATCH_MIN = 4;

let _cssDone = false;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const style = document.createElement("style");
  style.id = "pix-longest-side-css";
  style.textContent = `
    .pix-ls-root {
      display: flex; flex-direction: column; gap: ${GAP}px;
      padding: ${PAD}px; box-sizing: border-box; width: 100%;
      font-family: inherit; user-select: none;
    }
    .pix-ls-band {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      height: ${BAND_H}px; flex: none;
    }
    /* Every surface is a semi-transparent WHITE overlay, never a fixed dark
       grey, so the controls still read correctly when the node is recoloured
       via right-click > Colors (UI convention #1). */
    .pix-ls-step {
      flex: none; min-width: 42px; box-sizing: border-box; height: 20px;
      border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11px;
      padding: 0 7px; line-height: 1;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.7);
    }
    .pix-ls-step:hover { border-color: ${ACC}; color: #ddd; }
    .pix-ls-step.on, .pix-ls-step.on:hover {
      background: ${ACC}; border-color: ${ACC}; color: #fff;
    }
    /* The bundled gear SVG as a mask, never the emoji: an emoji is drawn by the
       OS, so it is a different shape and baseline on every platform (UI
       convention #28). Same 20px box as the button beside it so they share a
       centre line. */
    .pix-ls-gear {
      flex: none; width: 20px; height: 20px; padding: 0; margin: 0;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; cursor: pointer;
    }
    .pix-ls-gear::before {
      content: ""; display: block; width: 14px; height: 14px; background: #bbb;
      -webkit-mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    }
    .pix-ls-gear:hover::before { background: ${ACC}; }
    .pix-ls-preview {
      flex: 0 1 auto; min-width: 0; height: 20px; line-height: 20px;
      font-size: 12px; color: ${ACC}; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .pix-ls-preview.dim { color: rgba(255,255,255,0.45); font-style: italic; }

    .pix-ls-row { display: flex; gap: ${GAP}px; flex: none; }
    /* Hover = accent BORDER only; the accent FILL is reserved for the active
       one, so hover never reads as "this is now selected" (UI convention #13). */
    .pix-ls-tab, .pix-ls-chip {
      flex: 1 1 0; min-width: 0; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center; gap: 4px;
      background: #1d1d1d; border: 1px solid #444; border-radius: 4px;
      color: #bbb; font-family: inherit; cursor: pointer; padding: 0 2px;
      white-space: nowrap; overflow: hidden;
    }
    .pix-ls-tab { height: ${TAB_H}px; font-size: 11px; }
    .pix-ls-chip { height: ${CHIP_H}px; font-size: 10px; }
    .pix-ls-tab:hover, .pix-ls-chip:hover { border-color: ${ACC}; color: #ddd; }
    .pix-ls-tab.on, .pix-ls-tab.on:hover,
    .pix-ls-chip.on, .pix-ls-chip.on:hover {
      background: ${ACC}; border-color: ${ACC}; color: #fff;
    }
    /* The little rectangle showing the shape. flex:none or it would be squashed
       by the label beside it on a narrow node, which is exactly when knowing the
       shape matters most. */
    .pix-ls-shape {
      flex: none; box-sizing: border-box;
      border: 1px solid #999; border-radius: 1px;
    }
    .pix-ls-chip:hover .pix-ls-shape { border-color: #ddd; }
    .pix-ls-chip.on .pix-ls-shape { border-color: #fff; }
    .pix-ls-label { overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.appendChild(style);
}

/** Swatch pixel size for a ratio name. `keep` gets a neutral landscape box. */
export function swatchDims(name) {
  const r = parseRatio(name);
  if (!r) return [12, 9];
  const [rw, rh] = r;
  if (rw >= rh) {
    return [SWATCH_MAX, Math.max(SWATCH_MIN, Math.round((SWATCH_MAX * rh) / rw))];
  }
  return [Math.max(SWATCH_MIN, Math.round((SWATCH_MAX * rw) / rh)), SWATCH_MAX];
}

function ratioTitle(name) {
  if (!parseRatio(name)) {
    return "Keep the picture's own shape: scale it, do not crop it";
  }
  return `Crop to ${name} first, taking the biggest piece of that shape from the picture`;
}

/**
 * Build the face. `onGear` opens the settings panel.
 * Returns { root, refresh } - refresh repaints EVERYTHING, because every
 * control changes the size shown in the band, and a partial repaint is how
 * Portrait Landscape ended up showing a stale preview after a click.
 */
export function buildFace(node, { onGear }) {
  injectCSS();

  const root = document.createElement("div");
  root.className = "pix-ls-root";

  const band = document.createElement("div");
  band.className = "pix-ls-band";

  const step = document.createElement("button");
  step.className = "pix-ls-step";

  const gear = document.createElement("button");
  gear.className = "pix-ls-gear";
  gear.title = "Longest Side settings";
  gear.addEventListener("click", (e) => { e.stopPropagation(); onGear?.(node); });

  const prev = document.createElement("span");
  prev.className = "pix-ls-preview";

  band.append(step, gear, prev);

  const sizeRow = document.createElement("div");
  sizeRow.className = "pix-ls-row";

  const ratioRow = document.createElement("div");
  ratioRow.className = "pix-ls-row";

  root.append(band, sizeRow, ratioRow);

  step.addEventListener("click", (e) => {
    e.stopPropagation();
    writeState(node, { step: nextStep(readState(node).step) });
    refresh();
    node.graph?.setDirtyCanvas?.(true, true);
  });

  // The two rows are REBUILT rather than updated, because the settings panel can
  // change how many entries there are, not just which one is active.
  function buildRows() {
    const st = readState(node);

    sizeRow.textContent = "";
    for (const s of st.sizes) {
      const b = document.createElement("button");
      b.className = "pix-ls-tab" + (s === st.size ? " on" : "");
      b.textContent = String(s);
      b.title = `Make the longer side ${s} pixels`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        writeState(node, { size: s });
        refresh();
        node.graph?.setDirtyCanvas?.(true, true);
      });
      sizeRow.appendChild(b);
    }

    ratioRow.textContent = "";
    for (const r of st.ratios) {
      const b = document.createElement("button");
      b.className = "pix-ls-chip" + (r === st.ratio ? " on" : "");
      b.title = ratioTitle(r);

      const sw = document.createElement("span");
      sw.className = "pix-ls-shape";
      const [sw_w, sw_h] = swatchDims(r);
      sw.style.width = `${sw_w}px`;
      sw.style.height = `${sw_h}px`;

      const lab = document.createElement("span");
      lab.className = "pix-ls-label";
      lab.textContent = r;

      b.append(sw, lab);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        writeState(node, { ratio: r });
        refresh();
        node.graph?.setDirtyCanvas?.(true, true);
      });
      ratioRow.appendChild(b);
    }
  }

  function refresh() {
    const st = readState(node);
    step.textContent = stepLabel(st.step);
    step.classList.toggle("on", st.step > 0);
    step.title = st.step > 0
      ? `Both sides are rounded to the nearest ${st.step} pixels. Click for the next step.`
      : "Sizes go out exactly. Click to round both sides to 8, 16, 32 or 64.";

    const p = previewText(node);
    prev.textContent = p.text;
    prev.classList.toggle("dim", p.dim);
    prev.title = p.title;

    buildRows();
  }

  refresh();
  return { root, refresh };
}
