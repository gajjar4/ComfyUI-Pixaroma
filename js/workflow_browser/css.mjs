// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - the one stylesheet                       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Injected ONCE, and therefore it OWNS every value that goes into it. Do not
// add a parameter to injectWorkflowCSS: the toolbar button mounts long before
// the window is built, so whichever caller happened to be first would decide
// the icon url, and the Help browser has already been bitten by exactly that -
// the logo arrived as `mask: url("undefined")`, and an invalid mask hides the
// element while still computing as present, so every check passed and nothing
// was painted. (help-browser pattern #2.)
//
// Palette deliberately matches the Help window, so the two panels read as the
// same pair of tools rather than two separate products.

const CSS_ID = "pixaroma-workflows-css";

const ICON = "/pixaroma/assets/icons/ui/workflow.svg";
const ACC = "var(--pix-acc, #f66744)";

export function injectWorkflowCSS() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
/* ── toolbar button (sits beside the Help ?) ─────────────────── */
/* Values measured off the live Align and Help buttons, not guessed: the icon
   is currentColor behind a mask, hover lifts only the BACKGROUND, and the
   rendered border width is 0 so border-color never actually shows. */
.pixwb-btn .pixwb-btn-icon {
  display: inline-block; width: 18px; height: 18px;
  background-color: currentColor; pointer-events: none;
  mask-image: url(${ICON}); -webkit-mask-image: url(${ICON});
  mask-size: contain; -webkit-mask-size: contain;
  mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat;
  mask-position: center; -webkit-mask-position: center;
}
.pixwb-btn {
  background-color: #2a2c2e !important; color: #ddd !important; border-color: #444 !important;
}
.pixwb-btn:hover { background-color: #3a3d40 !important; }
.pixwb-btn.pixwb-btn-open {
  background-color: ${ACC} !important; color: #fff !important; border-color: ${ACC} !important;
}
.pixwb-btn.pixwb-btn-open:hover { background-color: ${ACC} !important; filter: brightness(1.08); }

/* ── the window ──────────────────────────────────────────────── */
.pixwb-win {
  position: fixed; z-index: 1300; display: flex; flex-direction: column;
  background: #141312; border: 1px solid #3d3936; border-radius: 10px;
  box-shadow: 0 18px 48px rgba(0,0,0,.6);
  color: #cfcac7; font-family: inherit; font-size: 13px; line-height: 1.55;
  overflow: hidden; user-select: none;
}
.pixwb-title {
  display: flex; align-items: center; gap: 8px; flex: none;
  padding: 8px 10px; background: #232120; border-bottom: 1px solid #302d2b;
  cursor: move;
}
.pixwb-title.pixwb-dragging { cursor: grabbing; }
.pixwb-name { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #fff; font-size: 12.5px; }
.pixwb-logo {
  width: 15px; height: 15px; display: inline-block; background-color: ${ACC};
  mask: url(${ICON}) center/contain no-repeat;
  -webkit-mask: url(${ICON}) center/contain no-repeat;
}
.pixwb-count { color: #7d7673; font-size: 11px; font-weight: 400; }
.pixwb-sp { flex: 1; }
.pixwb-wbtn {
  border: none; border-radius: 5px; padding: 3px 8px; cursor: pointer;
  background: rgba(255,255,255,.05); color: #a49d99; font-family: inherit; font-size: 12px;
}
.pixwb-wbtn:hover { background: ${ACC}; color: #fff; }

/* ── toolbar row ─────────────────────────────────────────────── */
.pixwb-bar {
  display: flex; align-items: center; gap: 7px; flex: none; flex-wrap: wrap;
  padding: 8px 10px; background: #1d1c1b; border-bottom: 1px solid #302d2b;
}
.pixwb-search { position: relative; flex: 1; min-width: 90px; }
.pixwb-search input {
  width: 100%; background: #141312; border: 1px solid #3d3936; color: #cfcac7;
  border-radius: 6px; padding: 5px 9px; font-family: inherit; font-size: 12.5px; outline: none;
}
.pixwb-search input::placeholder { color: #6e6764; }
.pixwb-search input:focus { border-color: ${ACC}; }
.pixwb-seg { display: flex; border: 1px solid #3d3936; border-radius: 6px; overflow: hidden; flex: none; }
.pixwb-seg button {
  border: none; background: rgba(255,255,255,.04); color: #8e8783; cursor: pointer;
  padding: 4px 9px; font-family: inherit; font-size: 11.5px;
}
.pixwb-seg button:hover { color: #fff; }
.pixwb-seg button.on { background: ${ACC}; color: #fff; }
.pixwb-tbtn {
  border: 1px solid #3d3936; background: rgba(255,255,255,.04); color: #cfcac7;
  border-radius: 6px; padding: 5px 10px; cursor: pointer; white-space: nowrap;
  font-family: inherit; font-size: 11.5px;
  transition: background .12s, border-color .12s, color .12s;
}
.pixwb-tbtn:hover { border-color: ${ACC}; color: #fff; }
.pixwb-tbtn.pixwb-primary { background: ${ACC}; border-color: ${ACC}; color: #fff; }
.pixwb-tbtn.pixwb-primary:hover { filter: brightness(1.08); }

/* ── body: folders | grid | detail ───────────────────────────── */
.pixwb-body { display: flex; flex: 1; min-height: 0; position: relative; }
.pixwb-side {
  width: 204px; min-width: 130px; flex: none; background: #1d1c1b;
  overflow-y: auto; padding: 8px 6px;
}
.pixwb-sidegrip { width: 6px; flex: none; cursor: ew-resize; background: transparent; z-index: 2; }
.pixwb-sidegrip::after {
  content: ""; display: block; width: 1px; height: 100%; margin-left: 2px;
  background: #302d2b; transition: background .12s;
}
.pixwb-sidegrip:hover::after, .pixwb-sidegrip.pixwb-dragging::after { background: ${ACC}; width: 3px; margin-left: 1px; }

.pixwb-grouphead {
  font-size: 9.5px; font-weight: 700; color: #6e6764; text-transform: uppercase;
  letter-spacing: .07em; padding: 9px 7px 4px;
}
.pixwb-fold {
  display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
  background: none; border: none; cursor: pointer; color: #b6b0ac;
  font-family: inherit; font-size: 11.5px; padding: 4px 7px; border-radius: 5px;
}
.pixwb-fold:hover { background: rgba(255,255,255,.05); color: #fff; }
.pixwb-fold.on { color: #fff; background: color-mix(in srgb, ${ACC} 15%, transparent); }
.pixwb-fold .pixwb-cnt { margin-left: auto; font-size: 9.5px; color: #7d7673; font-variant-numeric: tabular-nums; }
.pixwb-fold .pixwb-dot { width: 9px; height: 9px; border-radius: 2px; flex: none; background: #4d7ea8; }
.pixwb-fold.pixwb-droptarget { outline: 1px dashed ${ACC}; background: color-mix(in srgb, ${ACC} 10%, transparent); }
/* Dragging a FOLDER shows where it would land instead of highlighting the row,
   because the row is not the destination - the gap next to it is. */
.pixwb-fold.pixwb-insert-above { box-shadow: inset 0 2px 0 0 ${ACC}; }
.pixwb-fold.pixwb-insert-below { box-shadow: inset 0 -2px 0 0 ${ACC}; }
.pixwb-fold.pixwb-dragging-me { opacity: .45; }
.pixwb-fold .pixwb-nest { display: inline-block; flex: none; }

/* ── the grid ────────────────────────────────────────────────── */
.pixwb-main { flex: 1; min-width: 0; overflow-y: auto; padding: 10px; }
.pixwb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; align-content: start; }
.pixwb-card {
  background: #1d1c1b; border: 1px solid #302d2b; border-radius: 7px; overflow: hidden;
  cursor: pointer; position: relative; transition: border-color .12s;
}
.pixwb-card:hover { border-color: ${ACC}; }
.pixwb-card.sel { border-color: ${ACC}; box-shadow: 0 0 0 1px color-mix(in srgb, ${ACC} 45%, transparent); }
.pixwb-card.kbd { outline: 1px solid ${ACC}; outline-offset: 1px; }
.pixwb-cov { display: block; width: 100%; height: 68px; background: #141312; object-fit: cover; }
.pixwb-cardname {
  padding: 5px 6px 1px; font-size: 10.5px; color: #ddd6d2; line-height: 1.3;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.pixwb-cardmeta { padding: 0 6px 6px; font-size: 9px; color: #6e6764; }
/* The star was a 12px glyph in the corner and was genuinely hard to hit. It is
   now a proper 26x26 target with its own backdrop, so it is both visible on a
   pale cover and clickable without aiming. */
.pixwb-star {
  position: absolute; top: 3px; right: 3px;
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  font-size: 15px; line-height: 1; cursor: pointer; border-radius: 6px;
  color: rgba(255,255,255,.72); background: rgba(0,0,0,.34);
  transition: background .12s, color .12s, transform .08s;
}
.pixwb-card:hover .pixwb-star { background: rgba(0,0,0,.55); color: #fff; }
.pixwb-star:hover { background: ${ACC} !important; color: #fff !important; transform: scale(1.08); }
.pixwb-star.on { color: ${ACC}; background: rgba(0,0,0,.5); }
.pixwb-star.on:hover { color: #fff !important; }
.pixwb-openmark {
  position: absolute; top: 4px; left: 5px; width: 6px; height: 6px; border-radius: 50%;
  background: ${ACC}; box-shadow: 0 0 0 2px rgba(0,0,0,.45);
}
.pixwb-rename {
  width: 100%; box-sizing: border-box; background: #141312; border: 1px solid ${ACC};
  border-radius: 3px; color: #fff; font-family: inherit; font-size: 10.5px; padding: 2px 4px; outline: none;
}
.pixwb-empty { color: #6e6764; font-size: 12px; padding: 26px 10px; text-align: center; }

/* ── list view ───────────────────────────────────────────────── */
.pixwb-list { display: flex; flex-direction: column; }
.pixwb-row {
  display: flex; align-items: center; gap: 9px; padding: 5px 7px; border-radius: 5px;
  cursor: pointer; font-size: 11.5px; color: #b6b0ac; border: 1px solid transparent;
}
.pixwb-row:hover { background: rgba(255,255,255,.04); color: #fff; }
.pixwb-row.sel { border-color: ${ACC}; background: color-mix(in srgb, ${ACC} 12%, transparent); color: #fff; }
.pixwb-row .pixwb-rowcov { width: 40px; height: 23px; flex: none; border-radius: 3px; background: #141312; object-fit: cover; }
.pixwb-row .pixwb-rowfold { color: #6e6764; font-size: 10px; margin-left: auto; white-space: nowrap; }

/* ── detail pane ─────────────────────────────────────────────── */
.pixwb-detail {
  width: 208px; min-width: 150px; flex: none; background: #1a1918;
  overflow-y: auto; padding: 10px;
}
.pixwb-detail.hidden { display: none; }
/* Its own grip, so long model filenames can be given room instead of wrapping
   onto three lines. Same treatment as the left divider. */
.pixwb-detgrip { width: 6px; flex: none; cursor: ew-resize; background: transparent; z-index: 2; }
.pixwb-detgrip.hidden { display: none; }
.pixwb-detgrip::after {
  content: ""; display: block; width: 1px; height: 100%; margin-left: 2px;
  background: #302d2b; transition: background .12s;
}
.pixwb-detgrip:hover::after, .pixwb-detgrip.pixwb-dragging::after {
  background: ${ACC}; width: 3px; margin-left: 1px;
}
.pixwb-detcov { width: 100%; height: 104px; border-radius: 6px; background: #141312; object-fit: cover; display: block; }
.pixwb-detname { color: #fff; font-size: 12.5px; font-weight: 600; margin: 8px 0 2px; line-height: 1.35; word-break: break-word; }
.pixwb-detpath { color: #6e6764; font-size: 10px; margin-bottom: 9px; word-break: break-word; }
.pixwb-kv { display: flex; font-size: 10.5px; color: #8e8783; padding: 2px 0; gap: 8px; }
.pixwb-kv b { color: #cfcac7; font-weight: 500; margin-left: auto; text-align: right; }
.pixwb-warn { color: #d98b5f; }
.pixwb-modlist { margin: 6px 0 9px; }
/* Filenames read best as plain light text; the accent marks the EXTENSION and
   the folder is dimmed. Two earlier goes were worse: accent text on an
   accent-tinted background was orange on orange, and an accent border round
   every chip crowded the text it was meant to help. */
.pixwb-mod {
  background: #131211; border: 1px solid #2b2826;
  border-radius: 4px; padding: 3px 6px;
  font-size: 10px; margin-bottom: 3px; word-break: break-all; line-height: 1.4;
}
/* The FOLDER is grey and the FILENAME is white, extension included. Colouring
   the extension separately was tried and only broke the name into pieces - the
   filename is one thing and reads best as one thing. */
.pixwb-mod .pixwb-moddir,
.pixwb-mod .pixwb-modsep { color: #7d7673; }
.pixwb-mod .pixwb-modname,
.pixwb-mod .pixwb-modext { color: #f2eeeb; }

/* Copy-all, on the heading rather than as another row in the list. */
.pixwb-headrow { display: flex; align-items: center; gap: 6px; }
.pixwb-headrow .pixwb-grouphead { flex: 1; padding-right: 0; }
.pixwb-copybtn {
  border: 1px solid #3d3936; background: rgba(255,255,255,.04); color: #a49d99;
  border-radius: 5px; padding: 2px 8px; cursor: pointer;
  font-family: inherit; font-size: 10px; white-space: nowrap;
  transition: background .12s, border-color .12s, color .12s;
}
.pixwb-copybtn:hover { border-color: ${ACC}; color: #fff; }
.pixwb-copybtn.done { background: #3ec371; border-color: #3ec371; color: #fff; }

/* A control that would do nothing in the current view says so, rather than
   silently ignoring the click. */
.pixwb-tbtn:disabled, .pixwb-tbtn[disabled] {
  opacity: .4; cursor: default;
}
.pixwb-tbtn:disabled:hover, .pixwb-tbtn[disabled]:hover {
  border-color: #3d3936; color: #cfcac7;
}

/* ── right-click menu (folders) ──────────────────────────────── */
.pixwb-menu {
  position: fixed; z-index: 1500; min-width: 150px; max-width: 300px; padding: 4px;
  background: #232120; border: 1px solid #3d3936; border-radius: 7px;
  box-shadow: 0 12px 30px rgba(0,0,0,.62);
  /* The "move to folder" list is as long as the user has folders, so it has to
     be able to scroll rather than run off the bottom of the screen. */
  max-height: 60vh; overflow-y: auto;
}
.pixwb-menu button.pixwb-menudanger { color: #e08a6e; }
.pixwb-menu button.pixwb-menudanger:hover { background: #a33f27; color: #fff; }
.pixwb-menu button {
  display: block; width: 100%; text-align: left; background: none; border: none;
  color: #cfcac7; font-family: inherit; font-size: 11.5px; padding: 5px 9px;
  border-radius: 5px; cursor: pointer;
}
.pixwb-menu button:hover { background: ${ACC}; color: #fff; }
.pixwb-menu button:disabled { opacity: .35; cursor: default; }
.pixwb-menu button:disabled:hover { background: none; color: #cfcac7; }
.pixwb-menu .pixwb-menusep { height: 1px; background: #3d3936; margin: 4px 2px; }

/* inline folder rename */
.pixwb-foldrename {
  width: 100%; box-sizing: border-box; background: #141312; border: 1px solid ${ACC};
  border-radius: 4px; color: #fff; font-family: inherit; font-size: 11.5px;
  padding: 3px 6px; outline: none; margin: 1px 0;
}
.pixwb-note {
  width: 100%; box-sizing: border-box; background: #141312; border: 1px solid #3d3936;
  border-radius: 5px; color: #cfcac7; font-family: inherit; font-size: 11px; padding: 6px 7px;
  resize: vertical; min-height: 56px; outline: none;
}
.pixwb-note:focus { border-color: ${ACC}; }
.pixwb-acts { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.pixwb-acts .pixwb-tbtn { padding: 4px 8px; font-size: 11px; }
.pixwb-danger:hover { border-color: #c4553a !important; color: #ff9c80 !important; }

/* ── footer / keyboard hints ─────────────────────────────────── */
.pixwb-foot {
  display: flex; align-items: center; gap: 13px; flex: none; flex-wrap: wrap;
  padding: 6px 12px 6px 10px; background: #1d1c1b; border-top: 1px solid #302d2b;
  font-size: 10px; color: #6e6764;
}
.pixwb-foot b {
  background: #2a2726; border: 1px solid #3d3936; border-radius: 3px; padding: 1px 5px;
  color: #a49d99; font-weight: 500;
}
.pixwb-grip {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; z-index: 4;
}
.pixwb-grip::after {
  content: ""; position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px;
  border-right: 2px solid #4a4542; border-bottom: 2px solid #4a4542;
}

/* ── toast ───────────────────────────────────────────────────── */
.pixwb-toast {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: 14px; z-index: 6;
  background: #232120; border: 1px solid #3d3936; border-left: 3px solid ${ACC};
  border-radius: 6px; padding: 7px 13px; font-size: 11.5px; color: #ddd6d2;
  box-shadow: 0 8px 20px rgba(0,0,0,.5); max-width: 80%;
}
`;
  document.head.appendChild(style);
}
