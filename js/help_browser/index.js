// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help - the orange ? in the top toolbar              ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// One button beside Align that opens a floating help window covering every
// Pixaroma node, every canvas feature, and four short guides.
//
// There is deliberately NO "Help Pixaroma" node. A node would be saved into the
// workflow file, so sharing a workflow would spread a stray Help node to
// everyone who opened it, and it could not help someone staring at an empty
// canvas. Help belongs to the app, not to a graph.
//
// Three ways in, none of which touch the graph:
//   - the toolbar button (primary)
//   - "Open the full help" at the bottom of a node's own ? popup
//   - a right-click on empty canvas
//
// The toolbar mount is the same one Align uses (js/align/index.js):
// app.menu.settingsGroup.element.before(group), with the same retry loop for
// when the menu is not up yet, and the same silent give-up.

import { app } from "/scripts/app.js";
import { nodeSetting, setNodeSetting } from "../shared/index.mjs";
import { createHelpWindow, el } from "./window.mjs";
import { injectHelpBrowserCSS } from "./css.mjs";
import {
  buildIndex, groupByCategory, renderNav, renderArticle, buildCard, pixaromaOnCanvas,
} from "./content.mjs";
import { buildSearchIndex, searchIndex, highlight } from "./search.mjs";
import {
  toast, flash, createNodeAt, selectedNode, autoWire, couldWire, graphPointFromClient,
  copyText, versionLine, helpAsText, openExternal, LINKS,
} from "./actions.mjs";
import { exampleFor, openExample } from "./examples.mjs";
import { captureCanvas } from "./screenshot.mjs";

const PINS_SETTING = "Pixaroma.Help.Pins";
const LAST_SETTING = "Pixaroma.Help.Last";
const CMD_ID = "Pixaroma.OpenHelpBrowser";

// ── state ────────────────────────────────────────────────────
const S = {
  win: null,
  index: [],
  records: [],
  pins: new Set(),
  hist: [],
  hi: -1,
  filterCat: null,
  toolbarBtn: null,
};

