// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Monitor Pixaroma - the classic renderer's face, painted on the canvas   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// WHY canvas and not a DOM widget: this node is TITLE-LESS, and a DOM element
// sitting on top of the LiteGraph canvas cannot behave like a node. Made
// click-through it hands its clicks to the BROWSER (you get the back/forward
// context menu, not the node menu), and left clickable it eats the drag. So in
// the classic renderer the face is painted straight onto the node and LiteGraph
// keeps its drag and its right-click for free. This is the Label / Run Timer
// recipe (.claude/patterns/run-timer.md #4c).
//
// The buttons are hit-tested against the SAME rects this file paints, cached on
// a runtime field, which is the Compare / Preview pattern for canvas controls.

import { accentOf } from "../shared/node_settings.mjs";
import { M, faceBlocks, barColor, barRows, scalarItems } from "./core.mjs";

function rr(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Centre text on its ACTUAL glyph box. A digits-only string sits visibly high
// with textBaseline "middle", because that baseline is computed from the font's
// full em box including descenders no digit has (the same trap Run Timer's
// fillTextVC exists for). Called once per whole string, NEVER per character.
function textVC(ctx, text, x, yMid, align) {
  ctx.textAlign = align || "left";
  const m = ctx.measureText(text);
  if (m && m.actualBoundingBoxAscent != null && m.actualBoundingBoxDescent != null) {
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, yMid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, yMid);
  }
}

const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

export function paintFace(node, ctx, st, sample, peak) {
  const s = node._pmScale || 1;
  const W = node.size[0];
  const H = node.size[1];
  const acc = accentOf(node);
  const blocks = faceBlocks(node, st, sample, peak);

  // The node BODY is already painted as the dark screen by the drawNode wrap in
  // index.js (matching bgcolor + radius + no shadow), so there is no panel to
  // draw here - only the contents.
  const x0 = M.padX * s;
  const x1 = W - M.padX * s;
  const avail = x1 - x0;
  const rects = [];

  let y = M.padY * s;
  blocks.forEach((b, i) => {
    if (i) y += M.gap * s;
    const h = b.h * s;
    if (y + h > H - M.padY * s + 0.5) {
      // Out of room: stop rather than spilling past the frame. Only reachable
      // for a frame or two while a row is being switched on, since the node is
      // resized to fit right after.
      y += h;
      return;
    }
    switch (b.kind) {
      case "title": paintTitle(ctx, node, b, x0, x1, y, h, s, acc); break;
      case "bar": paintBar(ctx, b.row, st, peak, x0, avail, y, h, s, acc); break;
      case "strip": paintStrip(ctx, b.items, x0, y, h, s); break;
      case "strip1": paintStrip1(ctx, node, st, sample, peak, x0, avail, y, h, s, acc); break;
      case "buttons": paintButtons(ctx, node, b.items, x0, avail, y, h, s, acc, rects); break;
      default: break;
    }
    y += h;
  });

  node._pmBtnRects = rects;
}

