// Prompt Pixaroma - the tag library store.
//
// The library is { version, categories:[name...], tags:[{name, cat, text}...] },
// shared across every Prompt Pixaroma node on this machine. It is persisted as
// ONE JSON blob in an UNREGISTERED ComfyUI setting ("Pixaroma.Prompt.Library"),
// which:
//   * lives in ComfyUI's user settings, OUTSIDE our plugin folder, so it survives
//     updating / reinstalling the Pixaroma plugin (the user's #1 ask);
//   * is private to the user - it is NEVER written into a workflow, so a shared
//     workflow keeps the author's prompts to themselves;
//   * persists even though it is not declared in any extension's settings[]
//     (Vue Compat #20: comfy.settings.json is a plain JSON merge, no allow-list).
//     Same mechanism Seed history + Node Colors favorites use.
//
// tags are kept newest-first (new ones are unshifted on). categories are ordered
// and may be empty.
//
// A tag carries an OPTIONAL kind:"list" - one option per line, rolled to a single
// line by a #name token (see expand.mjs). The key is written ONLY when it is "list",
// so an existing library / an old export file needs no migration and is never
// rewritten just to add a default.
//
// EVERY CATEGORY BELONGS TO ONE SIDE: a Text category or a List category. `listCats`
// names the List ones (a subset of `categories`, which stays the full ordered list so
// an older Pixaroma reading a newer file still sees every category). A tag whose kind
// disagrees with its category's side is moved to its own bucket by normalize - the
// TAG's kind always wins, so a list can never be silently turned into plain text.
// "Text" and "List" are the two implicit buckets for a tag with no category (they
// replaced the single "Uncategorized" bucket); like it, they are reserved names and
// can never be real categories.

import { app } from "/scripts/app.js";
import { cleanMode, DEFAULT_MODE } from "./cursors.mjs";

const LIBRARY_SETTING = "Pixaroma.Prompt.Library";
export const NAME_RE = /[^a-zA-Z0-9_\-]/g;
// The two implicit buckets for a tag with no category, one per side.
export const TEXT_BUCKET = "Text";
export const LIST_BUCKET = "List";
// The single pre-2026-07-24 bucket. Still recognised on read so an existing library
// (or an old export file) folds into the new buckets; never written or shown again.
export const UNCATEGORIZED = "Uncategorized";
const RESERVED = new Set([TEXT_BUCKET, LIST_BUCKET, UNCATEGORIZED].map((s) => s.toLowerCase()));
const lc = (s) => String(s == null ? "" : s).toLowerCase();

// Seeded ONCE, the first time this browser opens a Prompt node (setting never
// written). Gives a new user a working template; every seed is editable/deletable.
const SEED = {
  version: 1,
  categories: ["Styles", "Lighting", "Camera", "Subjects"],
  listCats: ["Subjects"],   // so a new user sees what a List category is for
  tags: [
    { name: "animal", cat: "Subjects", kind: "list", text: "a red fox\na snow leopard\na barn owl\na koi carp" },
    { name: "oilpainting", cat: "Styles", text: "oil painting, thick impasto brush strokes, dramatic Rembrandt lighting, rich canvas texture, fine-art masterpiece" },
    { name: "watercolor", cat: "Styles", text: "loose watercolor wash, soft bleeding edges, paper texture, gentle pigment" },
    { name: "cyberpunk", cat: "Styles", text: "cyberpunk city, neon signs, rain-slick streets, volumetric fog, blade-runner mood" },
    { name: "goldenhour", cat: "Lighting", text: "golden hour, warm low sun, long soft shadows, cinematic rim light" },
    { name: "portrait", cat: "Camera", text: "head and shoulders portrait, shallow depth of field, 85mm lens, soft studio light" },
  ],
};

let _data = null;
let _persistTimer = null;
const _subs = new Set();

function settingsApi() {
  const s = app.ui?.settings;
  return s && typeof s.getSettingValue === "function" ? s : null;
}

function cleanName(n) {
  return String(n == null ? "" : n).trim().replace(NAME_RE, "");
}