function loadPins() {
  const raw = nodeSetting(PINS_SETTING, null);
  const arr = Array.isArray(raw) ? raw : (typeof raw === "string" ? safeParse(raw) : null);
  S.pins = new Set(Array.isArray(arr) ? arr : []);
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function savePins() {
  try { setNodeSetting(PINS_SETTING, [...S.pins]); } catch { /* a lost pin is not worth an error */ }
}

// ── navigation ───────────────────────────────────────────────
function navigate(entry, push = true) {
  if (push) { S.hist.splice(S.hi + 1); S.hist.push(entry); S.hi = S.hist.length - 1; }
  updateNavButtons();
  try {
    setNodeSetting(LAST_SETTING, entry === "home" ? "home" : entry.key);
  } catch { /* remembering the page is a nicety */ }
  renderNav(S.win.side, S.index, entry, (e) => navigate(e));
  if (entry === "home") renderHome();
  else renderArticle(S.win.main, entry, (e) => navigate(e), articleCtx());
}
function updateNavButtons() {
  if (S.back) S.back.disabled = S.hi <= 0;
  if (S.fwd) S.fwd.disabled = S.hi >= S.hist.length - 1;
}

// ── the actions on an article ────────────────────────────────
function articleCtx() {
  return {
    index: S.index,
    buildActions(entry) {
      const row = el("div", "pixhb-acts");
      if (entry.kind === "node") {
        const add = el("button", "pixhb-btn2 pixhb-primary", "+ Add to canvas");
        add.type = "button";
        add.title = "Drops it in the middle of your view";
        add.addEventListener("click", () => {
          const n = createNodeAt(entry.cls);
          if (n) { flash(add, "Added"); toast(S.win.el, `<b>${entry.title}</b> added to your canvas.`); }
          else toast(S.win.el, "Could not create that node here.");
        });
        row.appendChild(add);

        const wire = el("button", "pixhb-btn2", "+ Add wired");
        wire.type = "button";
        wire.title = "Adds it connected to whatever you have selected";
        wire.addEventListener("click", () => {
          const from = selectedNode();
          if (!from) { toast(S.win.el, "Select a node on the canvas first, then press this."); return; }
          const n = createNodeAt(entry.cls, [from.pos[0] + (from.size?.[0] || 200) + 60, from.pos[1]]);
          if (!n) { toast(S.win.el, "Could not create that node here."); return; }
          const wired = autoWire(from, n);
          flash(wire, wired ? "Wired" : "Added");
          toast(S.win.el, wired
            ? `Wired <b>${from.title || from.comfyClass}</b> ${wired.out} into <b>${entry.title}</b> ${wired.in}.`
            : `Added <b>${entry.title}</b>, but nothing on <b>${from.title || from.comfyClass}</b> fits its inputs, so no wire was made.`);
        });
        row.appendChild(wire);

        // Only offered when an example actually exists for this node: a button
        // that sometimes does nothing is worse than no button. Built now but
        // hidden, so it keeps its place in the row rather than appearing at the
        // end once the lookup resolves.
        const ex = el("button", "pixhb-btn2", "Example workflow");
        ex.type = "button";
        ex.style.display = "none";
        row.appendChild(ex);
        exampleFor(entry.cls).then((name) => {
          if (!name || !row.isConnected) return;
          ex.style.display = "";
          ex.title = `Opens ComfyUI's templates, where "${name}" lives`;
          ex.addEventListener("click", async () => {
            const res = await openExample(name);
            if (res.ok) toast(S.win.el, `Look for <b>${name}</b> in the templates that just opened.`);
            else toast(S.win.el, res.reason);
          });
        });
      }

      const copy = el("button", "pixhb-btn2", "Copy as text");
      copy.type = "button";
      copy.title = "Ready to paste into a question";
      copy.addEventListener("click", async () => {
        const ok = await copyText(helpAsText(entry));
        ok ? flash(copy, "Copied") : toast(S.win.el, "Could not reach the clipboard.");
      });
      row.appendChild(copy);

      const ask = el("button", "pixhb-btn2", "Ask about this");
      ask.type = "button";
      ask.title = "Copies the details, then opens Discord";
      ask.addEventListener("click", async () => {
        await copyText(`${entry.title}\n${versionLine()}\n\nWhat I did:\nWhat I expected:\nWhat happened:`);
        flash(ask, "Copied");
        openExternal(LINKS.DISCORD_URL);
      });
      row.appendChild(ask);
      return row;
    },
  };
}

// ── dragging a card onto the canvas ──────────────────────────
function makeDraggable(cardEl, entry) {
  if (entry.kind !== "node") return;
  cardEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".pixhb-star")) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;
    const move = (ev) => {
      // Same lost-pointerup guard as the window drag: without it a missed
      // release leaves the ghost glued to the cursor forever.
      if (!(ev.buttons & 1)) { up(ev); return; }
      if (!ghost && (Math.abs(ev.clientX - sx) > 6 || Math.abs(ev.clientY - sy) > 6)) {
        ghost = el("div", "pixhb-dragghost", entry.title);
        document.body.appendChild(ghost);
        cardEl.style.opacity = ".4";
      }
      if (ghost) { ghost.style.left = (ev.clientX + 12) + "px"; ghost.style.top = (ev.clientY + 12) + "px"; }
    };
    let done = false;
    const up = (ev) => {
      if (done) return;
      done = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      cardEl.style.opacity = "";
      if (!ghost) return;
      ghost.remove();
      // Swallow the click that follows this drag, or the card would also open.
      cardEl._pixSkipClick = true;
      setTimeout(() => { cardEl._pixSkipClick = false; }, 80);
      // Dropped back on the window itself? Do nothing rather than place a node
      // somewhere the user cannot see.
      if (S.win.el.contains(document.elementFromPoint?.(ev.clientX, ev.clientY) || null)) {
        toast(S.win.el, "Drop it on the canvas to place it there.");
        return;
      }
      const n = createNodeAt(entry.cls, graphPointFromClient(ev.clientX, ev.clientY));
      toast(S.win.el, n ? `<b>${entry.title}</b> dropped where you let go.` : "Could not create that node here.");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

// ── the home screen ──────────────────────────────────────────
function renderHome() {
  const main = S.win.main;
  main.innerHTML = "";
  const pad = el("div", "pixhb-pad");
  const onCanvas = pixaromaOnCanvas();
  const ctx = { pins: S.pins, onCanvas, makeDraggable, togglePin: (k) => {
    S.pins.has(k) ? S.pins.delete(k) : S.pins.add(k);
    savePins();
    renderHome();
  } };

  // What is already on their canvas: usually the thing they need help with.
  const here = S.index.filter((e) => e.kind === "node" && onCanvas.has(e.cls));
  if (here.length) {
    pad.appendChild(el("p", "pixhb-h", "On your canvas right now"));
    const strip = el("div", "pixhb-strip");
    for (const e of here) {
      const m = el("button", "pixhb-mini");
      m.type = "button";
      m.innerHTML = `<span>${e.icon}</span><span></span>`;
      m.lastChild.textContent = e.title;
      m.addEventListener("click", () => navigate(e));
      strip.appendChild(m);
    }
    pad.appendChild(strip);
  }

  // Start here.
  const guides = S.index.filter((e) => e.kind === "guide");
  if (guides.length) {
    const hero = el("div", "pixhb-hero");
    const h3 = el("h3", null, "Start here");
    const p = el("p", null, "Keeping the nodes up to date, opening a downloaded workflow, and the fix for most “it looks broken” reports.");
    hero.append(h3, p);
    const grid = el("div", "pixhb-startgrid");
    for (const g of guides) {
      const c = el("button", "pixhb-startcard");
      c.type = "button";
      const ic = el("span", null, g.icon);
      ic.style.fontSize = "15px";
      const txt = el("span");
      txt.append(el("span", "pixhb-sc-n", g.title), document.createElement("br"), el("span", "pixhb-sc-d", g.tagline));
      c.append(ic, txt);
      c.addEventListener("click", () => navigate(g));
      grid.appendChild(c);
    }
    hero.appendChild(grid);
    pad.appendChild(hero);
  }

  // Pinned.
  const pinned = S.index.filter((e) => S.pins.has(e.key));
  if (pinned.length) {
    const rh = el("div", "pixhb-rowhead");
    rh.append(el("p", "pixhb-h", "Pinned"), el("span", "pixhb-hint", "the ones you keep coming back to"));
    pad.appendChild(rh);
    const grid = el("div", "pixhb-grid");
    for (const e of pinned) grid.appendChild(buildCard(e, (x) => navigate(x), ctx));
    pad.appendChild(grid);
  }

  // Everything, with category filters.
  const rh = el("div", "pixhb-rowhead");
  rh.append(el("p", "pixhb-h", "Browse everything"), el("span", "pixhb-hint", "drag a card onto the canvas to place it"));
  pad.appendChild(rh);

  const browsable = S.index.filter((e) => e.kind !== "guide");
  const chips = el("div", "pixhb-chips");
  const mkChip = (id, label) => {
    const c = el("button", "pixhb-chip" + ((S.filterCat === id) || (id === null && !S.filterCat) ? " pixhb-on" : ""), label);
    c.type = "button";
    c.addEventListener("click", () => { S.filterCat = id; renderHome(); });
    return c;
  };
  chips.appendChild(mkChip(null, "All " + browsable.length));
  for (const g of groupByCategory(browsable)) chips.appendChild(mkChip(g.name, `${g.icon} ${g.items.length}`));
  pad.appendChild(chips);

  const grid = el("div", "pixhb-grid");
  const shown = browsable.filter((e) => !S.filterCat || e.cat === S.filterCat);
  if (!shown.length) grid.appendChild(el("div", "pixhb-empty", "Nothing in this section yet."));
  for (const e of shown) grid.appendChild(buildCard(e, (x) => navigate(x), ctx));
  pad.appendChild(grid);

  // Footer: where to get help, and the version line for a support question.
  const foot = el("div", "pixhb-foot");
  const mkLink = (cls, label, url) => {
    const b = el("button", "pixhb-flink " + cls, label);
    b.type = "button";
    b.addEventListener("click", () => openExternal(url));
    return b;
  };
  foot.append(
    mkLink("pixhb-discord", "💬 Discord", LINKS.DISCORD_URL),
    mkLink("pixhb-yt", "▶️ YouTube tutorials", LINKS.YOUTUBE_URL),
    mkLink("", "🌐 Workflows site", LINKS.SITE_URL),
  );
  const ver = el("button", "pixhb-ver", versionLine() + " · click to copy");
  ver.type = "button";
  ver.title = "Copies your version details, ready to paste into a question";
  ver.addEventListener("click", async () => {
    const ok = await copyText(versionLine());
    toast(S.win.el, ok ? "Version details copied. Paste them with your question." : "Could not reach the clipboard.");
  });
  foot.appendChild(ver);
  pad.appendChild(foot);

  main.appendChild(pad);
  main.scrollTop = 0;
}

// ── search ───────────────────────────────────────────────────
function renderResults(query) {
  const main = S.win.main;
  main.innerHTML = "";
  const pad = el("div", "pixhb-pad");
  const hits = searchIndex(S.records, query, 40);

  if (!hits.length) {
    const e = el("div", "pixhb-empty");
    e.innerHTML = `Nothing matches <b>${highlight(query, "")}</b>.<br>` +
      `<span style="font-size:11px">Try a plainer word. The search reads the whole help text, not just node names.</span><br>`;
    const ask = el("button", "pixhb-btn2", "Ask on Discord instead");
    ask.type = "button";
    ask.style.marginTop = "10px";
    ask.addEventListener("click", () => openExternal(LINKS.DISCORD_URL));
    e.appendChild(ask);
    pad.appendChild(e);
    main.appendChild(pad);
    return;
  }

  pad.appendChild(el("p", "pixhb-h", `${hits.length} result${hits.length === 1 ? "" : "s"}`));
  for (const { entry } of hits) {
    const r = el("div", "pixhb-res");
    r.appendChild(el("span", "pixhb-card-ic", entry.icon));
    const t = el("div", "pixhb-res-t");
    const n = el("div", "pixhb-rn");
    n.innerHTML = highlight(entry.title, query);
    const d = el("div", "pixhb-rd");
    d.innerHTML = highlight(entry.tagline || entry.cat, query);
    t.append(n, d);
    r.appendChild(t);
    r.addEventListener("click", () => navigate(entry));
    pad.appendChild(r);
  }
  main.appendChild(pad);
  main.scrollTop = 0;
}

// ── build the window once, on first open ─────────────────────
function ensureWindow() {
  if (S.win) return S.win;
  S.win = createHelpWindow({ onRender: refresh });

  const back = el("button", "pixhb-nav", "‹");
  back.type = "button"; back.title = "Back";
  const fwd = el("button", "pixhb-nav", "›");
  fwd.type = "button"; fwd.title = "Forward";
  S.back = back; S.fwd = fwd;
  back.addEventListener("click", () => { if (S.hi > 0) { S.hi--; navigate(S.hist[S.hi], false); } });
  fwd.addEventListener("click", () => { if (S.hi < S.hist.length - 1) { S.hi++; navigate(S.hist[S.hi], false); } });

  const search = el("div", "pixhb-search");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search nodes, topics, or a problem";
  search.appendChild(input);
  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (q) renderResults(q);
    else navigate("home");
  });

  const homeBtn = el("button", "pixhb-btn2", "Home");
  homeBtn.type = "button";
  homeBtn.addEventListener("click", () => { input.value = ""; navigate("home"); });

  S.win.bar.append(back, fwd, search, homeBtn);
  return S.win;
}

