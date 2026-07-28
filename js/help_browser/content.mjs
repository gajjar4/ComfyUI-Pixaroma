// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the index and the pages              ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Builds the list of everything the browser can show, and renders the two
// screens: the home grid and an article.
//
// The node list is read from the SAME registry the selection-toolbar Help
// button uses (`allNodeHelp()` in js/shared/help.mjs). That is what makes a new
// node appear here automatically the moment its help entry is written: there is
// no second list to keep in sync, and nothing to forget.
//
// The index is rebuilt on every open rather than cached, because nodes can be
// registered late and the open graph changes underneath us (the window stays
// open across workflow switches - see window.mjs).

import { app } from "/scripts/app.js";
import { allNodeHelp } from "../shared/index.mjs";
import { el } from "./window.mjs";
import { GUIDES } from "./guides.mjs";
import { CANVAS_FEATURES } from "./canvas_defs.mjs";
import { buildSchematic, nodeDefFor } from "./schematic.mjs";
import { KEYWORDS } from "./keywords.mjs";

// Category order and icons mirror the "👑 Pixaroma/..." menu, so the browser
// and the Add Node menu teach the same map.
const CAT_ORDER = [
  ["🎨 Editors", "🎨"], ["🖼️ Image", "🖼️"], ["✂️ Resize & Crop", "✂️"],
  ["💬 Prompt & Text", "💬"], ["📝 Notes & Overlay", "📝"], ["🔢 Values", "🔢"],
  ["🔀 Logic & Flow", "🔀"], ["🧰 Utility", "🧰"],
];

// Frontend-only (virtual) nodes have no Python def, so no category comes with
// them. Without this they would vanish from the browser despite having help
// written. Add a line here for any future virtual node.
const VIRTUAL_CATEGORY = {
  PixaromaSetNode: "👑 Pixaroma/🔀 Logic & Flow",
  PixaromaGetNode: "👑 Pixaroma/🔀 Logic & Flow",
};

// Developer-only nodes. They have help written (for us), but they are not for
// production workflows, so they do not belong in a browser aimed at users.
// Listed explicitly so the exclusion is a decision, not an accident of whether
// they happen to be registered in a given build.
const HIDDEN = new Set([
  "PixaromaReferenceNode",
  "Pixaroma_VueReferenceNode",
  "PixaromaLoopEngine",
]);

const escHtml = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Inline `code` -> a monospace chip, matching the per-node help popup.
const fmt = (s) => escHtml(s).replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);

// A category label with its emoji stripped, for the sidebar text.
function catParts(raw) {
  const leaf = String(raw || "").split("/").pop().trim();
  const hit = CAT_ORDER.find(([name]) => name === leaf);
  if (hit) return { name: leaf.replace(/^\S+\s/, ""), icon: hit[1], sort: CAT_ORDER.indexOf(hit) };
  return { name: leaf || "Other", icon: "📦", sort: 90 };
}

// ── the index ────────────────────────────────────────────────
// Every page the browser can show, as a flat list of entries.
export function buildIndex() {
  const out = [];

  for (const g of GUIDES) {
    out.push({ key: g.key, kind: "guide", title: g.title, tagline: g.tagline,
               icon: g.icon, cat: "Start here", catIcon: "🚀", sort: -1, help: g });
  }

  for (const [cls, help] of allNodeHelp()) {
    if (HIDDEN.has(cls)) continue;
    const def = nodeDefFor(cls);
    // A VIRTUAL node (Set and Get) is registered by the frontend alone, so it
    // has no Python def and therefore no category. Dropping those would hide
    // two nodes that DO have help written, so they get a category from the map
    // instead. Anything else with no def and no map entry is an old help entry
    // whose node is gone, and is skipped rather than shown as a dead page.
    if (!def && !VIRTUAL_CATEGORY[cls]) continue;
    const c = def ? catParts(def.category) : catParts(VIRTUAL_CATEGORY[cls]);
    out.push({
      key: "node:" + cls, kind: "node", cls,
      title: help.title || def?.display_name || cls,
      tagline: help.tagline || "",
      icon: c.icon, cat: c.name, catIcon: c.icon, sort: c.sort,
      // Merge the search-only aliases with any the help def carries itself, so
      // a node that keeps its keywords next to its own code still works.
      help, aliases: [KEYWORDS[cls], help.keywords].filter(Boolean).join(" "),
    });
  }

  for (const f of CANVAS_FEATURES) {
    out.push({ key: f.key, kind: "canvas", title: f.title, tagline: f.tagline,
               icon: "✨", cat: "Canvas tools", catIcon: "✨", sort: 95, help: f });
  }

  return out;
}

