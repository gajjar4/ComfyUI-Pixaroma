// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows                                            ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// A floating panel for finding and organising workflows, opened from the button
// beside the Help ? in the top toolbar.
//
// There is deliberately NO node. A node would be saved into the workflow file,
// so sharing a workflow would spread a stray node to everyone who opened it,
// and it could not help somebody staring at an empty canvas. This belongs to
// the app, exactly like Help.

import { app } from "/scripts/app.js";
import { createWorkflowWindow, el } from "./window.mjs";
import { injectWorkflowCSS } from "./css.mjs";
import {
  renderFolders, orderedFolders, siblingsOf, beginFolderRename,
} from "./folders.mjs";
import { openContextMenu, closeContextMenu } from "./menu.mjs";
import { renderGrid, beginRename } from "./grid.mjs";
import { renderDetail } from "./detail.mjs";
import { searchEntries } from "./search.mjs";
import { installOutputCoverCapture } from "./cover.mjs";
import { globalAccent, BRAND } from "../shared/index.mjs";
import { versionShort, versionLine } from "../shared/version.mjs";
import * as A from "./api.mjs";

const CMD_ID = "Pixaroma.OpenWorkflowBrowser";
const VIEW_SETTING = "Pixaroma.Workflows.View";
const SORT_SETTING = "Pixaroma.Workflows.Sort";

// No "size": a workflow is a small json either way, so the biggest file tells
// you nothing worth ordering by. Node count answers the question people
// actually meant by it.
const SORT_LABELS = { recent: "Recent", name: "Name", nodes: "Nodes" };

const S = {
  win: null,
  btn: null,
  loading: false,
  entries: [],
  rawFolders: [],
  folders: [],
  sortBtn: null,
  collections: [],
  issues: {},
  tidyRels: new Set(),
  meta: { notes: {}, covers: {}, folderColors: {} },
  favourites: new Set(),
  openPaths: [],
  byRel: new Map(),
  sel: { kind: "all" },
  selected: new Set(),
  kbdRel: null,
  query: "",
  view: "grid",
  sort: "recent",
  visible: [],
  accent: BRAND,
};

// ── data ─────────────────────────────────────────────────────────────────────

async function loadData() {
  S.loading = true;
  try {
    // Favourites are not in memory until ComfyUI is asked to read them, and
    // reading the list before that reports none - see ensureFavouritesLoaded.
    const [idx, meta] = await Promise.all([A.fetchIndex(), A.fetchMeta(), A.ensureFavouritesLoaded()]);
    S.entries = idx.entries || [];
    S.rawFolders = idx.folders || [];
    S.collections = idx.collections || [];
    S.issues = idx.issues || {};
    S.meta = meta.meta || { notes: {}, covers: {}, folderColors: {} };
    // The server lists folders alphabetically; the user's chosen order lives in
    // the sidecar and is applied here, once, rather than on every render.
    S.folders = orderedFolders(S.rawFolders, S.meta.folderOrder);

    // Which nodes are actually missing has to be worked out HERE, not on the
    // server. Python's node list holds only Python-backed nodes, so checking
    // against it flagged 108 of 143 workflows as broken - every one containing
    // a Note, a MarkdownNote, a Primitive or any of rgthree's nodes, all of
    // which are registered by the FRONTEND and are perfectly fine. The
    // browser's registry has both kinds, so it is the only honest answer to
    // "will this workflow open on this machine".
    const registry = window.LiteGraph?.registered_node_types || null;
    const missingNodes = [];
    S.byRel = new Map();
    for (const e of S.entries) {
      e._note = S.meta.notes?.[e.rel] || "";
      e._missing = registry
        ? (e.class_types || []).filter((t) => !(t in registry))
        : [];
      if (e._missing.length) missingNodes.push({ rel: e.rel, name: e.name, missing: e._missing });
      S.byRel.set(e.rel, e);
    }
    S.issues.missing_nodes = missingNodes;
    S.tidyRels = collectTidyRels(S.issues);
  } catch (err) {
    S.entries = [];
    S.win?.toast("Could not read the workflows folder: " + err.message);
  } finally {
    S.loading = false;
  }
  refreshLive();
}

