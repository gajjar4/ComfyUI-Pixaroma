// Save Text Pixaroma - shared state.
//
// THE MODEL, in one sentence: what you see in the node IS what is in the file.
// There is no second copy, so there is nothing to drift. Every write sends the
// WHOLE buffer, which is why a run and a manual Save take the same code path.
//
// Three separate node.properties keys rather than one blob, on purpose:
//   saveTextState   the SETTINGS (folder, name, options). Changes only when the
//                   user changes something.
//   saveTextBuffer  the collected text itself. Changes on every run.
//   saveTextDirty   has the buffer been edited since it was last written?
// Keeping the buffer out of the settings blob keeps a saved workflow readable
// and means a future settings injection (there is none today - see the header
// of nodes/node_save_text.py for why) could never accidentally carry the whole
// collection into the prompt.

export const COMFY_CLASS = "PixaromaSaveText";
export const STATE_PROP = "saveTextState";
export const BUFFER_PROP = "saveTextBuffer";
export const DIRTY_PROP = "saveTextDirty";

export const DEFAULT_STATE = {
  version: 1,
  folder: "", // empty = ComfyUI's output folder
  pattern: "prompts_%counter%",
  counterDigits: 3,
  // Write the file after every run. ON by default: a manual-only save is a save
  // you forget, and forgetting is the exact thing this node exists to stop.
  autoSave: true,
  separator: "blank",
  newest: "bottom", // where a new entry is added: "bottom" | "top"
  skipDupes: "last", // "off" | "last" | "any"
  timestamp: "off", // "off" | "date" | "time" | "datetime"
  // Start a new file once the collection gets this big, so one workflow cannot
  // grow an unbounded buffer inside its own JSON. 0 = never.
  maxEntries: 500,
  // The file this collection is currently writing to, resolved once when the
  // collection starts. Empty means "claim a new name on the next write", which
  // is exactly the state Clear leaves behind - that is what makes Clear safe.
  currentFile: "",
  folded: false, // JS-only: body collapsed to the box + buttons
};

// Separator ids MUST match nodes/_save_text_helpers.py::SEPARATORS. A blank line
// is the default because it is EXACTLY Prompt Pack Pixaroma's paragraph format,
// so a saved .txt drops straight back into the pack.
export const SEPARATORS = {
  blank: "\n\n",
  newline: "\n",
  rule: "\n---\n",
  comma: ", ",
};
export const SEPARATOR_LABELS = [
  ["blank", "Blank line"],
  ["newline", "New line"],
  ["rule", "--- line"],
  ["comma", "Comma"],
];

export function separatorStr(id) {
  return SEPARATORS[id] || SEPARATORS.blank;
}

// Mirror of _save_text_helpers.count_entries. Blank pieces are dropped so a
// trailing separator, or a run of empty lines the user left behind, never
// inflates the number shown on the node.
export function countEntries(text, sepId) {
  if (typeof text !== "string" || !text.trim()) return 0;
  return text.split(separatorStr(sepId)).filter((p) => p.trim()).length;
}

// The entries, as an array. Used for the duplicate check and for the rollover.
export function splitEntries(text, sepId) {
  if (typeof text !== "string" || !text.trim()) return [];
  return text.split(separatorStr(sepId)).filter((p) => p.trim());
}

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try {
      return { ...DEFAULT_STATE, ...JSON.parse(v) };
    } catch {
      /* fall through to defaults */
    }
  }
  return { ...DEFAULT_STATE };
}

export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

export function readBuffer(node) {
  const v = node.properties?.[BUFFER_PROP];
  return typeof v === "string" ? v : "";
}

export function writeBuffer(node, text, dirty) {
  if (!node.properties) node.properties = {};
  node.properties[BUFFER_PROP] = typeof text === "string" ? text : "";
  if (dirty !== undefined) node.properties[DIRTY_PROP] = !!dirty;
}

export function isDirty(node) {
  return !!node.properties?.[DIRTY_PROP];
}

// Add one entry to the buffer, honouring the separator, the newest-first
// setting and the timestamp prefix. Pure: it returns the new text and does not
// touch the node, so the harness can pin it.
export function appendEntry(buffer, entry, st) {
  const body = (st.timestamp && st.timestamp !== "off")
    ? timestampLine(st.timestamp) + "\n" + entry
    : entry;
  const cur = typeof buffer === "string" ? buffer.trim() : "";
  if (!cur) return body;
  const sep = separatorStr(st.separator);
  return st.newest === "top" ? body + sep + cur : cur + sep + body;
}

// Mirror of _save_text_helpers.timestamp_line.
export function timestampLine(fmtId, when) {
  const d = when || new Date();
  const p = (v) => String(v).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (fmtId === "date") return `# ${date}`;
  if (fmtId === "datetime") return `# ${date} ${hm}`;
  if (fmtId === "time") return `# ${hm}:${p(d.getSeconds())}`;
  return "";
}

// Should this incoming text be collected at all?
//
// ComfyUI's own cache already stops the common duplicate (re-queue the same
// prompt and the node does not execute, so no event arrives). This covers the
// case the cache cannot: a workflow reload clears the cache, so the first run
// afterwards would otherwise re-add the prompt that is already the last entry.
export function shouldCollect(buffer, entry, st) {
  if (typeof entry !== "string" || !entry.trim()) return false;
  const mode = st.skipDupes || "last";
  if (mode === "off") return true;
  const entries = splitEntries(buffer, st.separator);
  if (!entries.length) return true;
  const norm = (s) => s.trim();
  const target = norm(entry);
  if (mode === "any") return !entries.some((e) => norm(e) === target);
  return norm(entries[st.newest === "top" ? 0 : entries.length - 1]) !== target;
}

export {
  resolveDateTokens,
  expandNativeTokens,
  normalizePath,
  sanitizePrefixMirror,
} from "../shared/filename_mirror.mjs";