// Coerce any parsed blob into the canonical shape, deduping tag names.
function normalize(raw) {
  const out = { version: 1, categories: [], listCats: [], tags: [] };
  const src = raw && typeof raw === "object" ? raw : {};
  const seenCat = new Set();
  const addCat = (c) => {
    const name = String(c || "").trim();
    // Reserved names are case-INSENSITIVE: a user-typed "list" must not survive as a
    // separate category that then merges with the synthetic bucket of the same name.
    if (!name || RESERVED.has(lc(name)) || seenCat.has(lc(name))) return;
    seenCat.add(lc(name));
    out.categories.push(name);
  };
  for (const c of (Array.isArray(src.categories) ? src.categories : [])) addCat(c);
  // Declared List-side categories. A name here that the categories array forgot is
  // still a real category, so add it (an export of only the list side has no
  // `categories` overlap to rely on).
  const listKeys = new Set();
  for (const c of (Array.isArray(src.listCats) ? src.listCats : [])) {
    const name = String(c || "").trim();
    if (!name || RESERVED.has(lc(name))) continue;
    listKeys.add(lc(name));
    addCat(name);
  }
  const seenTag = new Set();
  for (const t of (Array.isArray(src.tags) ? src.tags : [])) {
    if (!t) continue;
    const name = cleanName(t.name);
    if (!name || seenTag.has(lc(name))) continue;
    seenTag.add(lc(name));
    let cat = String(t.cat || "").trim();
    let kind = t.kind === "list" ? "list" : "text";
    if (RESERVED.has(lc(cat))) {
      // A bucket name is not a category. "List" also TELLS us the tag is a list (an
      // import file may name the bucket instead of setting kind); legacy
      // "Uncategorized" says nothing about the kind, so the tag's own kind stands.
      if (lc(cat) === lc(LIST_BUCKET)) kind = "list";
      else if (lc(cat) === lc(TEXT_BUCKET)) kind = "text";
      cat = "";
    }
    const rec = { name, cat, text: typeof t.text === "string" ? t.text : "" };
    // Only "list" is stored; anything else (missing, "text", junk) stays absent so a
    // plain text library round-trips byte-identical. Same for mode: the DEFAULT is
    // never written, so only a deliberate Random / In order is stored.
    if (kind === "list") rec.kind = "list";
    // Kept regardless of kind: the editor only offers it on a List, but `#texttag`
    // rolls a text tag's lines too, and gating on kind meant flipping a list to Text
    // and back silently lost the mode (the working copy kept it, the store did not).
    const mode = cleanMode(t.mode);
    if (mode !== DEFAULT_MODE) rec.mode = mode;
    out.tags.push(rec);
  }
  // Reconcile every tag's category to the canonical (case-matching) entry in the
  // list; a category a tag references but the list forgot is added - so the editor
  // sidebar (exact match) and the node's category list never disagree, and a
  // case-variant ("styles" vs "Styles") can't orphan a tag.
  const catByKey = new Map(out.categories.map((c) => [lc(c), c]));
  for (const t of out.tags) {
    if (!t.cat) continue;
    const canon = catByKey.get(lc(t.cat));
    if (canon) t.cat = canon;
    else { out.categories.push(t.cat); catByKey.set(lc(t.cat), t.cat); seenCat.add(lc(t.cat)); }
  }
  // Side repair (also the one-time migration for a library written before sides
  // existed): an UNDECLARED category holding nothing but lists is a List category.
  for (const c of out.categories) {
    if (listKeys.has(lc(c))) continue;
    const inCat = out.tags.filter((t) => lc(t.cat) === lc(c));
    if (inCat.length && inCat.every((t) => t.kind === "list")) listKeys.add(lc(c));
  }
  // A category belongs to ONE side, so a tag whose kind disagrees with it moves to
  // its own bucket. The TAG's kind wins - never silently retype someone's list.
  for (const t of out.tags) {
    if (!t.cat) continue;
    const side = listKeys.has(lc(t.cat)) ? "list" : "text";
    if (side !== (t.kind === "list" ? "list" : "text")) t.cat = "";
  }
  out.listCats = out.categories.filter((c) => listKeys.has(lc(c)));
  // How each category picks (for its *wildcard). Keyed by the CANONICAL name so a
  // rename / case-variant can't orphan it; the DEFAULT mode is dropped, not stored.
  const srcModes = src.catModes && typeof src.catModes === "object" ? src.catModes : {};
  const byKey = new Map(out.categories.map((c) => [lc(c), c]));
  byKey.set(lc(TEXT_BUCKET), TEXT_BUCKET);
  byKey.set(lc(LIST_BUCKET), LIST_BUCKET);
  out.catModes = {};
  for (const [k, v] of Object.entries(srcModes)) {
    const canon = byKey.get(lc(k));
    const m = cleanMode(v);
    if (canon && m !== DEFAULT_MODE) out.catModes[canon] = m;
  }
  return out;
}