/** Every workflow that needs attention, as one set of paths.
 *
 *  The badge and the view MUST come from this same set. Counting issue GROUPS
 *  instead said "18" beside a view holding 35 cards, because 16 duplicate
 *  groups are 33 files. A count that does not match what the click shows is
 *  worse than no count. */
function collectTidyRels(issues) {
  const rels = new Set();
  for (const u of issues.unsaved_names || []) rels.add(u.rel);
  for (const g of issues.duplicates || []) for (const d of g) rels.add(d.rel);
  for (const m of issues.missing_nodes || []) rels.add(m.rel);
  return rels;
}

/** The bits that change without the disk changing: which workflows are open
 *  right now, and which are starred. Re-read on every render, never cached
 *  across a workflow switch (the panel stays open across them). */
function refreshLive() {
  try {
    S.favourites = A.favourites();
    S.openPaths = A.openPaths();
  } catch {
    S.favourites = new Set();
    S.openPaths = [];
  }
}

// ── what the middle column shows ─────────────────────────────────────────────

function computeVisible() {
  let list = S.entries;
  const sel = S.sel;

  if (sel.kind === "fav") {
    list = list.filter((e) => S.favourites.has(e.rel));
  } else if (sel.kind === "recent") {
    list = [...list].sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, 20);
  } else if (sel.kind === "folder") {
    // A folder shows what is IN it, including its sub-folders: picking a parent
    // and seeing nothing because the work sits one level down is a papercut.
    list = list.filter((e) => sel.value === ""
      ? !e.folder
      : e.folder === sel.value || e.folder.startsWith(sel.value + "/"));
  } else if (sel.kind === "collection") {
    const c = S.collections.find((x) => x.id === sel.value);
    const set = new Set(c?.items || []);
    list = list.filter((e) => set.has(e.rel));
  } else if (sel.kind === "tidy") {
    list = list.filter((e) => S.tidyRels.has(e.rel));
  }

  list = searchEntries(list, S.query);

  // A search is already ranked by how well it matches; re-sorting it by date
  // would throw that away.
  if (!S.query && S.sel.kind !== "recent") {
    const by = {
      recent: (a, b) => (b.modified || 0) - (a.modified || 0),
      name: (a, b) => a.name.localeCompare(b.name),
      nodes: (a, b) => (b.node_count || 0) - (a.node_count || 0),
    }[S.sort];
    if (by) list = [...list].sort(by);
  }
  S.visible = list;
}

// ── render ───────────────────────────────────────────────────────────────────

function render() {
  if (!S.win?.isOpen()) return;
  S.accent = globalAccent() || BRAND;
  refreshLive();
  computeVisible();

  renderFolders(S.win.side, S, {
    onPick: onPickFolder,
    onDropOn: onDropOnFolder,
    onRenameFolder: startFolderRename,
    onFolderMenu: showFolderMenu,
    onReorderFolder: reorderFolderByDrop,
  });
  renderGrid(S.win.main, S, HANDLERS);
  if (S.win.isDetailVisible()) renderDetail(S.win.detail, S, HANDLERS);

  refreshSortButton();

  const total = S.entries.length;
  S.win.setCount(S.visible.length === total
    ? `${total} workflows`
    : `${S.visible.length} of ${total}`);

}

/** Search results are ranked by relevance and Recent is ordered by date, so in
 *  both the sort control genuinely does nothing and is disabled rather than
 *  left looking live. */
function sortDisabledReason() {
  if (S.query) return "Search results are ordered by how well they match, so sorting is off.";
  if (S.sel.kind === "recent") return "Recent is already ordered by when you last changed a workflow.";
  return "";
}

function refreshSortButton() {
  const b = S.sortBtn;
  if (!b) return;
  const why = sortDisabledReason();
  b.disabled = !!why;
  b.title = why || "Change the order";
}

// ── small dialogs, in the panel's own style ──────────────────────────────────

