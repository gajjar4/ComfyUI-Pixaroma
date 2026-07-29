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
export function renderFolders(side, state, { onPick, onDropOn }) {
  side.textContent = "";
  const { entries, folders, collections, issues, meta, favourites, sel } = state;

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

  const issueCount = (issues?.unsaved_names?.length || 0)
    + (issues?.duplicates?.length || 0)
    + (issues?.missing_nodes?.length || 0);
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
    addRow({
      label: f.split("/").pop(),
      count: perFolder.get(f) || 0,
      on: is("folder", f),
      dot: folderColor(f, meta),
      indent: f.split("/").length - 1,
      title: f,
    }, { kind: "folder", value: f }, f);
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