// Rebuild the index every open: nodes can register late, and the graph changes
// under us because the window stays open across workflow switches.
function refresh() {
  S.index = buildIndex();
  S.records = buildSearchIndex(S.index);
  if (S.hi < 0) {
    const last = nodeSetting(LAST_SETTING, "home");
    const found = last && last !== "home" ? S.index.find((e) => e.key === last) : null;
    navigate(found || "home");
  } else {
    // Re-resolve the current entry against the fresh index so a reopened window
    // never renders a stale object.
    const cur = S.hist[S.hi];
    const live = cur === "home" ? "home" : (S.index.find((e) => e.key === cur.key) || "home");
    navigate(live, false);
  }
}

// `target` may be a node's comfyClass ("PixaromaOutpaint") or a page key
// ("canvas:colors"), so the canvas features can link here too.
export function openHelpBrowser(target) {
  loadPins();
  const w = ensureWindow();
  w.open();
  if (target) {
    const hit = S.index.find((e) => e.cls === target || e.key === target);
    if (hit) navigate(hit);
  }
}
export function toggleHelpBrowser() {
  if (S.win?.isOpen()) S.win.close();
  else openHelpBrowser();
}

// The screenshot button works whether or not the help window is open, so its
// message cannot live inside that window. ComfyUI's own toast is the right
// surface: it is always available and already where people look for feedback.
function notify(html) {
  const plain = String(html).replace(/<[^>]+>/g, "");
  try {
    app.extensionManager?.toast?.add({
      severity: "success", summary: "Pixaroma", detail: plain, life: 4000,
    });
    return;
  } catch { /* fall through */ }
  if (S.win?.isOpen()) toast(S.win.el, html);
  else console.log("[Pixaroma]", plain);
}

