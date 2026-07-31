// Dropdown Pixaroma - state, defaults, and the output slot.
//
// The list and the type belong to the NODE, not to whatever it is wired to.
// That is the whole difference from Control Panel, whose rows adopt the type of
// their target, and it is why this node never reads its own connections to
// decide anything.

import { isGraphLoading } from "../shared/graph_loading.mjs";
import { accentOf } from "../shared/node_settings.mjs";
import { SOCKET_TYPES, normalizeType } from "./coerce.mjs";

export const CLASS = "PixaromaDropdown";

// node.properties key (camelCase) and the Python INPUT_TYPES key (PascalCase).
// They differ in case on purpose, matching every other Pixaroma node - and a
// silent typo in the second one means Python always sees its default and the
// node appears to ignore every change you make, so it is stated twice.
export const STATE_PROP = "dropdownState";
export const HIDDEN_INPUT = "DropdownState";   // matches the Python INPUT_TYPES key

// Geometry. Legacy and Nodes 2.0 both derive from these, so they are the one
// place to tune the row.
export const ROW_H = 26;
export const MIN_W = 210;
export const DEFAULT_W = 250;
export const BODY_PAD = 7;

// A zero-width space. Truthy, so neither renderer falls back to painting the raw
// slot name ("value") on top of our row, but nothing is actually drawn.
// An empty string would fall through litegraph's `||` chain back to slot.name.
// Written as an escape, NOT as a literal U+200B byte: an invisible character in
// source is unreviewable and undiffable (it once cost this project a whole
// debugging session in a regex).
export const ZW = "\u200B";

export const OUT_NAME = "value";

export function defaultState() {
  return { version: 1, type: "text", index: 0, options: [] };
}

/** node -> its state, always a valid object. Never trusts what it finds. */
export function readState(node) {
  const raw = node?.properties?.[STATE_PROP];
  const st = defaultState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return st;

  st.type = normalizeType(raw.type);

  if (Array.isArray(raw.options)) {
    for (const o of raw.options) {
      // Drop a non-object row rather than letting it crash the list later.
      // Control Panel learned this one the hard way: a single null row aborted
      // value injection for every OTHER node of its type on the canvas.
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      st.options.push({
        name: typeof o.name === "string" ? o.name : "",
        value: typeof o.value === "string" ? o.value : (o.value == null ? "" : String(o.value)),
      });
    }
  }

  const n = Number(raw.index);
  st.index = Number.isFinite(n) ? Math.max(0, Math.min(st.options.length - 1, Math.trunc(n))) : 0;
  if (!st.options.length) st.index = 0;
  return st;
}

/**
 * The single write path. Everything that changes the list goes through here so
 * the stored index can never point at a row that is not there.
 *
 * Deliberately NOT diff-gated against the stored object: callers pass a patch
 * and we always re-normalize. It IS safe on the load path only because nothing
 * on the load path calls it - see the note in index.js.
 */
export function writeState(node, patch) {
  if (!node) return defaultState();
  if (!node.properties) node.properties = {};
  const cur = readState(node);
  const next = { ...cur, ...(patch || {}) };

  next.version = 1;
  next.type = normalizeType(next.type);
  next.options = Array.isArray(next.options) ? next.options.map((o) => ({
    name: typeof o?.name === "string" ? o.name : "",
    value: typeof o?.value === "string" ? o.value : (o?.value == null ? "" : String(o.value)),
  })) : [];
  const n = Number(next.index);
  next.index = Number.isFinite(n) ? Math.max(0, Math.min(next.options.length - 1, Math.trunc(n))) : 0;
  if (!next.options.length) next.index = 0;

  node.properties[STATE_PROP] = next;
  return next;
}

/** The currently selected option, or null when the list is empty. */
export function selectedOption(node) {
  const st = readState(node);
  return st.options[st.index] || null;
}

/**
 * What the browser sends Python. ONLY what changes the result.
 *
 * The injected string becomes part of the node's inputs, so ComfyUI hashes it:
 * anything in here that is really display-only would re-run the graph when it
 * changed. Renaming a row, recolouring the node, reordering, or editing a row
 * you have NOT selected must all be free. So the names, the rest of the list and
 * the accent stay out, and Python accepts this lean shape directly.
 */
export function injectedState(node) {
  const st = readState(node);
  const opt = st.options[st.index];
  return { version: 1, type: st.type, value: opt ? opt.value : null };
}

/**
 * Put the chosen type on the output slot so the CANVAS refuses an incompatible
 * drag. Python declares ANY; this is the frontend half of that, and there is no
 * second server-side check behind it.
 *
 * Every write is diff-gated. Slots are serialized, and re-writing an identical
 * value still counts as a change on some builds, which would flag a clean
 * workflow "modified" the moment it was opened (Vue Compat #18).
 */
export function syncOutput(node) {
  if (!node?.outputs?.length) return;
  const want = SOCKET_TYPES[readState(node).type] || "*";
  const out = node.outputs[0];
  if (out.name !== OUT_NAME) out.name = OUT_NAME;
  if (out.label !== ZW) out.label = ZW;
  if (out.type !== want) out.type = want;
}

/**
 * Drop a wire the new type can no longer feed. A real user action ONLY.
 *
 * Returns the number of links cut so the caller can say so - silently severing
 * a connection the user cannot see them lose is how a workflow quietly stops
 * working. Never runs during a load: the saved graph is by definition already
 * consistent, and cutting there would damage a file just by opening it.
 */
export function dropIncompatibleLinks(node) {
  if (!node?.outputs?.length || isGraphLoading()) return 0;
  const out = node.outputs[0];
  const links = Array.isArray(out.links) ? out.links.slice() : [];
  if (!links.length) return 0;

  const graph = node.graph;
  if (!graph) return 0;
  const want = out.type;
  let cut = 0;

  for (const id of links) {
    let link = graph.links?.[id];
    // graph.links can be a Map on newer frontends (Vue Compat #3).
    if (!link && typeof graph.links?.get === "function") link = graph.links.get(id);
    if (!link) continue;
    const target = graph.getNodeById?.(link.target_id);
    const slot = target?.inputs?.[link.target_slot];
    if (!slot) continue;
    const accepts = slot.type;
    // "*" on either side means anything goes (Reroute, Set/Get, Preview Any).
    if (accepts === "*" || want === "*" || accepts === want) continue;
    target.disconnectInput?.(link.target_slot);
    cut++;
  }
  return cut;
}

export { accentOf };