function persist(data) {
  const s = app.ui?.settings;
  if (!s) return;
  const json = JSON.stringify(data);
  try {
    if (typeof s.setSettingValueAsync === "function") s.setSettingValueAsync(LIBRARY_SETTING, json);
    else if (typeof s.setSettingValue === "function") s.setSettingValue(LIBRARY_SETTING, json);
  } catch { /* non-fatal: still applied in-memory this session */ }
}

// The live library { categories, tags }. Same cached instance between reads; go
// through setLibrary / commitLibrary to mutate so subscribers + storage stay synced.
export function getLibrary() {
  if (_data) return _data;
  const s = settingsApi();
  if (!s) return normalize(SEED); // settings not ready yet: don't cache the seed
  const raw = s.getSettingValue(LIBRARY_SETTING);
  if (raw == null) {
    _data = normalize(SEED);
    persist(_data); // lock the seed in so it's immediately editable
    return _data;
  }
  try {
    _data = normalize(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    _data = normalize({});
  }
  return _data;
}

export function getTags() { return getLibrary().tags; }

// Ordered category names. `side` ("text" | "list") filters to one side; omit for
// both. The side's bucket is appended when a tag actually sits in it. (normalize
// guarantees every referenced category is already in the list.)
export function getCategories(side) {
  const data = getLibrary();
  const out = data.categories.filter((c) => !side || sideOfCat(c, data) === side);
  if (side !== "list" && data.tags.some((t) => !t.cat && !isListTag(t))) out.push(TEXT_BUCKET);
  if (side !== "text" && data.tags.some((t) => !t.cat && isListTag(t))) out.push(LIST_BUCKET);
  return out;
}
// The tags that show under a category name (a real one or a bucket).
export function tagsInCat(name, data) {
  const d = data || getLibrary();
  return d.tags.filter((t) => lc(catOf(t)) === lc(name));
}

// Is this tag meant to be rolled one line at a time? (Cosmetic + convenience only:
// the SYMBOL decides what actually happens at expand time, so a mismatch can never
// error - see .claude/patterns/prompt.md #25.)
export function isListTag(t) { return !!t && t.kind === "list"; }

// THE splitter for a list tag's options: one per line, trimmed, blanks dropped.
// Shared by the run pick, the preview, the highlight and the autocomplete count so
// none of them can disagree about whether a #list is live.
export function tagLines(text) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) { const s = raw.trim(); if (s) out.push(s); }
  return out;
}

// The category a tag shows under: its own, else the bucket for its side.
export function catOf(t) { return (t && t.cat) || (isListTag(t) ? LIST_BUCKET : TEXT_BUCKET); }

// Which side a category name sits on. The two buckets answer for themselves; an
// unknown name is a Text category (the default side).
export function sideOfCat(name, data) {
  if (lc(name) === lc(LIST_BUCKET)) return "list";
  if (lc(name) === lc(TEXT_BUCKET)) return "text";
  const d = data || getLibrary();
  return (d.listCats || []).some((c) => lc(c) === lc(name)) ? "list" : "text";
}
export function isListCat(name, data) { return sideOfCat(name, data) === "list"; }

