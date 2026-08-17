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
  // Type-check the LOOKUP, do not just test it for truthiness. A plain-object
  // index walks the prototype chain, and every Object.prototype member is
  // truthy, so `SEPARATORS[id] || blank` handed back a FUNCTION for ids like
  // "constructor", "toString" or "__proto__". appendEntry then joined entries
  // with a stringified function and wrote that into the user's .txt - MEASURED:
  // "a" + "b" came out as `afunction Object() { [native code] }b`. It also made
  // splitEntries collapse the whole buffer to one entry, silently disabling the
  // duplicate guard.
  //
  // Only reachable from a hand-edited or third-party workflow JSON, but a
  // workflow is a shared artefact. This also restores parity with the Python
  // side, which was already safe via isinstance(str) + .get(default).
  const s = SEPARATORS[id];
  return typeof s === "string" ? s : SEPARATORS.blank;
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
// The SECOND belt. The first is the execution_cached gate in index.js, which
// drops the replayed result of a node ComfyUI did not actually re-run. (Note
// that the cache alone is NOT enough - a cached node still has its ui payload
// replayed to the browser; see the comment on _cachedThisRun.) This covers what
// that cannot: a workflow reload clears ComfyUI's cache, so the first run
// afterwards genuinely executes and would otherwise re-add the prompt that is
// already the last entry.
export function shouldCollect(buffer, entry, st) {
  if (typeof entry !== "string" || !entry.trim()) return false;
  const mode = st.skipDupes || "last";
  if (mode === "off") return true;
  const entries = splitEntries(buffer, st.separator);
  if (!entries.length) return true;

  // appendEntry stores the timestamp INSIDE the entry, so a STORED entry reads
  // "# 2026-08-17\nHello" while the incoming text is still bare "Hello".
  // Comparing them raw could never match, which made "Skip repeats" silently
  // dead for anyone with timestamps on - exactly the reopen-a-workflow case the
  // help advertises. MEASURED before this fix: shouldCollect returned true for
  // an entry identical to the last one.
  //
  // The normalisation is ASYMMETRIC on purpose: strip only from the STORED
  // side, because the incoming text never carries a timestamp. That keeps a
  // prompt whose OWN first line starts with "#" comparing correctly - stored is
  // "# 2026-08-17\n# my note\nbody", one line comes off, and it matches the
  // incoming "# my note\nbody". Stripping both sides would have made two
  // prompts differing only in a leading "#" line look identical.
  const stamped = !!st.timestamp && st.timestamp !== "off";
  const stored = (s) => {
    const t = String(s).trim();
    return stamped ? t.replace(/^#[^\n]*\n/, "").trim() : t;
  };
  const target = String(entry).trim();
  if (mode === "any") return !entries.some((e) => stored(e) === target);
  return stored(entries[st.newest === "top" ? 0 : entries.length - 1]) !== target;
}

export {
  resolveDateTokens,
  expandNativeTokens,
  normalizePath,
  sanitizePrefixMirror,
} from "../shared/filename_mirror.mjs";
