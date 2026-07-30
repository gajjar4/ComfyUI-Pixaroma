// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the right-hand pane                      ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// What a workflow needs, before opening it. The missing-nodes line is the one
// that earns its place: finding out a workflow cannot run AFTER loading it,
// losing what was on the canvas, is exactly the annoyance this removes.

import { el } from "./window.mjs";
import { drawMap, coverFor, hasHandCover } from "./cover.mjs";

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
    requestAnimationFrame(() => drawMap(cv, entry.map));
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
  // A full-size favourite control, so the little star on the card is never the
  // only way to do it - and it works in list view, where cards have no star.
  const fav = state.favourites.has(entry.rel);
  const favBtn = btn("Favourite", () => H.onStar(entry), null,
                     fav ? "Remove from favourites" : "Add to favourites");
  // Filled and orange when it IS a favourite, hollow and white when it is not,
  // matching the star on the card so the two read as the same control.
  const glyph = el("span", "pixwb-btnstar" + (fav ? " on" : ""), fav ? "★" : "☆");
  favBtn.prepend(glyph);
  btn("Rename", () => H.onRename(entry));
  btn("Duplicate", () => H.onDuplicate(entry));
  const hasCover = hasHandCover(entry, state.meta);
  btn(hasCover ? "Replace cover" : "Set cover", () => H.onSetCover(entry), null,
      "Choose a picture for this card");
  if (hasCover) {
    btn("Remove cover", () => H.onClearCover(entry), null,
        "Go back to the drawn map, or this workflow's own last output");
  }
  btn("Reveal", () => H.onReveal(entry), null, "Open the folder it is in");
  btn("Delete", () => H.onDelete(entry), "pixwb-danger", "There is no undo yet, so this asks first");
  pane.append(acts);

  // ── what it needs, LAST ──
  //
  // Deliberately below the note and the buttons. A video workflow can need a
  // dozen files, and with this list higher up the buttons were pushed off the
  // bottom of the pane. The list is complete now rather than cut off at eight
  // with "and 2 more" - the pane scrolls, and a partial list of requirements is
  // no use to anyone.
  const mods = [...(entry.models || []), ...(entry.loras || [])];
  if (mods.length) {
    const head = el("div", "pixwb-headrow");
    head.append(el("div", "pixwb-grouphead", `Needs these files (${mods.length})`));
    const copy = el("button", "pixwb-copybtn", "Copy");
    copy.type = "button";
    copy.title = "Copy every filename, one per line";
    copy.addEventListener("click", () => copyList(mods, entry.name, copy));
    head.append(copy);
    pane.append(head);

    const list = el("div", "pixwb-modlist");
    for (const m of mods) list.append(modChip(m));
    pane.append(list);
  }
}

/** Copy the filenames out, so they can be pasted into a download list or a
 *  message asking someone which model they used. */
async function copyList(mods, workflowName, btn) {
  const text = `${workflowName}\n` + mods.map((m) => m).join("\n");
  const flash = (label) => {
    const original = btn.textContent;
    btn.textContent = label;
    btn.classList.add("done");
    setTimeout(() => { btn.textContent = original; btn.classList.remove("done"); }, 1200);
  };
  try {
    await navigator.clipboard.writeText(text);
    flash("Copied");
  } catch {
    // navigator.clipboard needs a secure context, and ComfyUI is often reached
    // over plain http on a LAN address, where it simply is not there.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    flash(ok ? "Copied" : "Could not copy");
  }
}

/** A filename split so it can be read at a glance: the folder dimmed, the name
 *  plain, the extension in the accent. An accent BORDER round the whole chip
 *  was tried and made the text harder to read, not easier. */
function modChip(name) {
  const d = el("div", "pixwb-mod");
  const cut = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const dir = cut >= 0 ? name.slice(0, cut) : "";
  const sep = cut >= 0 ? name[cut] : "";
  const file = cut >= 0 ? name.slice(cut + 1) : name;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  if (dir) d.append(el("span", "pixwb-moddir", dir));
  if (sep) d.append(el("span", "pixwb-modsep", sep));
  d.append(el("span", "pixwb-modname", base));
  if (ext) d.append(el("span", "pixwb-modext", ext));
  d.title = name;
  return d;
}
