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
// Shuffle leads because it is what people mean by "random": a surprise every time
// WITHOUT the same option landing twice in a row. It is also the DEFAULT, so a list
// with no mode of its own shuffles - true Random has to be asked for.
export const MODES = ["shuffle", "random", "order"];
export const DEFAULT_MODE = "shuffle";
export const MODE_LABEL = { random: "Random", shuffle: "Shuffle", order: "In order" };
export function isMode(m) { return MODES.includes(m); }
export function cleanMode(m) { return isMode(m) ? m : DEFAULT_MODE; }
// Does this mode keep a place between runs? (Random picks fresh every time, so it has
// no position to show and nothing to start over.) Distinct from "is the default".
export function hasPosition(m) { return cleanMode(m) !== "random"; }

export const listKey = (name) => "list:" + String(name).toLowerCase();
export const catKey = (name) => "cat:" + String(name).toLowerCase();

let _data = null;
let _loaded = false;
let _timer = null;

function settingsApi() {
  const s = app.ui?.settings;
  return s && typeof s.getSettingValue === "function" ? s : null;
}
// The cursor map, or NULL when settings are not ready yet. Null rather than an empty
// object on purpose: caching {} would hide the saved positions forever once settings
// DID arrive, and handing back a throwaway object would let a pick "advance" a
// sequence that is then silently dropped. Callers degrade instead (see nextIndex).
function all() {
  if (_loaded) return _data;
  const s = settingsApi();
  if (!s) return null;
  const raw = s.getSettingValue(CURSOR_SETTING);
  try { _data = (raw && typeof raw === "string" ? JSON.parse(raw) : raw) || {}; }
  catch { _data = {}; }
  if (!_data || typeof _data !== "object" || Array.isArray(_data)) _data = {};
  _loaded = true;
  return _data;
}
function persist() {
  const s = app.ui?.settings;
  if (!s || !_loaded || !_data) return;
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
// Queue a run and close the tab inside the 300ms debounce and that run's advance
// would be lost. Best-effort flush on the way out (the write may still be cut short
// by the browser, but it costs nothing to try).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => { try { flushCursors(); } catch { /* ignore */ } });
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
  // Nowhere to remember a position (settings not ready). Fall back to a plain random
  // pick rather than pretending to sequence and dropping the result.
  if (!map) return Math.floor(Math.random() * n);
  let st = map[key];
  if (!st || typeof st !== "object" || st.n !== n) st = null;   // pool changed -> restart

  if (m === "order") {
    const i = st && Number.isInteger(st.i) ? ((st.i % n) + n) % n : 0;
    map[key] = { n, i: (i + 1) % n, last: i };
    touch();
    return i;
  }
  // shuffle: deal from a deck, reshuffle when it runs out.
  // A stored deck must be DISTINCT in-range indices. Filtering out the bad entries
  // (the old behaviour) would happily deal a corrupt deck like [0,0,1] - a repeat
  // inside one deck, which is the one thing this mode promises never to do - so a
  // deck that fails the check is thrown away and reshuffled instead.
  let bag = null;
  if (st && Array.isArray(st.bag)) {
    const seen = new Set();
    let ok = true;
    for (const x of st.bag) {
      if (!Number.isInteger(x) || x < 0 || x >= n || seen.has(x)) { ok = false; break; }
      seen.add(x);
    }
    if (ok) bag = st.bag.slice();
  }
  const last = st && Number.isInteger(st.last) ? st.last : -1;
  if (!bag || !bag.length) {
    bag = shuffled(n);
    // Don't open a new deck with the card the old one closed on - that is exactly the
    // back-to-back repeat this mode exists to avoid. Cards are dealt from the END, so
    // the offender is the last element. SWAP it with a random other position rather
    // than rotating it to the front: rotating maps every blocked deck onto ONE
    // specific allowed deck, which leaves that deck twice as likely as the others
    // (measured: consecutive decks came out identical 33% of the time instead of 25%,
    // so a 3-option list visibly looked like it was cycling). A random swap spreads
    // the blocked decks evenly, giving a uniform draw over the allowed ones.
    if (n > 1 && bag[bag.length - 1] === last) {
      const j = Math.floor(Math.random() * (n - 1));   // any slot except the last
      [bag[n - 1], bag[j]] = [bag[j], bag[n - 1]];
    }
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
  const map = all();
  const st = map && map[key];
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
  if (map && map[key]) { delete map[key]; touch(); }
}
