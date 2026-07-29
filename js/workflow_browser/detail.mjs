// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the right-hand pane                      ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// What a workflow needs, before opening it. The missing-nodes line is the one
// that earns its place: finding out a workflow cannot run AFTER loading it,
// losing what was on the canvas, is exactly the annoyance this removes.

import { el } from "./window.mjs";
import { drawMap, coverFor } from "./cover.mjs";

export function renderDetail(pane, state, H) {
  pane.textContent = "";
  const rels = [...state.selected];

  if (!rels.length) {
    pane.append(el("div", "pixwb-empty", "Pick a workflow to see what is in it."));
    return;
  }

  if (rels.length > 1) {
    pane.append(el("div", "pixwb-detname", `${rels.length} workflows selected`));
    pane.append(el("div", "pixwb-detpath", "Drag them onto a folder to move them together."));
    const acts = el("div", "pixwb-acts");
    const del = el("button", "pixwb-tbtn pixwb-danger", "Delete all");
    del.type = "button";
    del.addEventListener("click", () => H.onDeleteMany(rels));
    acts.append(del);
    pane.append(acts);
    return;
  }

  const entry = state.byRel.get(rels[0]);
  if (!entry) return;

  const c = coverFor(entry, state.meta);
  if (c.kind === "image") {
    const img = el("img", "pixwb-detcov");
    img.src = c.url;
    img.alt = "";
    pane.append(img);
  } else {
    const cv = el("canvas", "pixwb-detcov");
    pane.append(cv);
    requestAnimationFrame(() => drawMap(cv, entry.map, state.accent));
  }

  pane.append(el("div", "pixwb-detname", entry.name));
  pane.append(el("div", "pixwb-detpath", entry.folder ? "in " + entry.folder : "not in a folder"));

  const kv = (label, value, warn) => {
    const r = el("div", "pixwb-kv" + (warn ? " pixwb-warn" : ""));
    r.append(el("span", null, label), el("b", null, value));
    pane.append(r);
  };

  if (entry.error) {
    kv("Problem", entry.error, true);
  } else {
    kv("Changed", entry.modified ? new Date(entry.modified * 1000).toLocaleString() : "-");
    kv("Nodes", String(entry.node_count));
    if (entry._missing?.length) {
      kv("Missing nodes", String(entry._missing.length), true);
      const list = el("div", "pixwb-modlist");
      for (const m of entry._missing.slice(0, 6)) list.append(el("div", "pixwb-mod", m));
      if (entry._missing.length > 6) {
        list.append(el("div", "pixwb-mod", `and ${entry._missing.length - 6} more`));
      }
      pane.append(list);
    }
  }

  const mods = [...(entry.models || []), ...(entry.loras || [])];
  if (mods.length) {
    pane.append(el("div", "pixwb-grouphead", "Needs these files"));
    const list = el("div", "pixwb-modlist");
    for (const m of mods.slice(0, 8)) list.append(el("div", "pixwb-mod", m));
    if (mods.length > 8) list.append(el("div", "pixwb-mod", `and ${mods.length - 8} more`));
    pane.append(list);
  }

  // ── the user's own note ──
  pane.append(el("div", "pixwb-grouphead", "Your note"));
  const note = el("textarea", "pixwb-note");
  note.placeholder = "What is this one for? Searchable.";
  note.value = state.meta?.notes?.[entry.rel] || "";
  note.addEventListener("keydown", (e) => e.stopPropagation());   // Escape must not close the window
  let t = null;
  note.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => H.onNote(entry.rel, note.value), 500);
  });
  pane.append(note);

  // ── actions ──
  const acts = el("div", "pixwb-acts");
  const btn = (label, fn, cls, title) => {
    const b = el("button", "pixwb-tbtn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (title) b.title = title;
    b.addEventListener("click", fn);
    acts.append(b);
    return b;
  };
  btn("Open", () => H.onOpen(entry), "pixwb-primary");
  btn("Rename", () => H.onRename(entry));
  btn("Duplicate", () => H.onDuplicate(entry));
  btn("Set cover", () => H.onSetCover(entry), null, "Choose a picture for this card");
  btn("Reveal", () => H.onReveal(entry), null, "Open the folder it is in");
  btn("Delete", () => H.onDelete(entry), "pixwb-danger", "There is no undo yet, so this asks first");
  pane.append(acts);
}