// How a list / a category picks: "random" | "shuffle" | "order" (see cursors.mjs).
export function tagMode(t) { return cleanMode(t && t.mode); }
export function catMode(name, data) {
  const d = data || getLibrary();
  return cleanMode((d.catModes || {})[name] || (d.catModes || {})[String(name)]);
}

export function findTag(name) {
  const k = String(name).toLowerCase();
  for (const t of getTags()) if (t.name.toLowerCase() === k) return t;
  return null;
}

// A name not already used by another tag (case-insensitive). Appends -2, -3, ...
export function uniqueTagName(base, ignore) {
  let n = cleanName(base) || "tag";
  const taken = (x) => {
    const k = x.toLowerCase();
    for (const t of getTags()) { if (t === ignore) continue; if (t.name.toLowerCase() === k) return true; }
    return false;
  };
  if (!taken(n)) return n;
  const stem = n; let i = 2;
  while (taken(stem + "-" + i)) i++;
  return stem + "-" + i;
}

function fanout() {
  for (const fn of _subs) { try { fn(_data); } catch { /* one bad listener can't break the rest */ } }
}

// Replace the whole library and persist immediately (add / delete / import / rename).
export function setLibrary(data) {
  _data = normalize(data);
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  persist(_data);
  fanout();
  return _data;
}

// Live edit: update cache + notify subscribers now (nodes re-highlight/preview as
// you type), DEBOUNCE the settings write so we don't hammer comfy.settings.json.
export function commitLibrary(data) {
  _data = normalize(data);
  fanout();
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => { persist(_data); _persistTimer = null; }, 350);
  return _data;
}

// Flush any pending debounced write now (call on blur / editor close).
export function flushLibrary() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  if (_data) persist(_data);
}

export function subscribe(fn) { _subs.add(fn); return () => _subs.delete(fn); }

// Serialize the library for a file. `cat` omitted / null = everything; otherwise
// only that one bucket (pass TEXT_BUCKET / LIST_BUCKET for the tags with no category
// of their own). A scoped
// export still carries its category entry so the tags land back in the right place.
export function exportLibraryJSON(cat) {
  const lib = getLibrary();
  if (cat == null) return JSON.stringify(lib, null, 2);
  const tags = tagsInCat(cat, lib);
  // A bucket is not a real category, so it contributes no category entry - the tags'
  // own kind puts them back in the right bucket on import.
  const categories = lib.categories.filter((c) => lc(c) === lc(cat));
  const listCats = categories.filter((c) => isListCat(c, lib));
  const catModes = {};
  for (const c of categories) if ((lib.catModes || {})[c]) catModes[c] = lib.catModes[c];
  return JSON.stringify({ version: 1, categories, listCats, catModes, tags }, null, 2);
}

// The buckets a parsed import file contains, in file order, with counts - what the
// import preview lists so the user can bring in only the categories they want.
export function importCategories(parsed) {
  const out = [];
  const seen = new Map();
  for (const t of (parsed?.data?.tags || [])) {
    const c = catOf(t);
    const k = c.toLowerCase();
    if (!seen.has(k)) { seen.set(k, { name: c, count: 0 }); out.push(seen.get(k)); }
    seen.get(k).count += 1;
  }
  return out;
}

// Narrow a parsed import to the chosen buckets and RECOMPUTE the clashes against the
// live library, so the keep-both / replace / skip step only ever sees tags that are
// actually coming in. Same { data, conflicts } shape parseImport returns.
export function subsetImport(parsed, names) {
  const keep = new Set((names || []).map((n) => lc(n)));
  const tags = (parsed?.data?.tags || []).filter((t) => keep.has(lc(catOf(t))));
  const categories = (parsed?.data?.categories || []).filter((c) => keep.has(lc(c)));
  const listCats = (parsed?.data?.listCats || []).filter((c) => keep.has(lc(c)));
  const catModes = {};
  for (const [k, v] of Object.entries(parsed?.data?.catModes || {})) if (keep.has(lc(k))) catModes[k] = v;
  const have = new Set(getTags().map((t) => lc(t.name)));
  const conflicts = tags.filter((t) => have.has(lc(t.name))).map((t) => t.name);
  return { data: { version: 1, categories, listCats, catModes, tags }, conflicts };
}