function ask({ title, message, value, okLabel = "OK", danger }) {
  return new Promise((resolve) => {
    const back = el("div");
    back.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:8;display:flex;align-items:center;justify-content:center;";
    const box = el("div");
    box.style.cssText = "background:#1d1c1b;border:1px solid #3d3936;border-radius:8px;padding:14px 16px;width:min(330px,86%);box-shadow:0 12px 30px rgba(0,0,0,.6);";
    box.append(el("div", "pixwb-detname", title));
    if (message) box.append(el("div", "pixwb-detpath", message));

    let input = null;
    if (value !== undefined) {
      input = el("input", "pixwb-note");
      input.style.minHeight = "0";
      input.value = value;
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(input.value.trim());
        if (e.key === "Escape") done(null);
      });
      box.append(input);
    }

    const acts = el("div", "pixwb-acts");
    const ok = el("button", "pixwb-tbtn " + (danger ? "pixwb-danger" : "pixwb-primary"), okLabel);
    const no = el("button", "pixwb-tbtn", "Cancel");
    ok.type = no.type = "button";
    acts.append(ok, no);
    box.append(acts);
    back.append(box);
    S.win.el.querySelector(".pixwb-body").append(back);
    setTimeout(() => (input || ok).focus(), 20);

    let settled = false;
    function done(v) {
      if (settled) return;
      settled = true;
      back.remove();
      resolve(v);
    }
    ok.addEventListener("click", () => done(input ? input.value.trim() : true));
    no.addEventListener("click", () => done(null));
    back.addEventListener("mousedown", (e) => { if (e.target === back) done(null); });
  });
}

const confirmAsk = (title, message, okLabel = "Delete") =>
  ask({ title, message, okLabel, danger: true });

// ── actions ──────────────────────────────────────────────────────────────────

const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const joinRel = (folder, file) => (folder ? `${folder}/${file}` : file);

async function guard(fn, okMessage) {
  try {
    await fn();
    if (okMessage) S.win.toast(okMessage);
    await loadData();
    render();
  } catch (err) {
    S.win.toast(err.message || String(err));
  }
}

const HANDLERS = {
  onSelect(entry, e) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      S.selected.has(entry.rel) ? S.selected.delete(entry.rel) : S.selected.add(entry.rel);
    } else {
      S.selected = new Set([entry.rel]);
    }
    S.kbdRel = entry.rel;
    render();
  },

  onOpen(entry) {
    guard(async () => {
      await A.openWorkflow(entry.rel);
      S.win.toast(`Opened ${entry.name}`);
    });
  },

  onStar(entry) {
    guard(() => A.toggleFavourite(entry.rel));
  },

  onRename(entry) {
    beginRename(S.win.main, entry.rel, entry.name, (newName) => {
      guard(async () => {
        const clean = newName.replace(/[\\/:*?"<>|]/g, "").trim();
        if (!clean) throw new Error("That name cannot be used.");
        await A.renameOrMove(entry.rel, joinRel(dirOf(entry.rel), clean + ".json"));
      }, "Renamed");
    });
  },

  onDuplicate(entry) {
    guard(async () => {
      await A.duplicate(entry.rel, joinRel(dirOf(entry.rel), entry.name + " copy.json"));
    }, "Copied");
  },

  async onDelete(entry) {
    const yes = await confirmAsk(
      `Delete "${entry.name}"?`,
      "There is no undo yet, so this really does remove the file.");
    if (!yes) return;
    guard(() => A.remove(entry.rel), "Deleted");
  },

  async onDeleteMany(rels) {
    const yes = await confirmAsk(
      `Delete ${rels.length} workflows?`,
      "There is no undo yet, so this really does remove the files.");
    if (!yes) return;
    guard(async () => {
      for (const rel of rels) await A.remove(rel);
      S.selected = new Set();
    }, `Deleted ${rels.length}`);
  },

  onReveal(entry) {
    // The folder really does open, but on Windows it lands BEHIND the browser
    // and only blinks in the taskbar - which reads as "reveal does nothing".
    // Bringing it to the front is not an option: the PowerShell needed for that
    // is flagged as malicious by antivirus (see the Save Image reveal route).
    guard(() => A.reveal(entry.rel), "Opened the folder - look in your taskbar");
  },

  onNote(rel, text) {
    A.saveMeta({ notes: { [rel]: text || null } })
      .then(() => {
        S.meta.notes = S.meta.notes || {};
        if (text) S.meta.notes[rel] = text; else delete S.meta.notes[rel];
        const e = S.byRel.get(rel);
        if (e) e._note = text || "";
      })
      .catch(() => S.win.toast("Could not save that note."));
  },

  onSetCover(entry) {
    const picker = el("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      try {
        const url = await shrinkToDataURL(file, 360);
        await A.saveMeta({ covers: { [entry.rel]: { kind: "file", url } } });
        S.meta.covers = S.meta.covers || {};
        S.meta.covers[entry.rel] = { kind: "file", url };
        render();
        S.win.toast("Cover set");
      } catch (err) {
        S.win.toast(err.message || "Could not use that picture.");
      }
    });
    picker.click();
  },

  onContext(entry, e) {
    // Right-clicking OUTSIDE the current selection acts on that card alone;
    // right-clicking INSIDE it keeps the selection, so a menu opened on one of
    // several chosen workflows still acts on all of them.
    if (!S.selected.has(entry.rel)) S.selected = new Set([entry.rel]);
    S.kbdRel = entry.rel;
    render();
    showCardMenu(entry, e.clientX, e.clientY);
  },

  onDragStart(entry, e) {
    // Dragging an unselected card drags THAT card, not the old selection.
    if (!S.selected.has(entry.rel)) S.selected = new Set([entry.rel]);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", entry.rel);
  },
};