export function groupByCategory(index) {
  const map = new Map();
  for (const e of index) {
    if (!map.has(e.cat)) map.set(e.cat, { name: e.cat, icon: e.catIcon, sort: e.sort, items: [] });
    map.get(e.cat).items.push(e);
  }
  const groups = [...map.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  groups.forEach((g) => g.items.sort((a, b) => a.title.localeCompare(b.title)));
  return groups;
}

// ── sidebar ──────────────────────────────────────────────────
export function renderNav(side, index, current, onNav) {
  side.innerHTML = "";
  const home = el("button", "pixhb-item" + (current === "home" ? " pixhb-on" : ""), "🏠  Home");
  home.type = "button";
  home.style.marginBottom = "3px";
  home.addEventListener("click", () => onNav("home"));
  side.appendChild(home);

  for (const g of groupByCategory(index)) {
    const open = current !== "home" && current?.cat === g.name;
    const box = el("div", "pixhb-group" + (open ? " pixhb-open" : ""));
    const btn = el("button", "pixhb-gbtn");
    btn.type = "button";
    btn.innerHTML = `<span class="pixhb-arw">▶</span><span>${escHtml(g.icon)} ${escHtml(g.name)}</span>`;
    btn.appendChild(el("span", "pixhb-cnt", String(g.items.length)));
    btn.addEventListener("click", () => box.classList.toggle("pixhb-open"));
    box.appendChild(btn);

    const list = el("div", "pixhb-items");
    for (const e of g.items) {
      const i = el("button", "pixhb-item" + (current === e ? " pixhb-on" : ""), e.title);
      i.type = "button";
      i.title = e.tagline || e.title;
      i.addEventListener("click", () => onNav(e));
      list.appendChild(i);
    }
    box.appendChild(list);
    side.appendChild(box);
  }
}

// ── a card ───────────────────────────────────────────────────
export function buildCard(entry, onNav, ctx) {
  const b = el("button", "pixhb-card");
  b.type = "button";
  const top = el("div", "pixhb-card-top");
  top.append(el("span", "pixhb-card-ic", entry.icon), el("div", "pixhb-card-n", entry.title));
  b.appendChild(top);
  if (entry.tagline) b.appendChild(el("div", "pixhb-card-d", entry.tagline));

  const cat = el("div", "pixhb-card-cat");
  cat.appendChild(el("span", null, entry.cat));
  if (entry.kind === "node" && ctx?.onCanvas?.has(entry.cls)) {
    cat.appendChild(el("span", "pixhb-badge", "on canvas"));
  }
  b.appendChild(cat);

  if (ctx?.pins) {
    const pinned = ctx.pins.has(entry.key);
    const star = el("button", "pixhb-star" + (pinned ? " pixhb-on" : ""), pinned ? "★" : "☆");
    star.type = "button";
    star.title = pinned ? "Unpin" : "Pin to the top";
    star.addEventListener("click", (e) => { e.stopPropagation(); ctx.togglePin(entry.key); });
    b.appendChild(star);
  }

  b.addEventListener("click", () => { if (!b._pixSkipClick) onNav(entry); });
  ctx?.makeDraggable?.(b, entry);
  return b;
}

// ── article ──────────────────────────────────────────────────
function buildSection(section) {
  const sec = el("div", "pixhb-sect");
  if (section.heading) sec.appendChild(el("p", "pixhb-h", section.heading));

  if (section.body) {
    for (const para of String(section.body).split(/\n\s*\n/)) {
      const p = el("p");
      p.innerHTML = fmt(para);
      sec.appendChild(p);
    }
  }
  if (Array.isArray(section.bullets) && section.bullets.length) {
    const ul = el("ul");
    for (const item of section.bullets) {
      const li = el("li");
      li.innerHTML = fmt(item);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
  }
  if (Array.isArray(section.defs) && section.defs.length) {
    const dl = el("dl", "pixhb-defs");
    for (const entry of section.defs) {
      const [term, desc] = Array.isArray(entry) ? entry : [entry, ""];
      const dt = el("dt"), dd = el("dd");
      dt.innerHTML = fmt(term);
      dd.innerHTML = fmt(desc);
      dl.append(dt, dd);
    }
    sec.appendChild(dl);
  }
  if (section.table && Array.isArray(section.table.rows)) {
    const table = el("table", "pixhb-table");
    if (Array.isArray(section.table.headers)) {
      const tr = el("tr");
      for (const h of section.table.headers) {
        const th = el("th");
        th.innerHTML = fmt(h);
        tr.appendChild(th);
      }
      const thead = el("thead");
      thead.appendChild(tr);
      table.appendChild(thead);
    }
    const tbody = el("tbody");
    for (const row of section.table.rows) {
      const tr = el("tr");
      for (const cell of (Array.isArray(row) ? row : [row])) {
        const td = el("td");
        td.innerHTML = fmt(cell);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    sec.appendChild(table);
  }
  return sec;
}

export function renderArticle(main, entry, onNav, ctx) {
  const help = entry.help || {};
  main.innerHTML = "";
  const pad = el("div", "pixhb-pad");

  const crumb = el("div", "pixhb-crumb");
  crumb.innerHTML = `${escHtml(entry.catIcon)} ${escHtml(entry.cat)} &nbsp;/&nbsp; <b>${escHtml(entry.title)}</b>`;
  pad.appendChild(crumb);

  const h = el("h2", "pixhb-arth");
  h.appendChild(el("span", null, help.title || entry.title));
  pad.appendChild(h);
  if (help.tagline) pad.appendChild(el("p", "pixhb-arttag", help.tagline));

  if (ctx?.buildActions) pad.appendChild(ctx.buildActions(entry));

  // A real picture, only for the handful of nodes whose FACE is the subject.
  // Absent file -> no picture and no error; the diagram below still explains
  // the wiring. Same drop-in habit as the custom fonts and note icons.
  if (entry.kind === "node") {
    // Hidden until it actually loads, so a node with no picture leaves NO gap.
    // Three details that all matter: the listeners go on BEFORE `src` (a cached
    // failure can fire before a later-attached handler), there is no
    // loading="lazy" (a lazy image that is never scrolled into view never
    // loads, so `error` never fires and the empty box just sits there), and the
    // element starts display:none rather than being removed on error, so the
    // page never reflows under the reader.
    const img = el("img", "pixhb-pic");
    img.alt = entry.title;
    img.style.display = "none";
    img.addEventListener("load", () => { img.style.display = ""; });
    img.addEventListener("error", () => img.remove());
    img.src = `/pixaroma/assets/help/${encodeURIComponent(entry.cls)}.webp`;
    pad.appendChild(img);

    const dia = buildSchematic(entry.cls, help.title || entry.title);
    if (dia) pad.appendChild(dia);
  }

  const sections = Array.isArray(help.sections) ? help.sections : [];
  for (const section of sections) {
    try { pad.appendChild(buildSection(section)); }
    catch (e) { console.warn("[Pixaroma.Help] skipped a malformed section", e); }
  }

  if (help.footer) {
    const tip = el("div", "pixhb-tip");
    tip.innerHTML = fmt(help.footer);
    pad.appendChild(tip);
  }

  // Related pages, when the help def names any.
  const rel = Array.isArray(help.related) ? help.related : [];
  if (rel.length && ctx?.index) {
    const targets = rel.map((k) => ctx.index.find((x) => x.cls === k || x.key === k || x.title === k)).filter(Boolean);
    if (targets.length) {
      const sec = el("div", "pixhb-sect");
      sec.appendChild(el("p", "pixhb-h", "Works well with"));
      const row = el("div", "pixhb-rel");
      for (const t of targets) {
        const chip = el("button", "pixhb-relchip", t.title);
        chip.type = "button";
        chip.addEventListener("click", () => onNav(t));
        row.appendChild(chip);
      }
      sec.appendChild(row);
      pad.appendChild(sec);
    }
  }

  main.appendChild(pad);
  main.scrollTop = 0;
}

// Pixaroma nodes currently on the canvas. Re-read every render, never cached:
// the window stays open across workflow switches.
export function pixaromaOnCanvas() {
  const set = new Set();
  try {
    const nodes = app.graph?._nodes || app.graph?.nodes || [];
    for (const n of nodes) if (n?.comfyClass) set.add(n.comfyClass);
  } catch { /* an unreadable graph just means an empty strip */ }
  return set;
}
