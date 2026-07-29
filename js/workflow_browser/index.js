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
import { renderFolders } from "./folders.mjs";
import { renderGrid, beginRename, showHover, hideHover } from "./grid.mjs";
import { renderDetail } from "./detail.mjs";
import { searchEntries } from "./search.mjs";
import { installOutputCoverCapture } from "./cover.mjs";
import { globalAccent, BRAND } from "../shared/index.mjs";
import * as A from "./api.mjs";

const CMD_ID = "Pixaroma.OpenWorkflowBrowser";
const VIEW_SETTING = "Pixaroma.Workflows.View";
const SORT_SETTING = "Pixaroma.Workflows.Sort";

const S = {
  win: null,
  btn: null,
  loading: false,
  entries: [],
  folders: [],
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
    const [idx, meta] = await Promise.all([A.fetchIndex(), A.fetchMeta()]);
    S.entries = idx.entries || [];
    S.folders = idx.folders || [];
    S.collections = idx.collections || [];
    S.issues = idx.issues || {};
    S.meta = meta.meta || { notes: {}, covers: {}, folderColors: {} };

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
      size: (a, b) => (b.size || 0) - (a.size || 0),
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

  renderFolders(S.win.side, S, { onPick: onPickFolder, onDropOn: onDropOnFolder });
  renderGrid(S.win.main, S, HANDLERS);
  if (S.win.isDetailVisible()) renderDetail(S.win.detail, S, HANDLERS);

  const total = S.entries.length;
  S.win.setCount(S.visible.length === total
    ? `${total} workflows`
    : `${S.visible.length} of ${total}`);

  wireHover();
}

function wireHover() {
  const main = S.win.main;
  main.querySelectorAll("[data-rel]").forEach((card) => {
    card.addEventListener("mouseenter", () => {
      const e = S.byRel.get(card.dataset.rel);
      if (e) showHover(e, S, card.getBoundingClientRect());
    });
    card.addEventListener("mouseleave", hideHover);
  });
  main.addEventListener("scroll", hideHover, { passive: true });
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
    hideHover();
    guard(async () => {
      await A.openWorkflow(entry.rel);
      S.win.toast(`Opened ${entry.name}`);
    });
  },

  onStar(entry) {
    guard(async () => {
      const ok = await A.toggleFavourite(entry.rel);
      if (!ok) throw new Error("This ComfyUI build does not expose favourites.");
    });
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
    guard(() => A.reveal(entry.rel));
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
    void e;
    S.selected = new Set([entry.rel]);
    S.kbdRel = entry.rel;
    render();
  },

  onDragStart(entry, e) {
    // Dragging an unselected card drags THAT card, not the old selection.
    if (!S.selected.has(entry.rel)) S.selected = new Set([entry.rel]);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", entry.rel);
    hideHover();
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

function onDropOnFolder(folderPath) {
  const rels = [...S.selected];
  if (!rels.length) return;
  guard(async () => {
    for (const rel of rels) {
      const file = rel.slice(rel.lastIndexOf("/") + 1);
      const target = joinRel(folderPath, file);
      if (target === rel) continue;
      await A.renameOrMove(rel, target);
    }
    S.selected = new Set();
  }, `Moved ${rels.length} to ${folderPath || "the workflows folder"}`);
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
  input.addEventListener("keydown", onSearchKeys);
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

  const sort = el("button", "pixwb-tbtn", "Sort: " + { recent: "Recent", name: "Name", nodes: "Nodes", size: "Size" }[S.sort]);
  sort.type = "button";
  sort.title = "Change the order";
  sort.addEventListener("click", () => {
    const order = ["recent", "name", "nodes", "size"];
    S.sort = order[(order.indexOf(S.sort) + 1) % order.length];
    try { app.ui.settings.setSettingValueAsync(SORT_SETTING, S.sort); } catch { /* cosmetic */ }
    buildBar(bar);
    render();
  });
  bar.append(sort);

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

function onSearchKeys(e) {
  const list = S.visible;
  if (!list.length) return;
  const idx = S.kbdRel ? list.findIndex((x) => x.rel === S.kbdRel) : -1;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = idx < 0 ? 0 : Math.max(0, Math.min(list.length - 1, idx + step));
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
  hint("↑ ↓", "move");
  hint("Enter", "open");
  hint("F2", "rename");
  hint("double click", "open");
  hint("drag", "onto a folder to move");
  hint("Esc", "close");
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
      hideHover();
      syncButton();
    },
  });
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
      S.sort = app.ui.settings.getSettingValue(SORT_SETTING) || "recent";
    } catch { /* unregistered settings, absent on a first run */ }
    mountToolbarButton();
    installOutputCoverCapture();
  },
});
