// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the generated wiring diagram         ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Draws a small picture of a node from the node's OWN definition: inputs down
// the left, outputs down the right, widgets underneath, dots coloured by wire
// type so matching colours plug together.
//
// Why generated rather than a screenshot:
//   - No image files at all. The whole thing is a few KB of code, against
//     roughly 2 MB for a screenshot of every node.
//   - It CANNOT go stale. Add an output to a node next month and every diagram
//     redraws itself. A screenshot goes out of date silently, which is worse
//     than having no picture.
//   - It works in both renderers, because we draw it ourselves.
//   - It answers the question people actually ask. A screenshot shows buttons;
//     the confusion is what plugs into what, and this is literally that.
//
// A picture is still the right answer for the handful of nodes whose FACE is
// the thing being explained (the editors, Outpaint's drag preview, Compare's
// slider). Those get a real image above this diagram; see content.mjs.
//
// If the definition cannot be read, this returns null and the page simply has
// no diagram. Never an error, never a hole.

import { el } from "./window.mjs";

// Primitive types are drawn by ComfyUI as WIDGETS (a field in the node body);
// everything else gets a connectable slot with a dot. Same rule we use here so
// the diagram matches what the user actually sees on the canvas.
const PRIMITIVE = new Set(["INT", "FLOAT", "STRING", "BOOLEAN"]);

// Wire colours, close to ComfyUI's own, so the diagram reads like the canvas.
// Anything unlisted (our own PIX_* bundle types) shares one warm tone.
const TYPE_COLOR = {
  IMAGE: "#64b5f6", MASK: "#81c784", LATENT: "#ff8a80", AUDIO: "#ffb74d",
  INT: "#4fc3f7", FLOAT: "#4fc3f7", STRING: "#ce93d8", BOOLEAN: "#ce93d8",
  COMBO: "#ce93d8", MODEL: "#f48fb1", CLIP: "#ffd54f", VAE: "#a5d6a7",
  CONDITIONING: "#ffab91", "*": "#bdbdbd",
};
const colorFor = (t) => TYPE_COLOR[t] || "#f0a58c";

// A ComfyUI input spec is [type, options]. `type` is a string for a real type,
// or an ARRAY of choices for a combo (a dropdown), which is a widget.
function typeOf(spec) {
  const t = Array.isArray(spec) ? spec[0] : spec;
  if (Array.isArray(t)) return "COMBO";
  return typeof t === "string" ? t : "?";
}

// Read the live definition. Registry first (already how xy_plot and pause_image
// read node defs); no network call, so this works offline like everything else.
export function nodeDefFor(comfyClass) {
  try {
    const reg = window.LiteGraph?.registered_node_types || {};
    return reg[comfyClass]?.nodeData || null;
  } catch {
    return null;
  }
}

// -> { inputs:[{name,type}], widgets:[{name,type}], outputs:[{name,type}], isOutput }
export function readSlots(comfyClass) {
  const def = nodeDefFor(comfyClass);
  if (!def) return null;

  const inputs = [], widgets = [];
  // `hidden` inputs are deliberately skipped: they carry our serialized state
  // and never appear on the node, so showing them would be a lie.
  for (const bucket of ["required", "optional"]) {
    const group = def.input?.[bucket];
    if (!group) continue;
    for (const [name, spec] of Object.entries(group)) {
      const type = typeOf(spec);
      const opts = Array.isArray(spec) ? spec[1] : null;
      // forceInput turns a primitive into a real wired slot, so honour it.
      const forced = !!(opts && typeof opts === "object" && opts.forceInput);
      // A real widget row shows its VALUE, so show the default the node ships
      // with. It is the closest thing the definition knows to what the reader
      // will see, and a bare name looked nothing like the node.
      let dflt;
      if (opts && typeof opts === "object" && opts.default !== undefined) dflt = opts.default;
      else if (Array.isArray(spec) && Array.isArray(spec[0]) && spec[0].length) dflt = spec[0][0];
      (PRIMITIVE.has(type) || type === "COMBO") && !forced
        ? widgets.push({ name, type, dflt })
        : inputs.push({ name, type });
    }
  }

  const outTypes = def.output || [];
  const outNames = def.output_name || [];
  const outputs = outTypes.map((t, i) => ({
    name: outNames[i] || (typeof t === "string" ? t.toLowerCase() : "out"),
    type: Array.isArray(t) ? "COMBO" : t,
  }));

  return { inputs, widgets, outputs, isOutput: !!def.output_node };
}

function slotSide(item, isOut) {
  const s = el("div", "pixhb-side-" + (isOut ? "out" : "in"));
  const dot = el("span", "pixhb-dot");
  dot.style.background = colorFor(item.type);
  s.append(dot, el("span", "pixhb-sname", item.name), el("span", "pixhb-stype", item.type));
  return s;
}

export function buildSchematic(comfyClass, displayName) {
  const s = readSlots(comfyClass);
  if (!s) return null;
  if (!s.inputs.length && !s.widgets.length && !s.outputs.length) return null;

  const wrap = el("div", "pixhb-shot");
  const card = el("div", "pixhb-scard");

  // No crown: a real Pixaroma node title carries none. The crown is part of the
  // Add Node menu path ("👑 Pixaroma/..."), and putting it here made the
  // diagram look like a node nobody has.
  const bar = el("div", "pixhb-sbar");
  bar.appendChild(el("span", null, displayName || comfyClass));
  card.appendChild(bar);

  const rows = el("div", "pixhb-srows");
  const n = Math.max(s.inputs.length, s.outputs.length);
  for (let i = 0; i < n; i++) {
    const row = el("div", "pixhb-srow");
    if (s.inputs[i]) row.appendChild(slotSide(s.inputs[i], false));
    if (s.outputs[i]) row.appendChild(slotSide(s.outputs[i], true));
    rows.appendChild(row);
  }
  if (n) card.appendChild(rows);

  if (s.widgets.length) {
    const w = el("div", "pixhb-swid");
    s.widgets.forEach((x) => {
      const row = el("span", "pixhb-wp");
      row.appendChild(el("span", "pixhb-wp-n", x.name));
      if (x.dflt !== undefined && x.dflt !== "") {
        const v = String(x.dflt);
        row.appendChild(el("span", "pixhb-wp-v", v.length > 22 ? v.slice(0, 21) + "…" : v));
      }
      w.appendChild(row);
    });
    card.appendChild(w);
  }
  if (s.isOutput && !s.outputs.length) {
    card.appendChild(el("div", "pixhb-send", "End of the line - nothing comes out of this one."));
  }
  wrap.appendChild(card);

  // Legend, only for the types actually on this node.
  const types = [...new Set([...s.inputs, ...s.outputs].map((x) => x.type))];
  if (types.length > 1) {
    const lg = el("div", "pixhb-slegend");
    types.forEach((t) => {
      const item = el("span");
      const i = el("i");
      i.style.background = colorFor(t);
      item.append(i, el("span", null, t));
      lg.appendChild(item);
    });
    wrap.appendChild(lg);
  }

  wrap.appendChild(el("div", "pixhb-scap", "Drawn from the node itself, so it is always up to date."));
  return wrap;
}