/** Covers are stored in a small JSON sidecar, so a 12 MP png would bloat it and
 *  slow every open. Scaled down first, which is all a 132px card needs. */
function shrinkToDataURL(file, maxW) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
      c.height = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a picture.")); };
    img.src = url;
  });
}

// ── the card menu ────────────────────────────────────────────────────────────

/** Everything the detail pane offers, on the card itself - because the detail
 *  pane is hidden on a narrow window and absent in list view, and right-click
 *  is where people look for rename anyway. */
function showCardMenu(entry, x, y) {
  const many = [...S.selected];
  const multi = many.length > 1 && S.selected.has(entry.rel);
  const fav = S.favourites.has(entry.rel);

  if (multi) {
    openContextMenu(x, y, [
      { label: `${many.length} workflows selected`, disabled: true },
      null,
      { label: "Move to folder…", fn: () => promptMoveTo(many) },
      null,
      { label: `Delete ${many.length}…`, danger: true, fn: () => HANDLERS.onDeleteMany(many) },
    ]);
    return;
  }

  openContextMenu(x, y, [
    { label: "Open", fn: () => HANDLERS.onOpen(entry) },
    { label: fav ? "Remove from favourites" : "Add to favourites", fn: () => HANDLERS.onStar(entry) },
    null,
    { label: "Rename", fn: () => HANDLERS.onRename(entry) },
    { label: "Duplicate", fn: () => HANDLERS.onDuplicate(entry) },
    { label: "Move to folder…", fn: () => promptMoveTo([entry.rel]) },
    { label: "Set cover…", fn: () => HANDLERS.onSetCover(entry) },
    null,
    { label: "Reveal in explorer", fn: () => guard(() => A.reveal(entry.rel), "Opened the folder - look in your taskbar") },
    null,
    { label: "Delete…", danger: true, fn: () => HANDLERS.onDelete(entry) },
  ]);
}

/** Move without dragging. Dragging is faster once you know it exists, but it is
 *  not discoverable and it is awkward when the target folder is scrolled away. */
function promptMoveTo(rels) {
  const folders = ["", ...S.folders];
  openContextMenuFolderList(folders, (target) => moveWorkflowsTo(rels, target));
}

function openContextMenuFolderList(folders, pick) {
  const r = S.win.el.getBoundingClientRect();
  openContextMenu(r.left + 60, r.top + 90, [
    { label: "Move to which folder?", disabled: true },
    null,
    ...folders.map((f) => ({
      label: f === "" ? "(no folder)" : f,
      fn: () => pick(f),
    })),
  ]);
}

