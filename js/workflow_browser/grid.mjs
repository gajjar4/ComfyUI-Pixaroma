// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the cards                                ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Grid of picture cards, or a dense list once somebody has hundreds. Single
// click selects, double click opens, F2 or a second click on the name renames
// in place, and a card can be dragged onto a folder in the left column.

import { el } from "./window.mjs";
import { drawMap, coverFor } from "./cover.mjs";

const fmtWhen = (secs) => {
  if (!secs) return "";
  const d = (Date.now() - secs * 1000) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + "h ago";
  if (d < 86400 * 7) return Math.round(d / 86400) + " days ago";
  return new Date(secs * 1000).toLocaleDateString();
};

/** Cover element for one entry: a real picture when we have one, otherwise the
 *  drawn graph map. The map is a canvas, so it is painted after layout when its
 *  box has a real width. */
function coverEl(entry, state, cls) {
  const c = coverFor(entry, state.meta);
  if (c.kind === "image") {
    const img = el("img", cls);
    img.loading = "lazy";
    img.src = c.url;
    img.alt = "";
    // A cover recorded from an output that has since been deleted must not
    // leave a broken-image icon in the grid: fall back to the drawn map.
    img.addEventListener("error", () => {
      const cv = el("canvas", cls);
      img.replaceWith(cv);
      requestAnimationFrame(() => drawMap(cv, entry.map));
    }, { once: true });
    return img;
  }
  const cv = el("canvas", cls);
  requestAnimationFrame(() => drawMap(cv, entry.map));
  return cv;
}

export function renderGrid(main, state, H) {
  main.textContent = "";
  const list = state.visible;

  if (!list.length) {
    main.append(el("div", "pixwb-empty", state.query
      ? `Nothing matches "${state.query}".`
      : "Nothing in here yet."));
    return;
  }

  const wrap = el("div", state.view === "list" ? "pixwb-list" : "pixwb-grid");
  const openNow = new Set(state.openPaths);

  for (const entry of list) {
    const card = el("div", state.view === "list" ? "pixwb-row" : "pixwb-card");
    card.dataset.rel = entry.rel;
    if (state.selected.has(entry.rel)) card.classList.add("sel");
    if (state.kbdRel === entry.rel) card.classList.add("kbd");
    card.title = entry.error ? `${entry.name}\n${entry.error}` : entry.name;

    if (state.view === "list") {
      card.append(coverEl(entry, state, "pixwb-rowcov"));
      card.append(el("span", "pixwb-rowname", entry.name));
      const right = el("span", "pixwb-rowfold",
        `${entry.folder || ""}  ${fmtWhen(entry.modified)}`.trim());
      card.append(right);
    } else {
      card.append(coverEl(entry, state, "pixwb-cov"));
      const nm = el("div", "pixwb-cardname", entry.name);
      card.append(nm);
      card.append(el("div", "pixwb-cardmeta",
        entry.error ? "unreadable" : `${fmtWhen(entry.modified)} · ${entry.node_count} nodes`));
    }

    if (openNow.has(entry.rel)) {
      const mark = el("div", "pixwb-openmark");
      mark.title = "Open right now";
      card.append(mark);
    }

    const fav = state.favourites.has(entry.rel);
    const star = el("div", "pixwb-star" + (fav ? " on" : ""), fav ? "★" : "☆");
    star.title = fav ? "Remove from favourites" : "Add to favourites";
    star.addEventListener("click", (e) => { e.stopPropagation(); H.onStar(entry); });
    // Two quick clicks on the star would otherwise reach the card's dblclick
    // and open the workflow, which is not what anyone means by tapping a star.
    star.addEventListener("dblclick", (e) => e.stopPropagation());
    if (state.view !== "list") card.append(star);

    card.addEventListener("click", (e) => H.onSelect(entry, e));
    card.addEventListener("dblclick", () => H.onOpen(entry));
    card.addEventListener("contextmenu", (e) => { e.preventDefault(); H.onContext(entry, e); });

    // ── drag onto a folder ──
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      // Never hijack a click on the star or a rename box: a drag starting there
      // steals the interaction and the user cannot tell why.
      const t = e.target;
      const tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || t.classList?.contains("pixwb-star")) {
        e.preventDefault();
        return;
      }
      H.onDragStart(entry, e);
    });

    wrap.append(card);
  }
  main.append(wrap);
}

/** Turn a card's name into an input, in place. Enter commits, Escape cancels. */
export function beginRename(main, rel, currentName, commit) {
  const card = main.querySelector(`[data-rel="${CSS.escape(rel)}"]`);
  if (!card) return;
  // Already renaming. Without this, a second call in LIST view fell through to
  // the `span` fallback, matched the folder/date span (the only one left once
  // the name had been swapped for an input) and destroyed it, leaving two live
  // rename boxes on one row.
  if (card.querySelector("input")) return;
  const nameEl = card.querySelector(".pixwb-cardname") || card.querySelector(".pixwb-rowname");
  if (!nameEl) return;

  const input = el("input", "pixwb-rename");
  input.value = currentName;
  const restore = () => { input.replaceWith(nameEl); };
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    restore();
    if (save && value && value !== currentName) commit(value);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();                       // Escape here must not close the window
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
}