function paintTitle(ctx, node, b, x0, x1, y, h, s, acc) {
  const mid = y + h / 2;
  const r = 2.5 * s;
  ctx.fillStyle = node._pmRunning ? acc : (node._pmOffline ? "#5a5a60" : "#3ec371");
  ctx.beginPath();
  ctx.arc(x0 + r, mid, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `${Math.round(M.titleFont * s)}px ${MONO}`;
  ctx.fillStyle = "#6b6b72";
  const text = (b.text || (node._pmOffline ? "Connecting" : "System")).toUpperCase();
  textVC(ctx, fit(ctx, text, x1 - (x0 + r * 2 + 5 * s)), x0 + r * 2 + 5 * s, mid, "left");
}

// A track this short says nothing, so below it the bar is dropped rather than
// squeezed. In scale-1 pixels.
const MIN_TRACK = 18;

function paintBar(ctx, row, st, peak, x0, avail, y, h, s, acc) {
  const mid = y + h / 2;
  const g = 7 * s;
  let lw = M.labelW * s;
  let vw = M.valueW * s;
  // WHAT GOES FIRST WHEN THERE IS NOT ENOUGH ROOM: the bar, then the label, and
  // the NUMBER survives to the end. The number is the reading; a bar with no
  // number beside it is decoration. (The first version dropped the number
  // first, and a node dragged tall but left narrow showed four unlabelled bars.)
  let tw = avail - lw - vw - g * 2;
  if (tw < MIN_TRACK * s) { lw = 0; tw = avail - vw - g; }   // drop the label
  if (tw < MIN_TRACK * s) { tw = 0; }                        // drop the bar too

  let x = x0;
  ctx.font = `${Math.round(M.font * s)}px ${MONO}`;
  if (lw > 0) {
    ctx.fillStyle = "#8a8a8a";
    textVC(ctx, fit(ctx, row.label, lw), x, mid, "left");
    x += lw + g;
  }

  if (tw > 0) {
    const bh = M.barH * s;
    const by = mid - bh / 2;
    ctx.fillStyle = "rgba(255,255,255,0.055)";
    rr(ctx, x, by, tw, bh, M.barR * s);
    ctx.fill();
    if (row.pct != null && row.pct > 0) {
      ctx.fillStyle = barColor(row.pct, acc, st.warn);
      rr(ctx, x, by, Math.max(2 * s, (tw * row.pct) / 100), bh, M.barR * s);
      ctx.fill();
    }
    if (row.key === "vram" && st.show.peak && peak && peak.pct > 0) {
      const pxPos = x + (tw * Math.min(99.4, peak.pct)) / 100;
      ctx.fillStyle = "#ffd9cd";
      ctx.fillRect(pxPos, by - s, Math.max(1, 2 * s), bh + s * 2);
    }
    x += tw;
  }

  if (vw > 0) {
    x += g;
    // The unit is drawn dimmer and a shade smaller, so the NUMBER is what the
    // eye lands on. Right-aligned, so the digits line up down the column.
    const tail = row.tail ?? "";
    const main = row.main ?? "";
    ctx.font = `${Math.round(M.font * s * 0.86)}px ${MONO}`;
    const tailW = ctx.measureText(tail).width;
    ctx.fillStyle = "#6b6b72";
    textVC(ctx, tail, x0 + avail, mid, "right");
    ctx.font = `${Math.round(M.font * s)}px ${MONO}`;
    ctx.fillStyle = "#e0e0e0";
    textVC(ctx, main, x0 + avail - tailW, mid, "right");
  }
}

function paintStrip(ctx, items, x0, y, h, s) {
  const mid = y + h / 2;
  let x = x0;
  for (const it of items) {
    ctx.font = `${Math.round(M.stripFont * s)}px ${MONO}`;
    ctx.fillStyle = "#8a8a8a";
    const lab = it.label + " ";
    textVC(ctx, lab, x, mid, "left");
    x += ctx.measureText(lab).width;
    ctx.fillStyle = it.hot ? "#e8a33d" : "#e0e0e0";
    textVC(ctx, it.text, x, mid, "left");
    x += ctx.measureText(it.text).width + 9 * s;
  }
}

function paintStrip1(ctx, node, st, sample, peak, x0, avail, y, h, s, acc) {
  const mid = y + h / 2;
  const segs = [];
  for (const r of barRows(node, st, sample)) {
    segs.push({
      label: r.label,
      pct: r.pct,
      text: (r.main ?? "") + (r.key === "gpu" || r.key === "cpu" ? "%" : ""),
    });
  }
  for (const it of scalarItems(st, sample, peak)) segs.push({ label: null, text: it.text, hot: it.hot });
  if (!segs.length) {
    ctx.font = `${Math.round(M.font * s)}px ${MONO}`;
    ctx.fillStyle = "#6b6b72";
    textVC(ctx, sample ? "Nothing to show" : "Connecting", x0, mid, "left");
    return;
  }

  ctx.font = `${Math.round(M.font * s)}px ${MONO}`;
  let x = x0;
  const limit = x0 + avail;
  segs.forEach((sg, i) => {
    if (x >= limit) return;
    if (i) {
      ctx.fillStyle = "#3a3a3a";
      textVC(ctx, " · ", x, mid, "left");
      x += ctx.measureText(" · ").width;
    }
    if (sg.label) {
      ctx.fillStyle = "#8a8a8a";
      const lab = sg.label + " ";
      textVC(ctx, lab, x, mid, "left");
      x += ctx.measureText(lab).width;
      if (sg.pct != null) {
        const mw = 30 * s;
        const mh = 5 * s;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        rr(ctx, x, mid - mh / 2, mw, mh, 2 * s);
        ctx.fill();
        ctx.fillStyle = barColor(sg.pct, acc, st.warn);
        rr(ctx, x, mid - mh / 2, Math.max(2 * s, (mw * sg.pct) / 100), mh, 2 * s);
        ctx.fill();
        x += mw + 5 * s;
      }
    }
    ctx.fillStyle = sg.hot ? "#e8a33d" : "#e0e0e0";
    textVC(ctx, sg.text, x, mid, "left");
    x += ctx.measureText(sg.text).width;
  });
}

function paintButtons(ctx, node, items, x0, avail, y, h, s, acc, rects) {
  const g = 5 * s;
  const n = items.length;
  const w = (avail - g * (n - 1)) / n;
  if (w < 24 * s) return;   // no room: the gear panel still has the actions
  const hoverKey = node._pmHoverBtn;
  items.forEach((b, i) => {
    const x = x0 + i * (w + g);
    const hot = hoverKey === b.key;
    rr(ctx, x, y, w, h, 4 * s);
    ctx.fillStyle = hot ? acc : "rgba(255,255,255,0.045)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.8);
    ctx.strokeStyle = hot ? acc : "rgba(255,255,255,0.13)";
    ctx.stroke();
    ctx.font = `${Math.round(M.btnFont * s)}px ${MONO}`;
    ctx.fillStyle = hot ? "#ffffff" : "rgba(255,255,255,0.72)";
    const flash = node._pmFlash && node._pmFlash.key === b.key ? node._pmFlash.label : null;
    if (flash) {
      rr(ctx, x, y, w, h, 4 * s);
      ctx.fillStyle = "#3ec371";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
    }
    textVC(ctx, fit(ctx, flash || b.label, w - 8 * s), x + w / 2, y + h / 2, "center");
    rects.push({ key: b.key, x, y, w, h });
  });
}

/** Trim a string with an ellipsis until it fits, so nothing ever overflows. */
function fit(ctx, text, max) {
  let t = String(text ?? "");
  if (max <= 0) return "";
  if (ctx.measureText(t).width <= max) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

/** The button under a node-local point, or null. */
export function hitButton(node, lx, ly) {
  for (const r of node._pmBtnRects || []) {
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return r.key;
  }
  return null;
}

/** Node-local cursor position from the canvas, for the free per-frame hover. */
export function localMouse(node) {
  try {
    const gm = node.graph?.list_of_graphcanvas?.[0]?.graph_mouse
      || window.app?.canvas?.graph_mouse;
    if (!gm) return null;
    return [gm[0] - node.pos[0], gm[1] - node.pos[1]];
  } catch (_e) {
    return null;
  }
}
