// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the left column                          ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Three stacked groups:
//   the shortcuts (everything / favourites / recent / needs tidying),
//   the REAL folders on disk, nested,
//   and the collections the index worked out for itself.
//
// The collections deliberately sit BELOW the folders and never replace them:
// the folders are the user's own filing and must stay the primary thing. The
// collections are there so filing is no longer the only way to find something.
//
// Only real folders accept a drop. A collection is derived from what is inside
// a file, so dropping onto one would promise a move that cannot happen.

import { el } from "./window.mjs";

const FOLDER_COLORS = ["#4d7ea8", "#7ea84d", "#a8794d", "#8a4da8", "#a84d4d", "#4da8a0", "#8f8f8f", "#6d78a8"];

/**
 * Folder order.
 *
 * On disk there is no such thing as folder order - the server lists them
 * alphabetically. A chosen order lives in the sidecar as a list of paths, and
 * anything not in it falls back to alphabetical, so a newly created folder
 * still appears somewhere sensible instead of vanishing to the end of nowhere.
 *
 * Sorting happens per PARENT, and the result is walked as a tree, so a child
 * always follows its own parent no matter where either was dragged to. Sorting
 * the flat list instead would let a re-ordered parent end up below somebody
 * else's children.
 */
export function orderedFolders(folders, order) {
  const rank = new Map((order || []).map((p, i) => [p, i]));
  const kids = new Map();               // parent path -> child paths
  for (const f of folders) {
    const parent = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(f);
  }
  const byRank = (a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity;
    const rb = rank.has(b) ? rank.get(b) : Infinity;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  };
  const out = [];
  const walk = (parent) => {
    const list = (kids.get(parent) || []).slice().sort(byRank);
    for (const f of list) { out.push(f); walk(f); }
  };
  walk("");
  // A folder whose parent is missing from the list would never be walked to;
  // append it rather than dropping it off the panel entirely.
  for (const f of folders) if (!out.includes(f)) out.push(f);
  return out;
}

/** The siblings of a folder, in the order they are displayed. */
export function siblingsOf(path, folders, order) {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return orderedFolders(folders, order).filter((f) => {
    const p = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
    return p === parent;
  });
}

/** A stable colour per folder, so it looks deliberate without anyone choosing
 *  one and does not shuffle as folders are added. Overridable in the sidecar. */
export function folderColor(path, meta) {
  const chosen = meta?.folderColors?.[path];
  if (chosen) return chosen;
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
  return FOLDER_COLORS[h % FOLDER_COLORS.length];
}

/**
 * Rebuild the column.
 *
 * onPick(sel)          - {kind, value} for the row that was clicked
 * onDropOn(folderPath) - cards were dropped on a real folder row
 */
