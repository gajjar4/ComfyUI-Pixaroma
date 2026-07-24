// Prompt Pixaroma - where a list / category is UP TO when it is not on Random.
//
// Pure random repeats (1,1,3,2,1 is normal), so a #list or *category can also run:
//   * shuffle - a deck: every option comes up once before any repeat, then it
//     reshuffles (and the new deck never opens with the card the old one ended on)
//   * order   - 1,2,3,... looping
// Both need to remember a POSITION between runs. That position lives here, in its own
// unregistered setting - NEVER in the workflow (a run must not dirty it, Vue Compat
// #18) and NEVER in the library blob (so an export carries your tags, not how far
// through them you happen to be).
//
// A cursor is keyed "list:<tag>" / "cat:<category>" (lower-cased), so it belongs to
// the list itself: two Prompt nodes using #poses walk the same sequence, which is
// what "this list is in order" means. Editing the list to a different length starts
// its deck over.

import { app } from "/scripts/app.js";

const CURSOR_SETTING = "Pixaroma.Prompt.Cursors";
export const MODES = ["random", "shuffle", "order"];
export const MODE_LABEL = { random: "Random", shuffle: "Shuffle", order: "In order" };
export function isMode(m) { return MODES.includes(m); }
export function cleanMode(m) { return isMode(m) ? m : "random"; }

export const listKey = (name) => "list:" + String(name).toLowerCase();
export const catKey = (name) => "cat:" + String(name).toLowerCase();

let _data = null;
let _timer = null;

function settingsApi() {
  const s = app.ui?.settings;
  return s && typeof s.getSettingValue === "function" ? s : null;
}
function all() {
  if (_data) return _data;
  const s = settingsApi();
  if (!s) return {};                       // settings not ready: don't cache an empty map
  const raw = s.getSettingValue(CURSOR_SETTING);
  try { _data = (raw && typeof raw === "string" ? JSON.parse(raw) : raw) || {}; }
  catch { _data = {}; }
  if (!_data || typeof _data !== "object") _data = {};
  return _data;
}
function persist() {
  const s = app.ui?.settings;
  if (!s || !_data) return;
  const json = JSON.stringify(_data);
  try {
    if (typeof s.setSettingValueAsync === "function") s.setSettingValueAsync(CURSOR_SETTING, json);
    else if (typeof s.setSettingValue === "function") s.setSettingValue(CURSOR_SETTING, json);
  } catch { /* non-fatal: still correct in memory for this session */ }
}
// Runs happen in bursts (a queue of 10 fires ten picks), so coalesce the writes.
function touch() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { persist(); _timer = null; }, 300);
}
export function flushCursors() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  persist();
}

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The index to use NOW, advancing the cursor. `len` is the current pool size, so a
// list that was edited to a different length starts its sequence over.
export function nextIndex(key, len, mode) {
  const n = Math.floor(len);
  if (!(n > 0)) return -1;
  const m = cleanMode(mode);
  if (m === "random" || n === 1) return Math.floor(Math.random() * n);
  const map = all();
  let st = map[key];
  if (!st || typeof st !== "object" || st.n !== n) st = null;   // pool changed -> restart

  if (m === "order") {
    const i = st && Number.isInteger(st.i) ? ((st.i % n) + n) % n : 0;
    map[key] = { n, i: (i + 1) % n, last: i };
    touch();
    return i;
  }
  // shuffle: deal from a deck, reshuffle when it runs out
  let bag = st && Array.isArray(st.bag) ? st.bag.filter((x) => Number.isInteger(x) && x >= 0 && x < n) : null;
  const last = st && Number.isInteger(st.last) ? st.last : -1;
  if (!bag || !bag.length) {
    bag = shuffled(n);
    // Don't open a new deck with the card the old one closed on - that is exactly the
    // back-to-back repeat this mode exists to avoid.
    if (n > 1 && bag[bag.length - 1] === last) { const t = bag.pop(); bag.unshift(t); }
  }
  const i = bag.pop();
  map[key] = { n, bag, last: i };
  touch();
  return i;
}

// What to show in the library: how far through the sequence this cursor is.
// Returns null for random (nothing to show) or when nothing has run yet.
export function cursorInfo(key, len, mode) {
  const n = Math.floor(len);
  const m = cleanMode(mode);
  if (m === "random" || !(n > 0)) return null;
  const st = all()[key];
  if (!st || typeof st !== "object" || st.n !== n) return m === "order" ? `next 1 of ${n}` : `${n} left`;
  if (m === "order") {
    const i = Number.isInteger(st.i) ? ((st.i % n) + n) % n : 0;
    return `next ${i + 1} of ${n}`;
  }
  const left = Array.isArray(st.bag) ? st.bag.length : 0;
  return `${left || n} left in the deck`;
}

// Start this list / category over (the deck reshuffles, the counter returns to 1).
export function resetCursor(key) {
  const map = all();
  if (map[key]) { delete map[key]; touch(); }
}
