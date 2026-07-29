// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the things a page can DO             ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Add to canvas, add wired to whatever is selected, drag a card out onto the
// graph, copy the page, and copy a version line for a support question.
//
// "Add wired to selection" is the one that changes what the help is FOR: you
// can read about a node and put it down, correctly connected, without leaving
// the page. Everything else here is convenience.
//
// These are the ONLY places the browser touches the graph, and each one is an
// explicit user action, so the resulting "workflow changed" state is correct.
// Nothing else in the browser writes anything that gets serialized.

import { app } from "/scripts/app.js";
import { PIXAROMA_JS_VERSION } from "../shared/index.mjs";
import { el } from "./window.mjs";
import { readControls } from "./controls.mjs";

const DISCORD_URL = "https://discord.com/invite/gggpkVgBf3";
const YOUTUBE_URL = "https://www.youtube.com/@pixaroma";
const SITE_URL = "https://workflows.pixaroma.com/";

// A node's title is free text restored verbatim from a workflow file, so it is
// UNTRUSTED: a downloaded workflow can name a node `<img onerror=...>`. Toast
// takes HTML on purpose (for <b>), so anything interpolated into it must be
// escaped here first.
export const escText = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// ── toast ────────────────────────────────────────────────────
let toastTimer = null;
export function toast(win, html) {
  let t = win.querySelector(".pixhb-toast");
  if (!t) { t = el("div", "pixhb-toast"); win.appendChild(t); }
  t.innerHTML = html;
  requestAnimationFrame(() => t.classList.add("pixhb-on"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("pixhb-on"), 2800);
}

export function flash(btn, word) {
  // Re-entrancy guard. Double-clicking within the flash window used to capture
  // "Added" as the label to restore, leaving the button permanently wrong.
  if (btn._pixFlashing) return;
  btn._pixFlashing = true;
  const old = btn.textContent;
  btn.textContent = word;
  btn.style.background = "#3ec371";
  btn.style.borderColor = "#3ec371";
  btn.style.color = "#fff";
  setTimeout(() => {
    btn.textContent = old;
    btn.style.background = btn.style.borderColor = btn.style.color = "";
    btn._pixFlashing = false;
  }, 850);
}

// ── placing nodes ────────────────────────────────────────────
// Graph coordinates for the middle of what the user is currently looking at,
// so a new node never lands somewhere off screen.
function centreOfView() {
  try {
    const c = app.canvas;
    const ds = c?.ds;
    const rect = c?.canvas?.getBoundingClientRect?.();
    if (ds && rect) {
      const scale = ds.scale || 1;
      return [
        (-ds.offset[0]) + (rect.width / 2) / scale - 90,
        (-ds.offset[1]) + (rect.height / 2) / scale - 40,
      ];
    }
  } catch { /* fall through to the origin */ }
  return [80, 80];
}

// Graph coordinates for a screen point, so a dropped card lands where it was let go.
export function graphPointFromClient(clientX, clientY) {
  try {
    const c = app.canvas;
    const rect = c?.canvas?.getBoundingClientRect?.();
    const ds = c?.ds;
    if (rect && ds) {
      const scale = ds.scale || 1;
      return [
        (clientX - rect.left) / scale - ds.offset[0] - 90,
        (clientY - rect.top) / scale - ds.offset[1] - 20,
      ];
    }
  } catch { /* fall through */ }
  return centreOfView();
}

export function createNodeAt(comfyClass, pos) {
  const LG = window.LiteGraph;
  if (!LG?.createNode || !app.graph) return null;
  const node = LG.createNode(comfyClass);
  if (!node) return null;
  node.pos = pos || centreOfView();
  app.graph.add(node);
  try {
    app.canvas?.selectNode?.(node);
  } catch { /* selection is a nicety, not a requirement */ }
  app.graph.setDirtyCanvas(true, true);
  return node;
}

// The node the user currently has selected, if exactly one is selected.
export function selectedNode() {
  try {
    const sel = app.canvas?.selected_nodes;
    if (sel) {
      const list = Object.values(sel);
      if (list.length) return list[0];
    }
  } catch { /* no selection is a normal state */ }
  return null;
}

// Connect the first output of `from` whose type an input of `to` accepts.
// Returns the pair of names wired, or null when nothing matches - callers must
// SAY when nothing matched rather than looking like they did nothing.
export function autoWire(from, to) {
  try {
    const outs = from?.outputs || [];
    const ins = to?.inputs || [];
    for (let oi = 0; oi < outs.length; oi++) {
      const ot = outs[oi]?.type;
      if (!ot) continue;
      for (let ii = 0; ii < ins.length; ii++) {
        const it = ins[ii]?.type;
        if (ins[ii]?.link != null) continue;          // already wired, leave it
        const match = it === ot || it === "*" || ot === "*";
        if (!match) continue;
        from.connect(oi, to, ii);
        return { out: outs[oi].name || ot, in: ins[ii].name || it };
      }
    }
  } catch { /* a failed wire is not worth breaking the panel over */ }
  return null;
}

// A node's inputs are not built until it exists, so this reads the DEFINITION
// to answer "could this even be wired to the selection" before we place it.
export function couldWire(fromNode, comfyClass) {
  const slots = readControls(comfyClass);
  if (!slots || !fromNode?.outputs?.length) return false;
  const outTypes = fromNode.outputs.map((o) => o?.type).filter(Boolean);
  return slots.inputs.some((i) => outTypes.some((t) => t === i.type || i.type === "*" || t === "*"));
}

// ── clipboard ────────────────────────────────────────────────
// document.execCommand is kept as a fallback because navigator.clipboard is
// unavailable over plain http, which is exactly how people reach a ComfyUI on
// another machine on their LAN.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the old way */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// The line every support question needs, so nobody has to ask "which version".
export function versionLine() {
  const bits = [`Pixaroma ${PIXAROMA_JS_VERSION}`];
  try {
    const fe = window.__COMFYUI_FRONTEND_VERSION__;
    if (fe) bits.push(`frontend ${fe}`);
  } catch { /* optional */ }
  try {
    bits.push(window.LiteGraph?.vueNodesMode ? "Nodes 2.0" : "Classic nodes");
  } catch { /* optional */ }
  try {
    if (navigator.platform) bits.push(navigator.platform);
  } catch { /* optional */ }
  return bits.join(" / ");
}

// Plain text of a help def, ready to paste into a Discord question.
export function helpAsText(entry) {
  const h = entry.help || {};
  const lines = [h.title || entry.title];
  if (h.tagline) lines.push(h.tagline);
  for (const s of (Array.isArray(h.sections) ? h.sections : []).filter((x) => x && typeof x === "object")) {
    lines.push("", (s.heading || "").toUpperCase());
    if (s.body) lines.push(s.body);
    for (const b of (s.bullets || [])) lines.push("- " + b);
    for (const d of (s.defs || [])) {
      const [t, v] = Array.isArray(d) ? d : [d, ""];
      lines.push(`- ${t}: ${v}`);
    }
  }
  if (h.footer) lines.push("", h.footer);
  lines.push("", versionLine());
  return lines.join("\n");
}

export function openExternal(url) {
  try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* popup blocked */ }
}
export const LINKS = { DISCORD_URL, YOUTUBE_URL, SITE_URL };