// Parse an imported blob into a normalized library WITHOUT applying it. Returns
// { data, conflicts:[name...] } so the caller can ask the user how to merge.
export function parseImport(jsonStr) {
  let raw;
  try { raw = JSON.parse(jsonStr); } catch { return { error: "That file is not valid JSON." }; }
  // Accept the full shape, a bare tags array, or { tags:[...] } / { library:[...] }.
  if (Array.isArray(raw)) raw = { tags: raw };
  else if (raw && !Array.isArray(raw.tags)) {
    raw = { categories: raw.categories, listCats: raw.listCats, catModes: raw.catModes, tags: raw.tags || raw.library || raw.snippets || raw.prompts };
  }
  const data = normalize(raw);
  if (!data.tags.length) return { error: "No tags found in that file." };
  const have = new Set(getTags().map((t) => t.name.toLowerCase()));
  const conflicts = data.tags.filter((t) => have.has(t.name.toLowerCase())).map((t) => t.name);
  return { data, conflicts };
}

// Apply a parsed import. mode: "both" (rename incoming clashes, keep everything),
// "replace" (overwrite my text on a clash), "skip" (only add non-clashing).
// Imported tags land on TOP (newest-first), categories are merged in.
export function applyImport(parsed, mode) {
  const cur = getLibrary();
  const tags = cur.tags.map((t) => ({ ...t }));
  const byKey = new Map(tags.map((t) => [t.name.toLowerCase(), t]));
  // Unique against the WORKING set (live + already-added), not just the live
  // library - else a "keep both" rename could collide with another incoming tag
  // (e.g. importing both `portrait` and `portrait-2`) and normalize would drop one.
  const uniqueIn = (base) => {
    let n = base, i = 2;
    while (byKey.has(n.toLowerCase())) { n = base + "-" + i; i++; }
    return n;
  };
  const toAdd = [];
  for (const inc of parsed.data.tags) {
    const key = inc.name.toLowerCase();
    if (!byKey.has(key)) {
      const t = { ...inc };
      toAdd.push(t); byKey.set(key, t);
    } else if (mode === "replace") {
      byKey.get(key).text = inc.text;
    } else if (mode === "both") {
      const nn = uniqueIn(inc.name);
      const t = { ...inc, name: nn };
      toAdd.push(t); byKey.set(nn.toLowerCase(), t);
    }
    // "skip": do nothing
  }
  const next = {
    version: 1,
    categories: [...cur.categories],
    listCats: [...(cur.listCats || [])],
    catModes: { ...(cur.catModes || {}) },
    tags: toAdd.concat(tags), // newest (imported) on top
  };
  const catHave = new Set(next.categories.map((c) => lc(c)));
  for (const c of parsed.data.categories) {
    if (c && !catHave.has(lc(c))) { catHave.add(lc(c)); next.categories.push(c); }
  }
  // An incoming List category keeps its side. A name I ALREADY have keeps MY side -
  // my library wins on a clash, exactly as it does for a tag's text.
  const listHave = new Set(next.listCats.map((c) => lc(c)));
  for (const c of (parsed.data.listCats || [])) {
    if (c && !listHave.has(lc(c)) && !cur.categories.some((x) => lc(x) === lc(c))) {
      listHave.add(lc(c)); next.listCats.push(c);
    }
  }
  // Same rule for how a category picks: mine wins, theirs only fills a gap.
  for (const [k, v] of Object.entries(parsed.data.catModes || {})) {
    if (k && !cur.categories.some((x) => lc(x) === lc(k))) next.catModes[k] = v;
  }
  setLibrary(next);
  return { added: toAdd.length };
}