// ── the toolbar button ───────────────────────────────────────
function mountToolbarButton() {
  if (S.toolbarBtn?.isConnected) return;
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    if (mountToolbarButton._tries == null) mountToolbarButton._tries = 0;
    if (++mountToolbarButton._tries > 20) {
      console.warn("[Pixaroma.Help] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mountToolbarButton, 250);
    return;
  }
  injectHelpBrowserCSS();

  const btn = document.createElement("button");
  btn.className = "comfyui-button pixhb-btn";
  btn.title = "Pixaroma Help: every node, the canvas tools, and the guides";
  btn.innerHTML = `<span class="pixhb-btn-icon"></span>`;
  btn.addEventListener("click", toggleHelpBrowser);

  // Screenshot, in the same group so the two read as a pair.
  const shot = document.createElement("button");
  shot.className = "comfyui-button pixhb-shot-btn";
  shot.title = "Screenshot the canvas: saves to your output folder and copies it, ready to paste into a question";
  shot.innerHTML = `<span class="pixhb-shot-icon"></span>`;
  shot.addEventListener("click", async () => {
    if (shot.classList.contains("pixhb-busy")) return;      // one capture at a time
    shot.classList.add("pixhb-busy");
    try {
      const res = await captureCanvas();
      if (res.ok) {
        const where = res.filename
          ? `Saved as <b>${res.filename}</b> in your output folder`
          : "Captured";
        notify(`${where}${res.copied ? ", and copied ready to paste." : "."}`);
      } else if (!res.cancelled) {
        notify(res.reason);
      }
    } finally {
      shot.classList.remove("pixhb-busy");
    }
  });

  const group = document.createElement("div");
  group.className = "comfyui-button-group pixhb-group-btn";
  group.appendChild(btn);
  group.appendChild(shot);

  settingsGroupEl.before(group);
  S.toolbarBtn = btn;
}

app.registerExtension({
  name: "Pixaroma.HelpBrowser",
  commands: [
    {
      id: CMD_ID,
      label: "Pixaroma Help",
      icon: "pixhb-cmd-icon",
      function: toggleHelpBrowser,
    },
  ],
  // Registered through the official API rather than a raw keydown listener, so
  // ComfyUI owns the binding and the user can rebind it.
  keybindings: [{ combo: { key: "h", alt: true }, commandId: CMD_ID }],

  // Right-click on empty canvas. New context-menu API, never the deprecated
  // getCanvasMenuOptions monkey-patch.
  getCanvasMenuItems() {
    return [null, { content: "👑 Pixaroma Help", callback: () => openHelpBrowser() }];
  },

  setup() {
    loadPins();
    mountToolbarButton();
    // So the per-node ? popup can link through to the full page.
    try { window.PixaromaHelpBrowser = { open: openHelpBrowser, toggle: toggleHelpBrowser }; } catch { /* optional */ }
  },
});