export function renderFolders(side, state, { onPick, onDropOn, onRenameFolder, onFolderMenu }) {
  side.textContent = "";
  const { entries, folders, collections, meta, favourites, sel, tidyRels } = state;

  const is = (kind, value) => sel.kind === kind && (value === undefined || sel.value === value);

  /** Build a row, attach its click, and - for a real folder - its drop target. */
  function addRow({ label, count, on, dot, indent = 0, title, muted }, pick, folderPath) {
    const b = el("button", "pixwb-fold" + (on ? " on" : ""));
    b.type = "button";
    if (title) b.title = title;
    if (muted) b.style.color = "#6e6764";
    if (indent) {
      const sp = el("span", "pixwb-nest");
      sp.style.width = indent * 11 + "px";
      b.append(sp);
    }
    if (dot) {
      const d = el("span", "pixwb-dot");
      d.style.background = dot;
      b.append(d);
    }
    b.append(el("span", null, label));
    if (count != null) b.append(el("span", "pixwb-cnt", String(count)));
    b.addEventListener("click", () => onPick(pick));

    if (folderPath !== undefined) {
      b.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        b.classList.add("pixwb-droptarget");
      });
      b.addEventListener("dragleave", () => b.classList.remove("pixwb-droptarget"));
      b.addEventListener("drop", (e) => {
        e.preventDefault();
        b.classList.remove("pixwb-droptarget");
        onDropOn?.(folderPath);
      });
    }

    side.append(b);
    return b;
  }

  // ── shortcuts ──
  addRow({ label: "All workflows", count: entries.length, on: is("all") }, { kind: "all" });
  addRow({ label: "★ Favourites", count: favourites.size, on: is("fav") }, { kind: "fav" });
  addRow({ label: "Recent", count: Math.min(20, entries.length), on: is("recent") }, { kind: "recent" });

  // The count is the number of WORKFLOWS the click will show, not the number of
  // issue groups - see collectTidyRels in index.js for why that distinction bit.
  const issueCount = tidyRels?.size || 0;
  if (issueCount) {
    addRow({
      label: "Needs tidying", count: issueCount, on: is("tidy"),
      title: "Leftover names, duplicates, and workflows needing things you do not have",
    }, { kind: "tidy" });
  }

  // ── real folders ──
  side.append(el("div", "pixwb-grouphead", "Folders"));

  // A workflow inside a sub-folder counts for its parents too, or a folder that
  // only holds sub-folders would read as empty.
  const perFolder = new Map();
  for (const e of entries) {
    if (!e.folder) continue;
    const parts = e.folder.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join("/");
      perFolder.set(key, (perFolder.get(key) || 0) + 1);
    }
  }

  addRow({
    label: "(loose files)", count: entries.filter((e) => !e.folder).length,
    on: is("folder", ""), dot: "#5a5450",
    title: "Workflows sitting outside any folder",
  }, { kind: "folder", value: "" }, "");

  for (const f of folders) {
    const row = addRow({
      label: f.split("/").pop(),
      count: perFolder.get(f) || 0,
      on: is("folder", f),
      dot: folderColor(f, meta),
      indent: f.split("/").length - 1,
      title: f + "\nDouble click to rename, right click for more",
    }, { kind: "folder", value: f }, f);

    // Same gesture as a card: double click the name to rename it in place.
    row.addEventListener("dblclick", (e) => {
      e.preventDefault();
      onRenameFolder?.(f, row);
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onFolderMenu?.(f, e);
    });
  }

  addRow({ label: "+ New folder", muted: true }, { kind: "newfolder" });

  // ── collections ──
  const kinds = (collections || []).filter((c) => c.group === "kind");
  const models = (collections || []).filter((c) => c.group === "model");

  if (kinds.length) {
    side.append(el("div", "pixwb-grouphead", "What it makes"));
    for (const c of kinds) {
      addRow({ label: c.label, count: c.count, on: is("collection", c.id) },
             { kind: "collection", value: c.id });
    }
  }
  if (models.length) {
    side.append(el("div", "pixwb-grouphead", "Model"));
    for (const c of models) {
      addRow({ label: c.label, count: c.count, on: is("collection", c.id) },
             { kind: "collection", value: c.id });
    }
  }
}

/** Swap a folder row for a text box. Enter commits the new NAME (not path). */
export function beginFolderRename(row, path, commit) {
  if (!row || row.querySelector("input")) return;
  const current = path.split("/").pop();
  const kept = [...row.childNodes];
  const input = el("input", "pixwb-foldrename");
  input.value = current;
  row.textContent = "";
  row.append(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    row.textContent = "";
    kept.forEach((n) => row.append(n));
    if (save && value && value !== current) commit(value);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();                  // Escape here must not close the panel
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
}

// ── right-click menu ────────────────────────────────────────────────────────

let menuEl = null;

export function closeFolderMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

/** items: [{label, fn, disabled}] or null for a separator. */
export function openFolderMenu(x, y, items) {
  closeFolderMenu();
  menuEl = el("div", "pixwb-menu");
  for (const it of items) {
    if (!it) { menuEl.append(el("div", "pixwb-menusep")); continue; }
    const b = el("button", null, it.label);
    b.type = "button";
    if (it.disabled) b.disabled = true;
    else b.addEventListener("click", () => { closeFolderMenu(); it.fn(); });
    menuEl.append(b);
  }
  document.body.append(menuEl);

  // Keep it on screen; a menu opened near the bottom edge must not run off it.
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.round(Math.min(x, window.innerWidth - r.width - 8)) + "px";
  menuEl.style.top = Math.round(Math.min(y, window.innerHeight - r.height - 8)) + "px";

  // Capture phase: a click that re-renders the panel detaches its own target,
  // so a bubble-phase "was this inside" test would already be false.
  const away = (e) => {
    if (menuEl && !menuEl.contains(e.target)) { closeFolderMenu(); cleanup(); }
  };
  const esc = (e) => { if (e.key === "Escape") { closeFolderMenu(); cleanup(); } };
  const cleanup = () => {
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", esc, true);
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
  }, 0);
}