function moveWorkflowsTo(rels, folderPath) {
  guard(async () => {
    let moved = 0;
    for (const rel of rels) {
      const file = rel.slice(rel.lastIndexOf("/") + 1);
      const target = joinRel(folderPath, file);
      if (target === rel) continue;
      await A.renameOrMove(rel, target);
      moved++;
    }
    S.selected = new Set();
    if (!moved) throw new Error("Already in that folder.");
  }, `Moved to ${folderPath || "the workflows folder"}`);
}

// ── folder actions ───────────────────────────────────────────────────────────

const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function startFolderRename(path, row) {
  beginFolderRename(row, path, (newName) => {
    const clean = newName.replace(/[\\/:*?"<>|]/g, "").trim();
    if (!clean) { S.win.toast("That name cannot be used."); return; }
    const target = parentOf(path) ? `${parentOf(path)}/${clean}` : clean;
    guard(async () => {
      const res = await A.folderAction({ action: "rename", path, newPath: target });
      if (!res.ok) throw new Error(res.message || "Could not rename that folder.");
      // Carry the folder's place in the order and its colour across, or a rename
      // would quietly send it back to alphabetical and change its dot.
      const patch = {};
      const order = (S.meta.folderOrder || []).map((p) => (p === path ? target : p));
      if (order.length) patch.folderOrder = order;
      const col = S.meta.folderColors?.[path];
      if (col) patch.folderColors = { [path]: null, [target]: col };
      if (Object.keys(patch).length) await A.saveMeta(patch);
      if (S.sel.kind === "folder" && S.sel.value === path) S.sel = { kind: "folder", value: target };
    }, "Folder renamed");
  });
}

/** Write a new order for one group of siblings.
 *
 *  Every OTHER folder's recorded position is kept as it was and only this group
 *  is rewritten, so re-ordering one branch cannot shuffle an unrelated one. */
function commitSiblingOrder(sibs, reordered) {
  const others = (S.meta.folderOrder || []).filter((p) => !sibs.includes(p));
  const folderOrder = [...others, ...reordered];
  guard(async () => {
    const res = await A.saveMeta({ folderOrder });
    // The sidecar route ignores keys it does not know, and that silently
    // swallowed the order once already. If it did not come back, say so rather
    // than leaving the folder sitting where it was with no explanation.
    if (!res?.meta?.folderOrder || !res.meta.folderOrder.length) {
      throw new Error("Folder order could not be saved. Restart ComfyUI - this part needs the newer server files.");
    }
    S.meta.folderOrder = folderOrder;
  });
}

/** Move a folder one place among its OWN siblings. */
function moveFolder(path, delta) {
  const sibs = siblingsOf(path, S.folders, S.meta.folderOrder);
  const at = sibs.indexOf(path);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= sibs.length) return;
  const reordered = sibs.slice();
  reordered.splice(to, 0, reordered.splice(at, 1)[0]);
  commitSiblingOrder(sibs, reordered);
}

/** Drop one folder above or below another. Re-ordering only, never a move on
 *  disk: dragging a folder INTO another would rewrite every path underneath it,
 *  which is a different and much more destructive operation than it looks. */
function reorderFolderByDrop(moved, target, above) {
  const parent = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  if (parent(moved) !== parent(target)) {
    S.win.toast("Folders can be re-ordered within the same level, not moved into each other.");
    return;
  }
  const sibs = siblingsOf(moved, S.folders, S.meta.folderOrder);
  const from = sibs.indexOf(moved);
  if (from < 0) return;
  const without = sibs.filter((p) => p !== moved);
  const at = without.indexOf(target);
  if (at < 0) return;
  const insert = above ? at : at + 1;
  without.splice(insert, 0, moved);
  if (without.join("|") === sibs.join("|")) return;   // nothing actually moved
  commitSiblingOrder(sibs, without);
}

function showFolderMenu(path, ev) {
  const sibs = siblingsOf(path, S.folders, S.meta.folderOrder);
  const at = sibs.indexOf(path);
  const rowEl = ev.currentTarget;
  openContextMenu(ev.clientX, ev.clientY, [
    { label: "Rename", fn: () => startFolderRename(path, rowEl) },
    { label: "Move up", fn: () => moveFolder(path, -1), disabled: at <= 0 },
    { label: "Move down", fn: () => moveFolder(path, 1), disabled: at < 0 || at >= sibs.length - 1 },
    null,
    { label: "Reveal in explorer", fn: () => guard(() => A.reveal(path), "Opened the folder - look in your taskbar") },
    null,
    {
      label: "Delete folder",
      fn: () => guard(async () => {
        const res = await A.folderAction({ action: "delete", path });
        // The server refuses a folder that still holds anything - that refusal
        // IS the safety net, since there is no undo.
        if (!res.ok) throw new Error(res.message || "Could not delete that folder.");
        if (S.sel.kind === "folder" && S.sel.value === path) S.sel = { kind: "all" };
      }, "Folder deleted"),
    },
  ]);
}

function onPickFolder(pick) {
  if (pick.kind === "newfolder") {
    ask({ title: "New folder", message: "It is created inside the workflows folder.", value: "", okLabel: "Create" })
      .then((nameRaw) => {
        if (!nameRaw) return;
        const clean = nameRaw.replace(/[\\/:*?"<>|]/g, "").trim();
        if (!clean) { S.win.toast("That name cannot be used."); return; }
        guard(async () => {
          const res = await A.folderAction({ action: "create", path: clean });
          if (!res.ok) throw new Error(res.message || "Could not create that folder.");
        }, "Folder created");
      });
    return;
  }
  S.sel = pick;
  S.selected = new Set();
  S.kbdRel = null;
  render();
}

/** Cards dropped on a folder row. Same work as the menu's "Move to folder",
 *  so it goes through the same function rather than a second copy. */
function onDropOnFolder(folderPath) {
  const rels = [...S.selected];
  if (rels.length) moveWorkflowsTo(rels, folderPath);
}

// ── toolbar row inside the window ────────────────────────────────────────────

function buildBar(bar) {
  bar.textContent = "";

  const search = el("div", "pixwb-search");
  const input = el("input");
  input.type = "text";
  input.placeholder = "Search names, models, prompts, notes...";
  input.addEventListener("input", () => {
    S.query = input.value;
    S.kbdRel = null;
    render();
  });
  search.append(input);
  bar.append(search);

  const seg = el("div", "pixwb-seg");
  for (const [id, label] of [["grid", "Grid"], ["list", "List"]]) {
    const b = el("button", S.view === id ? "on" : "", label);
    b.type = "button";
    b.addEventListener("click", () => {
      S.view = id;
      try { app.ui.settings.setSettingValueAsync(VIEW_SETTING, id); } catch { /* view is cosmetic */ }
      buildBar(bar);
      render();
    });
    seg.append(b);
  }
  bar.append(seg);

  const sort = el("button", "pixwb-tbtn", "Sort: " + SORT_LABELS[S.sort]);
  sort.type = "button";
  // Two views impose their own order, so the control would do nothing. Say so
  // by disabling it, rather than letting it look live and silently ignore the
  // click - that reads as a broken button.
  const why = sortDisabledReason();
  if (why) { sort.disabled = true; sort.title = why; } else { sort.title = "Change the order"; }
  sort.addEventListener("click", () => {
    if (sort.disabled) return;
    const order = Object.keys(SORT_LABELS);
    S.sort = order[(order.indexOf(S.sort) + 1) % order.length];
    try { app.ui.settings.setSettingValueAsync(SORT_SETTING, S.sort); } catch { /* cosmetic */ }
    buildBar(bar);
    render();
  });
  bar.append(sort);
  // Kept so render() can refresh just this button. Rebuilding the whole bar on
  // every keystroke would throw away the search box's focus and caret.
  S.sortBtn = sort;

  // Opens whichever folder is selected, or the workflows folder itself.
  const openFolder = el("button", "pixwb-tbtn", "Open folder");
  openFolder.type = "button";
  openFolder.title = "Open this folder on your computer. It opens behind the browser, so look in your taskbar.";
  openFolder.addEventListener("click", () => {
    const path = S.sel.kind === "folder" ? S.sel.value : "";
    guard(() => A.reveal(path), "Opened the folder - look in your taskbar");
  });
  bar.append(openFolder);

  const saveHere = el("button", "pixwb-tbtn pixwb-primary", "Save open workflow here");
  saveHere.type = "button";
  saveHere.title = "Save whatever is on the canvas into the selected folder";
  saveHere.addEventListener("click", onSaveHere);
  bar.append(saveHere);
}

function onSaveHere() {
  const folder = S.sel.kind === "folder" ? S.sel.value : "";
  const current = A.activePath();
  const suggested = current ? current.slice(current.lastIndexOf("/") + 1).replace(/\.json$/i, "") : "My workflow";
  ask({
    title: "Save the open workflow",
    message: folder ? `Into ${folder}` : "Into the workflows folder",
    value: suggested,
    okLabel: "Save",
  }).then((nameRaw) => {
    if (!nameRaw) return;
    const clean = nameRaw.replace(/[\\/:*?"<>|]/g, "").trim();
    if (!clean) { S.win.toast("That name cannot be used."); return; }
    guard(() => A.saveCurrentAs(joinRel(folder, clean + ".json")), "Saved");
  });
}

// ── keyboard ─────────────────────────────────────────────────────────────────

/** How many cards sit on one row right now. Read off the REAL grid rather than
 *  worked out from widths: the grid is auto-fill, so the answer changes with
 *  the window, the sidebar and the detail pane, and any arithmetic here would
 *  be a second copy of the CSS that could drift from it. */
function gridColumns() {
  const grid = S.win?.main?.querySelector(".pixwb-grid");
  if (!grid) return 1;
  const cols = getComputedStyle(grid).gridTemplateColumns;
  const n = cols ? cols.trim().split(/\s+/).filter(Boolean).length : 0;
  return Math.max(1, n);
}

function onPanelKeys(e) {
  // Rename boxes and the note field stopPropagation, so they never reach here
  // and typing in them is unaffected. The search box deliberately DOES let
  // arrows through, so you can type and then walk the results without moving
  // your hands.
  const list = S.visible;
  if (!list.length) return;
  const idx = S.kbdRel ? list.findIndex((x) => x.rel === S.kbdRel) : -1;

  // In a GRID, up and down have to jump a whole ROW. Stepping one card at a
  // time made them behave exactly like left and right, which is why they read
  // as not working. In list view a row IS one item, so the step is 1.
  const ARROWS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: "up", ArrowDown: "down" };
  if (e.key in ARROWS) {
    e.preventDefault();
    const cols = S.view === "list" ? 1 : gridColumns();
    const raw = ARROWS[e.key];
    const step = raw === "up" ? -cols : raw === "down" ? cols : raw;
    let next = idx < 0 ? (step > 0 ? 0 : list.length - 1) : idx + step;
    // Clamping rather than wrapping: landing on the last card because you
    // pressed Up once too often is disorienting. Except a vertical move that
    // would fall off the end still goes to the final card, so the bottom row
    // is always reachable even when it is not full.
    if (next < 0) next = raw === "up" ? Math.max(0, idx % cols) : 0;
    if (next > list.length - 1) next = list.length - 1;
    S.kbdRel = list[next].rel;
    S.selected = new Set([S.kbdRel]);
    render();
    S.win.main.querySelector(".kbd")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const target = idx >= 0 ? list[idx] : list[0];
    if (target) HANDLERS.onOpen(target);
    return;
  }
  if (e.key === "F2") {
    e.preventDefault();
    const target = idx >= 0 ? list[idx] : null;
    if (target) HANDLERS.onRename(target);
  }
}

function buildFooter(foot) {
  foot.textContent = "";
  const hint = (keys, what) => {
    const w = el("span");
    w.append(el("b", null, keys), document.createTextNode(" " + what));
    foot.append(w);
  };
  hint("type", "search");
  hint("← → ↑ ↓", "move");
  hint("Enter", "open");
  hint("F2", "rename");
  hint("double click", "open");
  hint("drag", "onto a folder to move");
  hint("Esc", "close");

  // Right-aligned, and on the panel rather than tucked away: "which version are
  // you on" is the first thing any support answer needs, and the Help window
  // already puts it here for the same reason. Click copies the full line.
  foot.append(el("div", "pixwb-footsp"));
  const ver = el("button", "pixwb-ver", versionShort());
  ver.type = "button";
  ver.title = versionLine() + "  ·  click to copy";
  ver.addEventListener("click", async () => {
    const line = versionLine();
    let ok = false;
    try { await navigator.clipboard.writeText(line); ok = true; }
    catch { ok = false; }
    S.win.toast(ok ? "Copied: " + line : line);
  });
  foot.append(ver);
}

// ── open / close ─────────────────────────────────────────────────────────────

function ensureWindow() {
  if (S.win) return S.win;
  S.win = createWorkflowWindow({
    onRender: (opts) => {
      if (opts?.resizeOnly) return;      // a resize must not refetch the folder
      buildBar(S.win.bar);                // every time the corner is dragged
      buildFooter(S.win.foot);
      loadData().then(render);
    },
    onClose: () => {
      closeContextMenu();
      syncButton();
    },
  });
  // Panel-wide, not on the search input: the hint says the arrows move the
  // selection, so they have to work wherever the focus happens to be.
  S.win.el.addEventListener("keydown", onPanelKeys);
  return S.win;
}

function toggle() {
  const win = ensureWindow();
  win.toggle();
  syncButton();
}

function syncButton() {
  if (!S.btn) return;
  S.btn.classList.toggle("pixwb-btn-open", !!S.win?.isOpen());
}

// ── the toolbar button ───────────────────────────────────────────────────────

function mountToolbarButton() {
  if (document.querySelector(".pixwb-btn")) return;
  // The button mounts at startup but the WINDOW is not built until it is first
  // opened, so injecting the stylesheet only from the window left the button
  // unstyled: 20x36, no background, and a 0x0 icon with no mask. Inject here
  // too. It is idempotent, and css.mjs owns its own constants precisely so it
  // does not matter which caller gets there first (help-browser pattern #2).
  injectWorkflowCSS();
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    // The menu is not up yet on a cold start. Retry a few times, then give up
    // silently rather than spinning forever on a build that never has one.
    if (mountToolbarButton._tries == null) mountToolbarButton._tries = 0;
    if (++mountToolbarButton._tries > 20) {
      console.warn("[Pixaroma.Workflows] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mountToolbarButton, 250);
    return;
  }

  const group = document.createElement("div");
  group.className = "comfyui-button-group";
  const btn = document.createElement("button");
  btn.className = "comfyui-button pixwb-btn";
  btn.title = "Pixaroma Workflows: find, organise and open your workflows (Alt+W)";
  btn.append(el("span", "pixwb-btn-icon"));
  btn.addEventListener("click", toggle);
  group.append(btn);
  settingsGroupEl.before(group);
  S.btn = btn;
  syncButton();
}

app.registerExtension({
  name: "Pixaroma.WorkflowBrowser",
  commands: [{
    id: CMD_ID,
    label: "Pixaroma Workflows",
    icon: "pixwb-cmd-icon",
    function: toggle,
  }],
  keybindings: [{ combo: { key: "w", alt: true }, commandId: CMD_ID }],

  // Right-click on empty canvas. The new context-menu API, never the deprecated
  // monkey-patch (Vue Compat #20).
  getCanvasMenuItems() {
    return [{ content: "👑 Pixaroma Workflows", callback: toggle }];
  },

  async setup() {
    try {
      S.view = app.ui.settings.getSettingValue(VIEW_SETTING) || "grid";
      const savedSort = app.ui.settings.getSettingValue(SORT_SETTING);
      S.sort = SORT_LABELS[savedSort] ? savedSort : "recent";
    } catch { /* unregistered settings, absent on a first run */ }
    mountToolbarButton();
    installOutputCoverCapture();
  },
});
