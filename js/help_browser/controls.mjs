// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - what each control does                ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Replaced the drawn wiring diagram (removed 2026-07-28). A picture of a node
// drawn from its definition could never show the thing people actually get
// stuck on - what a particular button or field is FOR - and it did not look
// enough like the real node to be worth the space.
//
// This lists the node's inputs, settings and outputs as a plain reference, and
// where the node's Python already carries a `tooltip` or an OUTPUT_TOOLTIPS
// entry, that text is used as the explanation. So it is exactly as good as the
// documentation the node already ships with, it never contradicts the node,
// and writing a tooltip improves BOTH the ComfyUI Info panel and this page at
// once. Nothing to keep in sync.
//
// What it deliberately does NOT try to cover: buttons that live in the node's
// JS (Load Image's Upload, the editors' Open buttons, Resolution's ratio
// chips). Those are not in the definition and cannot be read from it - they
// are documented by hand in the node's help def, which is the right place for
// prose about a custom face.

import { el } from "./window.mjs";

const PRIMITIVE = new Set(["INT", "FLOAT", "STRING", "BOOLEAN"]);

function typeOf(spec) {
  const t = Array.isArray(spec) ? spec[0] : spec;
  if (Array.isArray(t)) return "choice";
  return typeof t === "string" ? t : "?";
}

export function nodeDefFor(comfyClass) {
  try {
    return window.LiteGraph?.registered_node_types?.[comfyClass]?.nodeData || null;
  } catch {
    return null;
  }
}

// -> { inputs, settings, outputs } where each entry is {name, type, tip, dflt}
export function readControls(comfyClass) {
  const def = nodeDefFor(comfyClass);
  if (!def) return null;

  const inputs = [], settings = [];
  // `hidden` inputs carry our serialized state and never appear on the node,
  // so listing them would describe something the reader cannot see.
  for (const bucket of ["required", "optional"]) {
    const group = def.input?.[bucket];
    if (!group) continue;
    for (const [name, spec] of Object.entries(group)) {
      const type = typeOf(spec);
      const opts = Array.isArray(spec) ? spec[1] : null;
      const o = (opts && typeof opts === "object") ? opts : {};
      const forced = !!o.forceInput;
      const entry = {
        name,
        type,
        tip: typeof o.tooltip === "string" ? o.tooltip : "",
        dflt: o.default,
        optional: bucket === "optional",
        choices: Array.isArray(spec) && Array.isArray(spec[0]) ? spec[0] : null,
      };
      // A primitive is a field you type in; anything else is a socket you wire.
      (PRIMITIVE.has(type) || type === "choice") && !forced
        ? settings.push(entry)
        : inputs.push(entry);
    }
  }

  const types = def.output || [];
  const names = def.output_name || [];
  const tips = def.output_tooltips || [];
  const outputs = types.map((t, i) => ({
    name: names[i] || (typeof t === "string" ? t.toLowerCase() : "out"),
    type: Array.isArray(t) ? "choice" : t,
    tip: typeof tips[i] === "string" ? tips[i] : "",
  }));

  return { inputs, settings, outputs, isOutput: !!def.output_node };
}

function row(item, showDefault) {
  const r = el("div", "pixhb-ctl");
  const head = el("div", "pixhb-ctl-h");
  head.appendChild(el("span", "pixhb-ctl-n", item.name));
  head.appendChild(el("span", "pixhb-ctl-t", item.type));
  if (item.optional) head.appendChild(el("span", "pixhb-ctl-opt", "optional"));
  if (showDefault && item.dflt !== undefined && item.dflt !== "") {
    head.appendChild(el("span", "pixhb-ctl-d", "default " + String(item.dflt)));
  }
  r.appendChild(head);
  if (item.tip) r.appendChild(el("div", "pixhb-ctl-tip", item.tip));
  // A choice field is far clearer when you can see the options.
  if (item.choices && item.choices.length && item.choices.length <= 12) {
    const c = el("div", "pixhb-ctl-ch");
    item.choices.forEach((v) => c.appendChild(el("span", "pixhb-ctl-chv", String(v))));
    r.appendChild(c);
  }
  return r;
}

function group(title, items, showDefault, note) {
  if (!items.length) return null;
  const sec = el("div", "pixhb-sect");
  sec.appendChild(el("p", "pixhb-h", title));
  if (note) sec.appendChild(el("p", "pixhb-ctl-note", note));
  const box = el("div", "pixhb-ctls");
  items.forEach((it) => box.appendChild(row(it, showDefault)));
  sec.appendChild(box);
  return sec;
}

// Returns an array of sections, or [] when the node has nothing to list.
export function buildControls(comfyClass) {
  const c = readControls(comfyClass);
  if (!c) return [];
  const out = [];
  const inputs = group("What you wire in", c.inputs, false);
  const settings = group("The settings on the node", c.settings, true);
  const outputs = group("What comes out", c.outputs, false);
  if (inputs) out.push(inputs);
  if (settings) out.push(settings);
  if (outputs) out.push(outputs);
  else if (c.isOutput) {
    const sec = el("div", "pixhb-sect");
    sec.appendChild(el("p", "pixhb-h", "What comes out"));
    sec.appendChild(el("p", "pixhb-ctl-note", "Nothing. This is the end of a chain - it shows or saves what reaches it."));
    out.push(sec);
  }
  return out;
}
