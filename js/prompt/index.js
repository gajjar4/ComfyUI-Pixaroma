import { app } from "/scripts/app.js";
import {
  BRAND, applyAdaptiveCanvasOnly, registerNodeHelp, closeHelpPopup, isVueNodes,
  installResizeFloor, installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeSettings } from "../shared/node_settings.mjs";
import {
  getTags, getCategories, findTag, subscribe, tagLines, isListTag, isListCat, catOf,
  tagMode, catMode, TEXT_BUCKET, LIST_BUCKET,
} from "./library.mjs";
import { nextIndex, listKey, catKey, commitPicks, beginPickBuild } from "./cursors.mjs";
import { registerRunWorkflowPatcher, readNodeProp, writeNodeProp } from "../shared/run_seed_embed.mjs";
import { api } from "/scripts/api.js";
import { expandAll, hasTags, hasWilds, hasLists, scanTokens, prevCodePoint } from "./expand.mjs";
import { openLibraryEditor, closeLibraryEditorFor } from "./library_editor.mjs";
import { openPromptSettings, closePromptSettingsFor, accentOf, getDefaultOrder } from "./settings.mjs";

// Prompt Pixaroma: a prompt box where @tags expand to library snippets, with an
// optional wired text input joined to the typed prompt. State lives on
// node.properties.promptState; the expanded prompt + order + separator are
// injected into the hidden PromptState input by the graphToPrompt hook below
// (Sliders / Seed pattern). @tag expansion + highlighting reuse expand.mjs.

const STATE_KEY = "promptState";
const DEFAULT_STATE = { text: "", order: "mine", sep: ", ", accent: null, showExpanded: true };

const DEFAULT_W = 470;
const DEFAULT_H = 210;
const MIN_W = 440;
const MIN_H = 172;
const WIDGET_MIN_H = 148;
const TAWRAP_MIN = 44;
const EXPAND_MIN = 30;

// ── state (node.properties) ────────────────────────────────────────────────
function readState(node) {
  const s = (node.properties && node.properties[STATE_KEY]) || {};
  return {
    text: typeof s.text === "string" ? s.text : DEFAULT_STATE.text,
    order: s.order === "wired" ? "wired" : "mine",
    sep: typeof s.sep === "string" ? s.sep : DEFAULT_STATE.sep,
    accent: s.accent || null,
    showExpanded: s.showExpanded !== false,
  };
}
function writeState(node, patch) {
  node.properties = node.properties || {};
  const cur = readState(node);
  node.properties[STATE_KEY] = { ...cur, ...patch };
}
// An image dragged back onto the canvas carries the words its run actually used, in
// `promptState.lastRun` (written only into the queued copy - see the patcher below).
// Seed the runtime readout from it so the expanded box shows THAT prompt straight
// away instead of an unresolved `#fruit #fruit`. Read RAW rather than through
// readState, which normalizes the key away on purpose: `writeState` then drops it on
// the user's next edit, so it can never linger once the text has moved on.
function restoreLastRun(node) {
  const raw = node.properties && node.properties[STATE_KEY];
  if (!raw || typeof raw !== "object") return;
  if (typeof raw.lastRun === "string" && typeof raw.text === "string") {
    node._pixPromptLastRun = { src: raw.text, out: raw.lastRun };
  }
}

// ── CSS ────────────────────────────────────────────────────────────────────
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pix-prm-root { --acc:${BRAND}; position:relative; display:flex; flex-direction:column; gap:6px; padding:6px;
      width:100%; height:100%; box-sizing:border-box; color:#e0e0e0; font:12px 'Segoe UI',sans-serif; }
    /* order control floats ON the input/output slot row (only when the text input
       is wired) so it never pushes the body down. Absolute + pointer-events:none on
       the empty container so the slot dots underneath stay clickable/wireable;
       only the actual controls capture clicks. Coloured with the node accent. */
    .pix-prm-portrow { position:absolute; top:-26px; left:0; right:0; margin:0; z-index:3; pointer-events:none;
      display:none; align-items:center; justify-content:center; gap:8px; user-select:none; overflow:hidden; }
    .pix-prm-portrow.on { display:flex; }
    .pix-prm-portrow .cl { font-size:10.5px; color:var(--acc); display:inline-flex; align-items:center; gap:5px; }
    .pix-prm-portrow .cl .wd { width:8px; height:8px; border-radius:50%; background:var(--acc); }
    .pix-prm-seg { pointer-events:auto; display:inline-flex; border:1px solid var(--acc); border-radius:6px; overflow:hidden; background:#1d1d1d; }
    .pix-prm-seg button { background:transparent; border:0; color:var(--acc); padding:4px 9px; font:500 11px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-prm-seg button:hover { color:#fff; background:rgba(255,255,255,.06); }
    .pix-prm-seg button.on { background:var(--acc); color:#fff; }
    /* custom dark dropdown (never a native white select - house rule) */
    .pix-prm-dd { pointer-events:auto; position:relative; display:inline-flex; }
    .pix-prm-dd-btn { display:inline-flex; align-items:center; gap:6px; background:#1d1d1d; border:1px solid var(--acc);
      border-radius:5px; color:var(--acc); font:11px 'Segoe UI',sans-serif; padding:3px 8px; cursor:pointer; white-space:nowrap; }
    .pix-prm-dd-btn:hover { color:#fff; }
    .pix-prm-dd-btn .car { font-size:9px; opacity:.85; }
    .pix-prm-dd-pop { position:fixed; z-index:10032; background:#1d1d1d; border:1px solid #4a4a4a; border-radius:6px;
      overflow:hidden; box-shadow:0 10px 26px rgba(0,0,0,.55); min-width:120px; }
    .pix-prm-dd-item { padding:6px 11px; cursor:pointer; color:#cfcfcf; font:12px 'Segoe UI',sans-serif; }
    .pix-prm-dd-item:hover, .pix-prm-dd-item.sel { background:#3a2a24; color:#fff; }
    /* The DARK background + border live on the WRAPPER (not the textarea) so the
       prompt area reads dark like Text Pixaroma while the textarea stays
       transparent for the highlight backdrop to show through. */
    .pix-prm-tawrap { position:relative; flex:2 1 0; min-height:${TAWRAP_MIN}px; display:flex;
      background:#1d1d1d; border:1px solid #333; border-radius:4px; }
    .pix-prm-tawrap:focus-within { border-color:var(--acc); }
    /* The BACKDROP is the VISIBLE text layer (tags coloured, no boxes); the textarea
       on top has TRANSPARENT text + a visible caret, so there is only ONE text layer
       that can never double/ghost. Their text columns MUST be exactly the same width
       or the two wrap at different characters and the caret drifts off the visible
       text, a little more on every wrapped line. scrollbar-gutter:stable on BOTH is
       the first line of defence (it stops the textarea's ~15px scrollbar narrowing
       it vs the backdrop) but it is only a GUESS: whether an overflow:hidden box
       reserves a gutter varies by engine/version, and a ComfyUI theme can restyle
       ::-webkit-scrollbar to a different width for a textarea than for a div. So
       syncBackdropBox() MEASURES both columns and corrects any leftover gap. */
    .pix-prm-backdrop { position:absolute; inset:0; padding:6px 8px; border:0;
      font:12px/1.5 monospace; color:#e0e0e0; white-space:pre-wrap; word-wrap:break-word; overflow:hidden; scrollbar-gutter:stable; pointer-events:none; box-sizing:border-box; }
    .pix-prm-ta { flex:1 1 auto; width:100%; height:100%; box-sizing:border-box; background:transparent; color:transparent;
      border:0; border-radius:4px; padding:6px 8px; font:12px/1.5 monospace; resize:none; outline:none; scrollbar-gutter:stable; caret-color:var(--acc); }
    .pix-prm-ta::placeholder { color:#6a6a6a; }
    /* ── WHERE A PIECE OF THE PROMPT CAME FROM (rebuilt 2026-08-02, user's design) ──
       TWO things are encoded at once:
         HUE  = which KIND of token produced it: @tag = your accent (orange by default),
                *category = green, #list = violet, and red = broken whatever the kind.
         SHADE = which ONE of that kind, cycling s0 -> s1 -> s2, so "@a @b" side by side
                never blur into one run.
       The SAME classes are used in the prompt box AND in the expanded preview, which is
       the whole point: a green run downstairs can ONLY have come from a *category, and
       its exact shade tells you WHICH one. The previous version rotated four colours by
       position with no meaning at all, so a violet run read as "that came from the
       #list" when it might have been the third @tag (user-reported, and right).
       Colour ONLY - no weight/width change, or the caret drifts off the transparent
       textarea (see the wrapping-parity note). The .bad rule is last so it beats any
       shade. NOTE: no BACKTICKS anywhere in this CSS, not even inside a comment - the
       whole block is a JS template literal, so a backtick ends the string and the rest
       of the stylesheet is parsed as JavaScript. node --check does NOT catch it; the
       browser just refuses the module and the node renders as an empty box. */
    .pix-prm-chip { color:var(--acc); }
    .pix-prm-chip.s1 { color:color-mix(in srgb, var(--acc) 55%, #ffd27a); }
    .pix-prm-chip.s2 { color:color-mix(in srgb, var(--acc) 25%, #ffe3a2); }
    .pix-prm-wild { color:#4fc98a; }
    .pix-prm-wild.s1 { color:#86d977; }
    .pix-prm-wild.s2 { color:#b6e58d; }
    .pix-prm-list { color:#b98cff; }
    .pix-prm-list.s1 { color:#d79bf0; }
    .pix-prm-list.s2 { color:#efaadf; }
    .pix-prm-chip.bad, .pix-prm-wild.bad, .pix-prm-list.bad { color:#ff4d4d; }
    /* preview GROWS with the node (flex, no fixed cap) so a big node shows more.
       LIGHTER gray (not the dark #1d1d1d of the editable inputs) so it reads as a
       read-only preview, not another input box. The plain colour lives on the CONTAINER,
       not on .mine: a descendant rule such as .pix-prm-expand .mine would out-rank the
       single-class token colours above and grey the whole thing out. */
    .pix-prm-expand { flex:1 1 0; background:#2d2d2d; border:1px solid #3a3a3a; border-radius:4px; padding:6px 8px;
      font:11px/1.5 monospace; white-space:pre-wrap; min-height:30px; overflow-y:auto; color:#d8d8d8; }
    .pix-prm-expand .lbl { color:#6d6d6d; }
    .pix-prm-expand .note { color:#8a8a8a; font-style:italic; }
    .pix-prm-bar { display:flex; align-items:center; flex:0 0 auto; gap:4px; flex-wrap:wrap; row-gap:4px; padding:0 2px; user-select:none; }
    .pix-prm-btn { box-sizing:border-box; user-select:none; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.15);
      border-radius:4px; color:rgba(255,255,255,.85); cursor:pointer; font:11px 'Segoe UI',sans-serif; padding:4px 9px;
      transition:background .1s,color .1s,border-color .1s; display:inline-flex; align-items:center; gap:5px; }
    .pix-prm-btn:hover { background:var(--acc); border-color:var(--acc); color:#fff; }
    .pix-prm-btn[disabled] { color:rgba(255,255,255,.3); cursor:default; background:rgba(255,255,255,.02); border-color:rgba(255,255,255,.08); }
    .pix-prm-btn[disabled]:hover { background:rgba(255,255,255,.02); border-color:rgba(255,255,255,.08); color:rgba(255,255,255,.3); }
    .pix-prm-btn.is-flashing, .pix-prm-btn.is-flashing:hover { background:#3ec371; border-color:#3ec371; color:#fff; }
    .pix-prm-sw { box-sizing:border-box; display:inline-flex; align-items:center; gap:5px; flex:0 0 auto; user-select:none; white-space:nowrap;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.15); border-radius:4px; color:rgba(255,255,255,.7);
      cursor:pointer; font:11px 'Segoe UI',sans-serif; padding:4px 9px; transition:background .1s,color .1s,border-color .1s; }
    .pix-prm-sw:hover { border-color:var(--acc); color:rgba(255,255,255,.92); }
    .pix-prm-sw-dot { width:8px; height:8px; border-radius:50%; border:1.5px solid rgba(255,255,255,.55); background:transparent; box-sizing:border-box; }
    .pix-prm-sw.on { background:var(--acc); border-color:var(--acc); color:#fff; }
    .pix-prm-sw.on .pix-prm-sw-dot { background:#fff; border-color:#fff; }
    /* settings gear: a SQUARE at the SAME height as the text buttons (24x24) so it
       doesn't stick out. Explicit height is required - padding:0 with no height
       collapses it to 13px. */
    .pix-prm-gear { flex:0 0 auto; width:24px; height:24px; padding:0; justify-content:center; font-size:14px; line-height:1; }
    .pix-prm-lockhint { color:var(--acc); font:10px 'Segoe UI',sans-serif; font-style:italic; padding:0 2px; margin:0; flex:0 0 auto; user-select:none; display:none; }
    /* @-autocomplete popup (appended to <body> so the node never clips it) */
    .pix-prm-ac { position:fixed; z-index:10030; background:#1d1d1d; border:1px solid #4a4a4a; border-radius:7px;
      overflow-y:auto; max-height:230px; min-width:260px; box-shadow:0 12px 30px rgba(0,0,0,.6);
      font:12px 'Segoe UI',sans-serif; display:none; }
    .pix-prm-ac-h { padding:5px 11px 3px; font:600 9.5px 'Segoe UI',sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#767676;
      display:flex; align-items:center; gap:6px; border-top:1px solid #262626; }
    .pix-prm-ac-h:first-child { border-top:none; }
    .pix-prm-ac-h .cd { width:8px; height:8px; border-radius:50%; }
    .pix-prm-ac-i { padding:6px 11px; cursor:pointer; }
    .pix-prm-ac-i.sel, .pix-prm-ac-i:hover { background:#3a2a24; }
    .pix-prm-ac-n { font:12px monospace; color:var(--acc, ${BRAND}); }
    .pix-prm-ac-i.wild .pix-prm-ac-n { color:#b98cff; }
    .pix-prm-ac-i.list .pix-prm-ac-n { color:#b98cff; }
    .pix-prm-ac-d { font-size:10.5px; color:#767676; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:320px; }
    .pix-prm-ac-empty { padding:9px 11px; color:#767676; font-size:11.5px; }
  `;
  document.head.appendChild(style);
}

// ── Help ─────────────────────────────────────────────────────────────────
const PROMPT_HELP = {
  title: "Prompt Pixaroma",
  tagline: "A prompt box with reusable @tags, random slots, and an optional text input you can join with.",
  sections: [
    {
      heading: "Writing a prompt",
      body:
        "Type your prompt in the box. To reuse a chunk you type a lot, save it once as a tag and then type `@name` for it. Type `@` to get a searchable list grouped by category - arrow keys and Enter to insert.\n\n" +
        "Known tags glow in your accent colour; an unknown `@tag` glows red so you spot a typo. At run time each `@tag` is swapped for its full text, so the box stays short. `Show expanded` previews exactly what will be sent.",
    },
    {
      heading: "Random each run",
      body:
        "Two ways to let a slot change by itself. Both roll again every time you press Run.",
      defs: [
        ["`*category`", "a random TAG from that category. `*Styles` becomes a different saved Style each run. Type `*` for a list of your categories. Only single-word names (letters, numbers, `-` or `_`) can be used this way; a category with a space in its name still works everywhere else."],
        ["`#name`", "a random LINE from one tag. Make a tag, set its switch to `List` in the library, and put one option per line (cat, dog, mouse). Then `#animals` becomes one of them. Type `#` for a list of your lists."],
      ],
    },
    {
      heading: "Shuffle, Random or In order",
      body:
        "A `Picks` control decides how a list, or anything you can roll with `*name`, chooses. It sits on the list's own card, and on the header when you open one in the library:",
      defs: [
        ["Shuffle", "the default. Like dealing a shuffled deck: every option comes up once before any repeat, then it reshuffles. A surprise every time, without the same one landing twice in a row."],
        ["Random", "any one, every time. True random repeats itself, so with three options you might get 1, 1, 3, 2, 1. Use it when you genuinely want that."],
        ["In order", "1, 2, 3 and around again. For working through a set deliberately."],
      ],
    },
    {
      heading: "Using the same list twice in one prompt",
      body:
        "Write `#fruit #fruit #fruit` and you get three different fruits, not the same one three times. Each use takes the next one along, exactly as if you had dealt three cards.\n\n" +
        "`In order` is the exception, and deliberately so: it moves on once per Run, so every `#name` in the same box shows the same entry that run, and the next Run moves to the next one.\n\n" +
        "One thing to expect with a short list: if you use it more times than it has options left, it finishes the deck, shuffles again and carries on, so one option can appear twice in a long prompt. With `Random` that can happen at any time, because random is allowed to repeat itself.",
    },
    {
      heading: "Where it is up to",
      body:
        "Shuffle and In order remember their place between runs and even after you close ComfyUI. The card shows it (`next 3 of 12`, or how many are left in the deck) and the `↺` button next to it starts that list over.\n\n" +
        "The position belongs to the list itself, so two Prompt nodes using the same `#list` both show the same first pick on a given Run. That is on purpose. A list is one deck, so if every node quietly took a card of its own, an old Prompt node parked in the corner of your workflow, wired to nothing, would still be drawing from your deck and you would never see what it took. Repeats inside one box still move along, so you keep full control from the box you are actually writing in.\n\n" +
        "The position is stored on your machine, never inside a workflow, so sharing a workflow shares nothing about where you were.",
    },
    {
      heading: "Reading the colours",
      body:
        "The colour tells you what a thing is: `@tag` in your accent colour (orange unless you changed it), `*category` in green, `#list` in violet, and red for anything unknown or empty so you spot a typo.\n\n" +
        "While you are typing, `Show expanded` names the slot instead of guessing: `[random: Styles]`, `[shuffled line: animals]`, `[next line: poses]`. It cannot show a real pick yet, because the choice is made when you press Run, and a live one would change under your hands at every keystroke.\n\n" +
        "The moment you press Run it switches to the actual words that were used, so you can always see what a picture was made from. Edit the box and it goes back to naming the slots, because the old words no longer describe what you have written. The words also travel inside the picture: drag a finished image back onto the canvas and the box shows the prompt that made it, while your `#name` template stays exactly as you wrote it. Tip: with a fixed seed the picture only changes when the pick changes, so use a random seed if you want a new image every run.\n\n" +
        "The expanded words are coloured to match what they came from, so you can trace any piece back: words in your accent colour came from an `@tag`, green from a `*category`, violet from a `#list`. Where you have several of the same kind, each takes a slightly different shade of that colour, so two tags next to each other never blur into one run. Your own typed words stay plain grey. A prompt read back off a picture you dragged in is shown in plain text, because the colouring is worked out while the prompt is being built.",
    },
    {
      heading: "Save text as a tag",
      body: "Right-click the prompt box for `Copy` and `Save as tag`. Select some text first to act on just that part, or right-click with nothing selected to use the whole prompt. `Save as tag` opens the library with the text already filled in, so you just name it and pick a category. If the text you saved has several lines it starts as a `List`, ready to roll one line at a time.",
    },
    {
      heading: "The text input and output",
      body:
        "The `text` output carries your finished prompt. The optional `text` input lets you wire in another prompt:",
      bullets: [
        "Nothing wired in: the output is just your prompt.",
        "Wired in: it is joined with your prompt. A small control on the top line lets you choose `My prompt first` or `Wired first`, and the separator (comma, space, new line, blank line, pipe, period, or BREAK).",
      ],
    },
    {
      heading: "The tag library",
      body:
        "The `Tags` button opens the fullscreen library: categories down the left, tags on the right. Add, rename, move between categories, or delete. New tags appear at the top.\n\n" +
        "Every card has a `Text` / `List` switch at the bottom. `Text` is one piece of writing that `@name` drops in whole; `List` is one option per line that `#name` rolls between. A List card shows how many options it holds, and its `Insert` drops `#name` into your prompt instead of `@name`.\n\n" +
        "The sidebar keeps the two apart: `Text categories` on top, `List categories` below, each with their own `New category` button. A category belongs to one side, so switching a card to List moves it into the List bucket, ready for you to file it wherever you like. Tags with no category of their own sit in `Text` or `List`. Because of the split, typing `@` only offers your text tags and `#` only offers your lists.\n\n" +
        "The italic `Text` and `List` rows are not categories. They are where tags with no category of their own are shown, so there is nothing to rename or delete about the row itself. Their `...` can file them all into a category at once, and the row then disappears by itself.\n\n" +
        "Anything that deletes asks you first and shows what will go, so you can check it is the one you meant. The `...` on a category row (or a right-click on it) offers rename, export just that category, delete the category but keep its tags, or delete it with them. The `...` beside Export and Import has `Delete everything` for a clean start. Where a whole group is going, the question also offers to save you a backup file. There is no undo, so the answer is final.\n\n" +
        "Your library is saved in ComfyUI's own settings, so it is private to you and survives updating the plugin. It is never saved into a workflow. Share it on purpose with `Export` and `Import`: Export lets you save everything or just one category, and Import shows you what is in the file so you can bring in only the categories you want (then keep both, replace, or skip when a name already exists).",
    },
    {
      heading: "Gear settings",
      body: "The gear (settings) button opens this node's own settings: change the button colour and set it as the default for new nodes, and choose the default join order (My prompt first / Wired first) for new Prompt nodes.",
    },
    {
      heading: "Good to know",
      body:
        "Everything expands one level: a tag becomes plain text, a `*wildcard` drops in one tag's text, and a `#list` drops in one line. A tag inside a tag is left as it is.\n\n" +
        "The symbol always decides what happens, so nothing can go wrong if you mix them: `@` on a List gives you the whole block, and `#` on a normal tag rolls one of its lines.\n\n" +
        "A workflow run without a browser (pure API) cannot expand `@tags`, roll `*wildcards` or `#lists`, or read your library. Type into a plain Text node for those, or wire the text input.",
    },
  ],
};
registerNodeHelp("PixaromaPrompt", PROMPT_HELP);

function toast(severity, msg) {
  const t = app?.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary: "Prompt Pixaroma", detail: msg, life: 2200 });
  else console.warn("[Pixaroma.Prompt]", msg);
}
function flashBtnText(btn, label) {
  // Re-entry must not capture the FLASH label as the thing to restore: double-clicking
  // Copy all used to leave the button reading "Copied" for the rest of the session,
  // because the second call's timer wrote back what the first call had put there.
  if (btn._pixFlashTimer) clearTimeout(btn._pixFlashTimer);
  else btn._pixFlashOrig = btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-flashing");
  btn._pixFlashTimer = setTimeout(() => {
    btn.textContent = btn._pixFlashOrig;
    btn.classList.remove("is-flashing");
    btn._pixFlashTimer = null;
  }, 700);
}
function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function catColor(name) {
  // The two buckets (Text / List) are not real categories - keep them neutral grey.
  if (name === TEXT_BUCKET || name === LIST_BUCKET) return "#7a7a7a";
  const i = getCategories().indexOf(name);
  if (i < 0) return "#7a7a7a";
  const PAL = ["#e0894b", "#5aa9e6", "#8e7bd6", "#5fbf8f", "#d76b98", "#c9a24b", "#6fb3b8"];
  return PAL[i % PAL.length];
}

// ── *wildcard resolution (a random tag from a category) ─────────────────────
// One category lookup shared by the highlight, the preview, and the run so they
// agree on which *categories are "live". Case-insensitive; returns {canonical, pool}
// or null (unknown OR empty category -> the *token is left literal).
function wildCat(name) {
  const canonical = getCategories().find((c) => c && c.toLowerCase() === String(name).toLowerCase());
  if (!canonical) return null;
  // catOf() matches the two buckets too: a tag with no category is stored with cat ""
  // while getCategories() surfaces it under "Text" / "List" depending on its kind.
  // Only string-text tags can be rolled (a corrupted import could carry a non-string).
  const pool = getTags().filter((t) => catOf(t).toLowerCase() === canonical.toLowerCase() && typeof t.text === "string");
  return pool.length ? { canonical, pool } : null;
}
// The word the preview shows for a mode ("[random: Styles]" / "[next: Styles]").
const MODE_WORD = { random: "random", shuffle: "shuffled", order: "next" };

// RUN resolver: the next tag from that category at queue time, per the category's
// mode (random / shuffle / in order - cursors.mjs owns the position). When the pick
// lands on a LIST tag its lines are the options, so pick one of those too, using
// THAT list's own mode (a category of lists composes: pick a list, then a line).
function pickWild(name, nextOcc) {
  const w = wildCat(name);
  if (!w) return null;
  const ck = catKey(w.canonical);
  const i = nextIndex(ck, w.pool.length, catMode(w.canonical), nextOcc ? nextOcc(ck) : 0);
  const t = w.pool[i < 0 ? 0 : i];
  if (isListTag(t)) {
    const lines = tagLines(t.text);
    if (lines.length) {
      const lk = listKey(t.name);
      const j = nextIndex(lk, lines.length, tagMode(t), nextOcc ? nextOcc(lk) : 0);
      return lines[j < 0 ? 0 : j];
    }
  }
  return t.text;
}
// PREVIEW resolver: a STABLE placeholder (the real pick happens at run time, so the
// preview must not flicker a different sample on every keystroke) that still names
// the mode, so you can see how a slot behaves without opening the library.
function previewWild(name) {
  const w = wildCat(name);
  return w ? `[${MODE_WORD[catMode(w.canonical)]}: ${w.canonical}]` : null;
}

// ── #list resolution (a random LINE from one tag) ───────────────────────────
// The SINGLE source of "is this #list live", shared by the highlight, the preview,
// the run and the autocomplete count so they can never disagree. The SYMBOL is the
// authority, not the tag's stored kind: #name rolls a line from whatever that tag
// holds (a one-line snippet just returns itself), and @name still gives the whole
// text - so no combination can error. Returns {tag, lines} or null (unknown name /
// no usable lines -> the #token is left literal).
function listOf(name) {
  const t = findTag(name);
  if (!t || typeof t.text !== "string") return null;
  const lines = tagLines(t.text);
  return lines.length ? { tag: t, lines } : null;
}
// RUN resolver: the next line at queue time, per this list's own mode.
function pickList(name, nextOcc) {
  const l = listOf(name);
  if (!l) return null;
  const lk = listKey(l.tag.name);
  const i = nextIndex(lk, l.lines.length, tagMode(l.tag), nextOcc ? nextOcc(lk) : 0);
  return l.lines[i < 0 ? 0 : i];
}
// PREVIEW resolver: a STABLE placeholder, same reasoning as previewWild.
function previewList(name) {
  const l = listOf(name);
  return l ? `[${MODE_WORD[tagMode(l.tag)]} line: ${l.tag.name}]` : null;
}
// Both random resolvers for the PREVIEW / the RUN, so every call site stays in step.
// Carry the words a run actually used INTO the image, so dragging that picture back
// shows what its prompt really was instead of an unresolved `#fruit #fruit`. Written
// only into the copy handed to the queue (which becomes extra_pnginfo.workflow), so
// Export and Ctrl+S keep your template untouched - the full reasoning is in
// js/shared/run_seed_embed.mjs. It is an EXTRA key: `text` still holds your template,
// so nothing you typed is ever overwritten.
registerRunWorkflowPatcher((workflow) => {
  let index = null;
  for (const wfNode of workflow.nodes) {
    if (!wfNode || wfNode.type !== "PixaromaPrompt") continue;
    if (!index) index = buildPromptNodeIndex();
    const live = findPromptNode(index, String(wfNode.id));
    const ran = live && live._pixPromptLastRun;
    if (!ran) continue;
    const cur = readNodeProp(wfNode, "promptState");
    if (!cur || !cur.value || typeof cur.value !== "object") continue;
    if (cur.value.text !== ran.src) continue;   // the box moved on; do not embed a stale result
    writeNodeProp(wfNode, "promptState", { ...cur.value, lastRun: ran.out }, cur.wasString);
  }
});

const PREVIEW_RESOLVERS = { resolveWild: previewWild, resolveList: previewList };
// The RUN resolvers are built FRESH per node expansion, because they carry the
// per-use counter that makes a repeated `#list` in one box deal a new card. Starting
// each node at 0 is what keeps two Prompt nodes in step on their first use (the
// user's choice) and what stops a parked, unwired node consuming a card of its own.
function makeRunResolvers() {
  const used = new Map();
  const nextOcc = (k) => { const n = used.get(k) || 0; used.set(k, n + 1); return n; };
  return {
    resolveWild: (name) => pickWild(name, nextOcc),
    resolveList: (name) => pickList(name, nextOcc),
  };
}

// A dark custom dropdown (never a native white <select> - house rule). Returns
// { el, set(value) }. `options` is [{value,label}]; onChange(value) fires on pick.
let _ddPop = null;
let _ddOutside = null;
function closeDD() {
  if (_ddPop) { _ddPop.remove(); _ddPop = null; }
  if (_ddOutside) {
    document.removeEventListener("mousedown", _ddOutside, true);
    document.removeEventListener("pointerdown", _ddOutside, true);
    document.removeEventListener("wheel", _ddOutside, true);
    document.removeEventListener("keydown", _ddEsc, true);
    _ddOutside = null;
  }
}
function _ddEsc(e) { if (e.key === "Escape") closeDD(); }
function makeDropdown(value, options, onChange) {
  const wrap = document.createElement("div"); wrap.className = "pix-prm-dd";
  const btn = document.createElement("div"); btn.className = "pix-prm-dd-btn";
  const lbl = document.createElement("span"); lbl.className = "lbl";
  const car = document.createElement("span"); car.className = "car"; car.textContent = "▾";
  btn.append(lbl, car); wrap.appendChild(btn);
  let cur = value;
  const labelOf = (v) => { const o = options.find((o) => o.value === v); return o ? o.label : v; };
  const set = (v) => { cur = v; lbl.textContent = labelOf(v); };
  set(value);
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_ddPop) { closeDD(); return; }
    const pop = document.createElement("div"); pop.className = "pix-prm-dd-pop";
    for (const o of options) {
      const it = document.createElement("div");
      it.className = "pix-prm-dd-item" + (o.value === cur ? " sel" : "");
      it.textContent = o.label;
      it.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); set(o.value); onChange(o.value); closeDD(); });
      pop.appendChild(it);
    }
    document.body.appendChild(pop);
    _ddPop = pop;
    const r = btn.getBoundingClientRect();
    // Clamp on BOTH axes, like every other popup in this node: a node panned against
    // the left edge pushed this one off-screen, and in a short viewport a 7-row list
    // could clear neither above nor below.
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
    const below = window.innerHeight - r.bottom;
    const top = (below < pop.offsetHeight + 8 && r.top > below) ? r.top - pop.offsetHeight - 4 : r.bottom + 4;
    pop.style.top = Math.max(8, Math.min(top, window.innerHeight - pop.offsetHeight - 8)) + "px";
    _ddOutside = (ev) => { if (!pop.contains(ev.target) && !btn.contains(ev.target)) closeDD(); };
    setTimeout(() => {
      // pointerdown (capture) also fires when you start dragging the node or panning
      // the canvas, so the popup closes instead of hanging in place.
      document.addEventListener("mousedown", _ddOutside, true);
      document.addEventListener("pointerdown", _ddOutside, true);
      document.addEventListener("wheel", _ddOutside, true);
      document.addEventListener("keydown", _ddEsc, true);
    }, 0);
  });
  return { el: wrap, set };
}
const SEP_OPTIONS = [
  { value: ", ", label: ", comma" },
  { value: " ", label: "space" },
  { value: "\n", label: "new line" },
  { value: "\n\n", label: "blank line" },
  { value: " | ", label: "| pipe" },
  { value: ". ", label: ". period" },
  { value: " BREAK ", label: "BREAK" },
];

// ── @-autocomplete (single body-level popup) ───────────────────────────────
const TAG_TOKEN_RE = /@([a-zA-Z0-9_\-]*)$/;
const WILD_TOKEN_RE = /\*([a-zA-Z0-9_\-]*)$/;
const LIST_TOKEN_RE = /#([a-zA-Z0-9_\-]*)$/;
let _acEl = null;
let _ac = null; // { node, ta, start, items, sel }

function acPopup() {
  if (_acEl) return _acEl;
  _acEl = document.createElement("div");
  _acEl.className = "pix-prm-ac";
  document.body.appendChild(_acEl);
  return _acEl;
}
function closeAC() {
  if (_acEl) _acEl.style.display = "none";
  _ac = null;
}
// The popup only re-evaluates on 'input'; clicking or arrow-keying the caret OFF a
// tag doesn't fire 'input', so it would linger. Watch caret moves and close/refresh
// it. One singleton document listener (no per-node leak); no-ops when no AC is open.
let _acSelInstalled = false;
function installACSelWatch() {
  if (_acSelInstalled) return;
  _acSelInstalled = true;
  document.addEventListener("selectionchange", () => {
    if (!_ac) return;
    const ta = _ac.ta;
    if (!ta || document.activeElement !== ta) { closeAC(); return; }
    maybeAC(_ac.node, ta);
  });
}
function maybeAC(node, ta) {
  const pos = ta.selectionStart;
  const upto = ta.value.slice(0, pos);
  // @tag autocomplete. Boundary (Unicode-consistent with scanTokens): don't open
  // when @ sits after a letter/number/mark/_ (an email) or another @.
  const mt = TAG_TOKEN_RE.exec(upto);
  if (mt) {
    const start = pos - mt[0].length;
    // Whole code point, not a code unit - see prevCodePoint in expand.mjs. Using
    // ta.value[start-1] would hand back half of an astral letter and open the list.
    const prev = prevCodePoint(ta.value, start);
    if (prev && /[\p{L}\p{N}\p{M}_@]/u.test(prev)) { closeAC(); return; }
    openAC(node, ta, start, mt[1].toLowerCase(), "tag");
    return;
  }
  // *wildcard (category) autocomplete - same boundary so "2*2" doesn't trigger.
  const mw = WILD_TOKEN_RE.exec(upto);
  if (mw) {
    const start = pos - mw[0].length;
    const prev = prevCodePoint(ta.value, start);
    if (prev && /[\p{L}\p{N}\p{M}_*]/u.test(prev)) { closeAC(); return; }
    openAC(node, ta, start, mw[1].toLowerCase(), "wild");
    return;
  }
  // #list autocomplete - same boundary (a "#" glued to a word isn't a token).
  const ml = LIST_TOKEN_RE.exec(upto);
  if (ml) {
    const start = pos - ml[0].length;
    const prev = prevCodePoint(ta.value, start);
    if (prev && /[\p{L}\p{N}\p{M}_#]/u.test(prev)) { closeAC(); return; }
    openAC(node, ta, start, ml[1].toLowerCase(), "list");
    return;
  }
  closeAC();
}
function openAC(node, ta, start, q, mode) {
  installACSelWatch();
  const el = acPopup();
  el.style.setProperty("--acc", accentOf(node));
  el.innerHTML = "";
  const flat = [];
  const sym = mode === "wild" ? "*" : mode === "list" ? "#" : "@";

  if (mode === "list") {
    // #lists offer ONLY the tags on the List side (the Text / List switch in the
    // library), grouped by their List category, with the number of options they roll
    // from - straight out of listOf so the count is exactly the pool. Inserts #name.
    const lists = getTags()
      .filter((t) => isListTag(t) && t.name.toLowerCase().includes(q))
      .map((t) => ({ name: t.name, cat: catOf(t), lines: listOf(t.name)?.lines || [] }))
      .filter((t) => t.lines.length > 0);
    if (!lists.length) {
      const e = document.createElement("div");
      e.className = "pix-prm-ac-empty";
      e.textContent = q
        ? `No list matches "#${q}".`
        : "No lists yet. Open Tags, then switch a tag to List and put one option per line.";
      el.appendChild(e);
    } else {
      const byCat = new Map();
      for (const t of lists) { if (!byCat.has(t.cat)) byCat.set(t.cat, []); byCat.get(t.cat).push(t); }
      for (const c of getCategories("list").filter((c) => byCat.has(c))) {
        const h = document.createElement("div");
        h.className = "pix-prm-ac-h";
        h.innerHTML = `<span class="cd" style="background:${catColor(c)}"></span>${escapeHTML(c)}`;
        el.appendChild(h);
        for (const t of byCat.get(c)) {
          const idx = flat.length;
          flat.push({ name: t.name });
          const d = document.createElement("div");
          d.className = "pix-prm-ac-i list" + (idx === 0 ? " sel" : "");
          d.dataset.i = String(idx);
          d.innerHTML = `<div class="pix-prm-ac-n">#${escapeHTML(t.name)}</div>` +
            `<div class="pix-prm-ac-d">${t.lines.length} option${t.lines.length === 1 ? "" : "s"} · ${escapeHTML(t.lines.slice(0, 3).join(" · "))}</div>`;
          d.addEventListener("mousedown", (e) => { e.preventDefault(); pickAC(flat[idx]); });
          el.appendChild(d);
        }
      }
    }
  } else if (mode === "wild") {
    // *wildcards list only categories that (a) can be TYPED as one *token - the token
    // grammar is [A-Za-z0-9_-]+, but a category name may contain spaces/symbols a
    // *token can't capture (offering "Sci Fi" would insert *Sci Fi and leave garbage);
    // AND (b) actually have at least one tag. Count comes straight from wildCat so the
    // number shown is exactly the pool it rolls from. Picking inserts *Category.
    const cats = getCategories()
      .filter((c) => c && c.toLowerCase().includes(q) && /^[a-zA-Z0-9_\-]+$/.test(c))
      .map((c) => ({ name: c, count: (wildCat(c)?.pool.length) || 0, list: isListCat(c) }))
      .filter((c) => c.count > 0);
    if (!cats.length) {
      const e = document.createElement("div");
      e.className = "pix-prm-ac-empty";
      e.textContent = q ? `No category matches "*${q}".` : "No categories with tags yet. Open Tags to add one.";
      el.appendChild(e);
    } else {
      const h = document.createElement("div");
      h.className = "pix-prm-ac-h";
      h.innerHTML = `<span class="cd" style="background:#b98cff"></span>random from category`;
      el.appendChild(h);
      for (const c of cats) {
        const idx = flat.length;
        flat.push({ name: c.name });
        const d = document.createElement("div");
        d.className = "pix-prm-ac-i wild" + (idx === 0 ? " sel" : "");
        d.dataset.i = String(idx);
        // A List category composes: *Cat picks one of its lists, then one of its lines.
        const desc = c.list
          ? `${c.count} list${c.count === 1 ? "" : "s"} · a random line from one of them`
          : `${c.count} tag${c.count === 1 ? "" : "s"} · random each run`;
        d.innerHTML = `<div class="pix-prm-ac-n">*${escapeHTML(c.name)}</div><div class="pix-prm-ac-d">${desc}</div>`;
        d.addEventListener("mousedown", (e) => { e.preventDefault(); pickAC(flat[idx]); });
        el.appendChild(d);
      }
    }
  } else {
    // @tags: ONLY the Text side, grouped by category. A List belongs to #, so
    // offering it here would just be noise (typing @listname still works - the symbol
    // is always the authority - it is simply not advertised).
    const tags = getTags().filter((t) => !isListTag(t) && t.name.toLowerCase().includes(q));
    const byCat = new Map();
    for (const t of tags) {
      const c = catOf(t);
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(t);
    }
    const order = getCategories("text").filter((c) => byCat.has(c));
    if (!tags.length) {
      const e = document.createElement("div");
      e.className = "pix-prm-ac-empty";
      e.textContent = q ? `No text tag matches "@${q}". Type # for your lists, or open Tags to add one.` : "No tags yet. Open Tags to add one.";
      el.appendChild(e);
    } else {
      for (const c of order) {
        const h = document.createElement("div");
        h.className = "pix-prm-ac-h";
        h.innerHTML = `<span class="cd" style="background:${catColor(c)}"></span>${escapeHTML(c)}`;
        el.appendChild(h);
        for (const t of byCat.get(c)) {
          const idx = flat.length;
          flat.push(t);
          const d = document.createElement("div");
          d.className = "pix-prm-ac-i" + (idx === 0 ? " sel" : "");
          d.dataset.i = String(idx);
          d.innerHTML = `<div class="pix-prm-ac-n">@${escapeHTML(t.name)}</div><div class="pix-prm-ac-d">${escapeHTML(t.text)}</div>`;
          d.addEventListener("mousedown", (e) => { e.preventDefault(); pickAC(flat[idx]); });
          el.appendChild(d);
        }
      }
    }
  }

  _ac = { node, ta, start, items: flat, sel: 0, sym };
  const r = ta.getBoundingClientRect();
  el.style.display = "block";
  el.style.minWidth = Math.max(260, Math.min(360, r.width)) + "px";
  // Place below the field, flipping above if the FULL popup would run off the bottom.
  const below = window.innerHeight - r.bottom;
  const need = Math.min(el.offsetHeight || 230, 230);
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + "px";
  if (below < need && r.top > below) { el.style.top = ""; el.style.bottom = (window.innerHeight - r.top + 4) + "px"; }
  else { el.style.bottom = ""; el.style.top = (r.bottom + 4) + "px"; }
}
function updateACSel() {
  if (!_acEl) return;
  _acEl.querySelectorAll(".pix-prm-ac-i").forEach((c) => c.classList.toggle("sel", +c.dataset.i === _ac.sel));
  const sel = _acEl.querySelector(".pix-prm-ac-i.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
// A leading space when the char before would jam the tag against a word or a
// previous @tag, so inserts never produce "@a@b" (which reads badly and is
// awkward to edit). See expand.mjs - chained tags DO expand, but a space is cleaner.
function tagSep(before) {
  return (before && /[\p{L}\p{N}\p{M}_@*#]$/u.test(before)) ? " " : "";
}
// A trailing space after an inserted tag (unless the next char already separates
// it), so typing more text continues as a SEPARATE word instead of extending the
// tag name (@goldenhour + "asdas" -> "@goldenhour asdas", not "@goldenhourasdas").
function tagTrail(after) {
  return (!after || /^[\p{L}\p{N}\p{M}_@*#]/u.test(after)) ? " " : "";
}
function pickAC(item) {
  if (!_ac) return;
  const { node, ta, start, sym } = _ac;
  const v = ta.value;
  const before = v.slice(0, start);
  const after = v.slice(ta.selectionStart);
  const ins = tagSep(before) + sym + item.name + tagTrail(after);
  ta.value = before + ins + after;
  const p = (before + ins).length; // cursor after the trailing space
  ta.selectionStart = ta.selectionEnd = p;
  closeAC();
  ta.focus();
  writeState(node, { text: ta.value });
  refreshBody(node);
}
document.addEventListener("mousedown", (e) => {
  if (_acEl && _acEl.style.display === "block" && !_acEl.contains(e.target)) {
    if (!_ac || e.target !== _ac.ta) closeAC();
  }
}, true);
// The list is position:fixed, so zooming or panning the canvas would leave it stranded
// at the old screen spot while the node moves under it (the same bug the separator
// dropdown was fixed for). installCanvasZoomPassthrough forwards wheel events from
// over the textarea to the canvas, so this fires even with the cursor on the prompt box.
document.addEventListener("wheel", (e) => {
  if (_acEl && _acEl.style.display === "block" && !_acEl.contains(e.target)) closeAC();
}, true);

// ── DOM ────────────────────────────────────────────────────────────────────
function buildRoot(node) {
  const root = document.createElement("div");
  root.className = "pix-prm-root";

  // order control (top line, shown only when the text input is wired)
  const portrow = document.createElement("div");
  portrow.className = "pix-prm-portrow";
  const cl = document.createElement("span");
  cl.className = "cl";
  cl.innerHTML = `<span class="wd"></span>join`;
  const seg = document.createElement("div");
  seg.className = "pix-prm-seg";
  const bMine = document.createElement("button"); bMine.type = "button"; bMine.textContent = "My prompt first"; bMine.dataset.order = "mine";
  const bWired = document.createElement("button"); bWired.type = "button"; bWired.textContent = "Wired first"; bWired.dataset.order = "wired";
  seg.append(bMine, bWired);
  const sepDD = makeDropdown(readState(node).sep, SEP_OPTIONS, (v) => { writeState(node, { sep: v }); renderExpand(node); });
  sepDD.el.title = "Separator between the two prompts";
  portrow.append(cl, seg, sepDD.el);

  const tawrap = document.createElement("div");
  tawrap.className = "pix-prm-tawrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pix-prm-backdrop";
  const ta = document.createElement("textarea");
  ta.className = "pix-prm-ta";
  ta.placeholder = "your prompt - @ a tag, * a random tag, # a random line";
  ta.title = "Type your prompt. @name inserts a tag, *category picks a random tag each run, #name picks a random line from a list. Ctrl+Enter runs the workflow.";
  ta.spellcheck = false;
  tawrap.append(backdrop, ta);

  const expand = document.createElement("div");
  expand.className = "pix-prm-expand";

  const lockHint = document.createElement("div");
  lockHint.className = "pix-prm-lockhint";
  lockHint.textContent = "Wired from upstream; typing here is ignored";

  const bar = document.createElement("div");
  bar.className = "pix-prm-bar";
  const mkBtn = (label, title) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "pix-prm-btn"; b.textContent = label; b.title = title; return b;
  };
  const copyBtn = mkBtn("Copy all", "Copy the whole prompt to the clipboard");
  const replaceBtn = mkBtn("Replace", "Replace the box with text from the clipboard");
  const clearBtn = mkBtn("Clear", "Empty the box instantly");
  const tagsBtn = mkBtn("Tags", "Open the tag library");
  tagsBtn.innerHTML = '<span>☲</span>Tags';
  const expandSw = document.createElement("button");
  expandSw.type = "button"; expandSw.className = "pix-prm-sw";
  expandSw.title = "Preview the prompt with every @tag expanded";
  expandSw.innerHTML = '<span class="pix-prm-sw-dot"></span>Show expanded';
  const gearBtn = document.createElement("button");
  gearBtn.type = "button"; gearBtn.className = "pix-prm-btn pix-prm-gear"; gearBtn.title = "Node settings (button colour, default join order)";
  gearBtn.textContent = "⚙";
  bar.append(copyBtn, replaceBtn, clearBtn, tagsBtn, expandSw, gearBtn);

  root.append(portrow, tawrap, expand, lockHint, bar);
  root._els = { portrow, seg, bMine, bWired, sepDD, tawrap, backdrop, ta, expand, lockHint, copyBtn, replaceBtn, clearBtn, tagsBtn, expandSw, gearBtn };
  return root;
}

// ── render ───────────────────────────────────────────────────────────────
function isWired(node) {
  for (const inp of (node.inputs || [])) if (inp && inp.name === "text_in" && inp.link != null) return true;
  return false;
}
// Show the wired input as "text" (the Python kwarg stays text_in). Idempotent so
// it never false-dirties a saved workflow (Vue Compat #18): only writes when different.
function relabelInputSlot(node) {
  for (const inp of (node.inputs || [])) if (inp && inp.name === "text_in" && inp.label !== "text") inp.label = "text";
}

// Best-effort: read the text feeding the wired input SO THE PREVIEW CAN SHOW THE
// REAL combined result. Works for plain-text sources (Text Pixaroma, another
// Prompt Pixaroma, or any node with a readable string widget). Returns null when
// the value can't be known in the browser (e.g. a model / LLM output not run yet),
// in which case the preview shows a note instead.
function resolveWiredText(node) {
  const inp = (node.inputs || []).find((i) => i && i.name === "text_in");
  if (!inp || inp.link == null) return null;
  // Link ids and node ids are PER GRAPH. For a node inside a subgraph, resolving
  // against the root graph either misses or - worse - finds an unrelated node that
  // happens to share the id, and the preview then shows a stranger's text.
  const g = node.graph || app.graph;
  let link = g.links?.[inp.link];
  if (!link && typeof g.links?.get === "function") link = g.links.get(inp.link);
  if (!link) return null;
  const src = g.getNodeById ? g.getNodeById(link.origin_id) : (g._nodes || []).find((n) => n.id === link.origin_id);
  return src ? readNodeText(src, 0) : null;
}
function readNodeText(src, depth) {
  if (!src || depth > 4) return null;
  const cls = src.comfyClass || src.type;
  if (cls === "PixaromaPrompt") {
    const t = src.properties?.promptState?.text;
    return typeof t === "string" ? expandAll(t, PREVIEW_RESOLVERS).out : null; // its own typed text, tags + random slots shown
  }
  const readW = (names) => {
    for (const name of names) {
      const w = (src.widgets || []).find((w) => w && w.name === name && typeof w.value === "string");
      if (w) return w.value;
    }
    return null;
  };
  if (cls === "PixaromaText") { const v = readW(["text"]); if (v != null) return v; }
  const byName = readW(["text", "string", "value", "prompt", "wildcard_text", "t"]);
  if (byName != null) return byName;
  const strs = (src.widgets || []).filter((w) => w && typeof w.value === "string");
  if (strs.length === 1) return strs[0].value;
  return null;
}
// The caret lives in the textarea but the text you SEE is the backdrop, so the two
// only agree while their text columns are the same width. Anything that reserves a
// scrollbar gutter on one and not the other (an engine that ignores scrollbar-gutter
// on an overflow:hidden box, a theme restyling ::-webkit-scrollbar for textareas, an
// overlay-scrollbar platform) shifts every wrapped line a bit further, so the caret
// ends up further from the visible text the longer the prompt is - the bug pattern a
// user reported 2026-07-28. Rather than trusting the CSS, measure both columns and
// close the gap with the backdrop's right padding (its box stays put; only the text
// column narrows). Reset to the CSS baseline first so corrections never compound.
// DOM-only - never touches node.size / properties, so it cannot dirty a workflow.
function syncBackdropBox(els) {
  const ta = els?.ta, bd = els?.backdrop;
  if (!ta || !bd || !ta.isConnected) return;
  bd.style.paddingRight = "";
  bd.style.width = "";
  const cs = getComputedStyle(ta), bs = getComputedStyle(bd);
  const taText = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const padR = parseFloat(bs.paddingRight);
  const bdText = bd.clientWidth - parseFloat(bs.paddingLeft) - padR;
  if (!(taText > 0) || !(bdText > 0)) return;      // not laid out yet - the observer retries
  const gap = bdText - taText;                     // > 0 = the visible text column is too wide
  if (Math.abs(gap) < 0.5) return;                 // already identical - write nothing
  if (padR + gap >= 0) bd.style.paddingRight = (padR + gap) + "px";
  else bd.style.width = Math.max(0, bd.offsetWidth - gap) + "px";  // padding can't go negative
}

// THE one place that decides what colour a piece of prompt gets. Both the prompt box
// and the expanded preview call it, which is what lets you follow a colour from the
// token you typed to the words it produced. They MUST also count tokens the same way -
// `nth` is "the Nth token of this kind", counted over EVERY token of that kind
// including unknown ones, so an unrecognised `@typo` cannot knock the two surfaces out
// of step with each other.
const KIND_CLASS = { tag: "pix-prm-chip", wild: "pix-prm-wild", list: "pix-prm-list" };
const TOKEN_SHADES = 3;
function tokenClass(kind, nth, known) {
  const base = KIND_CLASS[kind] || KIND_CLASS.tag;
  if (!known) return base + " bad";
  const s = nth % TOKEN_SHADES;
  return s ? `${base} s${s}` : base;
}
const newTokenCounts = () => ({ tag: 0, wild: 0, list: 0 });

function renderBackdrop(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  // Colour the @tags / *categories / #lists scanTokens counts (an email's @name and
  // arithmetic like 2*2 stay plain, matching the preview + the run). Hue = kind,
  // shade = which one of that kind, red = unknown; see the CSS block for the rules.
  const text = els.ta.value;
  const toks = scanTokens(text);
  const seen = newTokenCounts();
  let html = "";
  let i = 0;
  for (const h of toks) {
    html += escapeHTML(text.slice(i, h.start));
    const known = h.kind === "tag" ? !!findTag(h.name)
      : h.kind === "wild" ? !!wildCat(h.name)
      : !!listOf(h.name);
    const nth = seen[h.kind]++;
    html += `<span class="${tokenClass(h.kind, nth, known)}">${escapeHTML(h.raw)}</span>`;
    i = h.end;
  }
  html += escapeHTML(text.slice(i));
  // A <div> with white-space:pre-wrap drops ONLY the single empty line after a
  // TRAILING newline, but the textarea keeps it - so the invisible textarea would be
  // taller than the visible backdrop and the caret would drift off the text you
  // click. One trailing space puts content on that final line so both layers have
  // identical height + wrapping (works for any number of trailing newlines).
  if (text.endsWith("\n")) html += " ";
  els.backdrop.innerHTML = html;
}
// EXACT mirror of nodes/node_prompt.py run(): when either side is blank the separator
// is dropped and the other side stands alone. Without the blank checks a freshly
// wired node with nothing typed yet previewed ", their text" - a stray separator that
// the real run never produces. Keep this in lockstep with the Python.
function joinLikePython(mine, other, order, sep) {
  if (!String(other).trim()) return mine;
  if (!String(mine).trim()) return other;
  return order === "wired" ? (other + sep + mine) : (mine + sep + other);
}
function renderExpand(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const st = readState(node);
  const wired = isWired(node);
  const v = els.ta.value;
  if (!st.showExpanded || (!hasTags(v) && !hasWilds(v) && !hasLists(v) && !wired)) { els.expand.style.display = "none"; return; }
  els.expand.style.display = "block";
  // Once a build has happened, show the WORDS it actually produced rather than the
  // [shuffled line: x] placeholder - otherwise there is no way to tell what a run
  // used, and no way to read it back off an image you dragged in. Gated on the text
  // being unchanged since, so editing the box returns to the placeholder by itself
  // (a stale result would be worse than none). The placeholder is still what you see
  // while typing, which is invariant #24's "never a live random, or it flickers".
  const ran = node._pixPromptLastRun;
  const useRan = ran && ran.src === v;
  const res = useRan ? null : expandAll(v, PREVIEW_RESOLVERS);
  const mine = useRan ? ran.out : res.out;
  // A run restored from an image carries the words but not the spans (they are runtime
  // only), so that case simply reads back uncoloured rather than guessing.
  const mineHTML = paintExpanded(mine, useRan ? ran.spans : res.spans);
  if (!wired) {
    els.expand.innerHTML = `<span class="mine">${mineHTML}</span>`;
    return;
  }
  const other = resolveWiredText(node);
  if (other != null) {
    // The wired text is readable now -> show the REAL combined result, in order.
    els.expand.innerHTML = `<span class="mine">${joinHTML(mineHTML, mine, other, st.order, st.sep)}</span>`;
  } else {
    // Wired from something the browser can't read yet (e.g. a model output not run).
    const where = st.order === "wired" ? "before" : "after";
    els.expand.innerHTML = `<span class="mine">${mineHTML}</span> <span class="note">(+ wired text goes ${where}, shown here once it can be read)</span>`;
  }
}
// Colour each token's expanded words with the SAME class the prompt box gave that
// token, so you can trace a run of colour back to what produced it. Every piece is
// escaped exactly as before - the ONLY markup added is our own span wrappers, so this
// cannot become an HTML injection route.
function paintExpanded(text, spans) {
  if (!spans || !spans.length) return escapeHTML(text);
  const seen = newTokenCounts();
  let html = "", i = 0;
  for (const s of spans) {
    // Count FIRST, and count every token of the kind exactly as renderBackdrop does -
    // including one about to be skipped below. Counting after the skip would let a
    // single malformed span shift every later shade, and the prompt box and this
    // preview would quietly stop agreeing about which tag was which.
    const nth = (s && seen[s.kind] !== undefined) ? seen[s.kind]++ : 0;
    // Defensive: a span that does not line up with this string (a stale record) is
    // skipped rather than allowed to slice the text apart at the wrong place.
    if (!s || s.start < i || s.end > text.length || s.end < s.start) continue;
    html += escapeHTML(text.slice(i, s.start));
    const body = escapeHTML(text.slice(s.start, s.end));
    // An unknown token was left literal, so it is your text now, not tag text, and
    // stays plain - the prompt box above already marks it red.
    html += s.known ? `<span class="${tokenClass(s.kind, nth, true)}">${body}</span>` : body;
    i = s.end;
  }
  return html + escapeHTML(text.slice(i));
}
// The HTML twin of joinLikePython, INCLUDING both blank-side short-circuits. These two
// must stay in lockstep with each other and with node_prompt.py::run (invariant #29) -
// change one, change all three.
function joinHTML(mineHTML, mineRaw, other, order, sep) {
  if (!String(other).trim()) return mineHTML;
  if (!String(mineRaw).trim()) return escapeHTML(other);
  const o = escapeHTML(other), s = escapeHTML(sep);
  return order === "wired" ? (o + s + mineHTML) : (mineHTML + s + o);
}
function refreshBody(node) {
  renderBackdrop(node);
  renderExpand(node);
  updateClearEnabled(node);
}
function updateClearEnabled(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  els.clearBtn.disabled = !(els.ta.value && els.ta.value.length > 0);
}
function applyOrderUI(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const st = readState(node);
  els.bMine.classList.toggle("on", st.order !== "wired");
  els.bWired.classList.toggle("on", st.order === "wired");
  els.sepDD.set(st.sep);
}
function applyAccent(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  node._pixPromptRoot.style.setProperty("--acc", accentOf(node));
}
function applyExpandSwitch(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  els.expandSw.classList.toggle("on", readState(node).showExpanded);
}
function refreshWireLock(node) {
  const els = node._pixPromptRoot?._els; if (!els) return;
  const wired = isWired(node);
  els.portrow.classList.toggle("on", wired);
  renderExpand(node);
}
// The expanded preview reads the UPSTREAM wired node's text, but that node changing
// fires no event on THIS node (Vue Compat #1: no cross-node change hook). Poll so the
// preview follows an upstream edit live. Cheap: re-renders ONLY when the resolved
// wired text actually changes, and no-ops when unwired or the preview is hidden.
function startWiredPoll(node) {
  stopWiredPoll(node);
  node._pixLastWired = undefined;
  node._pixPromptPoll = setInterval(() => {
    if (!node._pixPromptRoot) return;
    if (!isWired(node) || !readState(node).showExpanded) { node._pixLastWired = undefined; return; }
    const cur = resolveWiredText(node);
    if (cur !== node._pixLastWired) { node._pixLastWired = cur; renderExpand(node); }
  }, 400);
}
function stopWiredPoll(node) {
  if (node._pixPromptPoll) { clearInterval(node._pixPromptPoll); node._pixPromptPoll = null; }
}

// ── events ─────────────────────────────────────────────────────────────────
function wireEvents(node, root) {
  const els = root._els;

  els.ta.addEventListener("input", () => {
    writeState(node, { text: els.ta.value });
    refreshBody(node);
    maybeAC(node, els.ta);
  });
  els.ta.addEventListener("scroll", () => { els.backdrop.scrollTop = els.ta.scrollTop; els.backdrop.scrollLeft = els.ta.scrollLeft; });
  // Belt for the width sync: a theme's stylesheet can land AFTER the node was built
  // and change the scrollbar width without ever resizing the textarea, so the
  // ResizeObserver would not hear about it. Re-check when the field is focused - the
  // moment before the caret matters - which is rare enough to cost nothing.
  els.ta.addEventListener("focus", () => syncBackdropBox(els));
  // Focus leaves the field -> close the autocomplete (its item clicks preventDefault
  // mousedown so they don't blur; a real click-away does, and should dismiss it).
  els.ta.addEventListener("blur", () => closeAC());
  els.ta.addEventListener("keydown", (e) => {
    if (_ac && _acEl && _acEl.style.display === "block") {
      // Ctrl/Cmd+Enter always runs the workflow (close the list, let it bubble).
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { closeAC(); return; }
      // Only steal the arrows when there is actually a list to move through - with an
      // empty popup ("No list matches...") they must still move the caret between the
      // lines of a multi-line prompt.
      if (e.key === "ArrowDown" && _ac.items.length) { e.preventDefault(); _ac.sel = Math.min(_ac.sel + 1, _ac.items.length - 1); updateACSel(); return; }
      if (e.key === "ArrowUp" && _ac.items.length) { e.preventDefault(); _ac.sel = Math.max(_ac.sel - 1, 0); updateACSel(); return; }
      if ((e.key === "Enter" || e.key === "Tab") && _ac.items.length) { e.preventDefault(); e.stopPropagation(); pickAC(_ac.items[_ac.sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAC(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return; // let ComfyUI run the workflow
    e.stopPropagation();
  });
  els.ta.addEventListener("mousedown", (e) => e.stopPropagation());
  // Right-click the prompt box for Copy / Save as tag. Acts on the selection if
  // there is one, else on the whole prompt. When there's nothing to act on (empty
  // box), fall through to the browser's own menu so paste still works.
  els.ta.addEventListener("contextmenu", (e) => {
    const ta = els.ta;
    const hasSel = ta.selectionEnd > ta.selectionStart;
    const text = hasSel ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value;
    if (!text.trim()) return;
    e.preventDefault();
    e.stopPropagation();
    openTextMenu(node, e.clientX, e.clientY, text, hasSel);
  });

  els.copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const txt = els.ta.value || "";
    if (!txt) { toast("info", "Nothing to copy"); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(txt);
      flashBtnText(els.copyBtn, "Copied");
    } catch { toast("warn", "Could not copy to clipboard"); }
  });
  els.replaceBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      if (!navigator.clipboard?.readText) throw new Error("no clipboard");
      const txt = await navigator.clipboard.readText();
      if (!txt) { toast("info", "Nothing to paste"); return; }
      els.ta.value = txt;
      writeState(node, { text: txt });
      refreshBody(node);
      flashBtnText(els.replaceBtn, "Pasted");
    } catch { toast("warn", "Could not paste from clipboard"); }
  });
  els.clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (els.clearBtn.disabled) return;
    els.ta.value = "";
    writeState(node, { text: "" });
    refreshBody(node);
  });
  els.tagsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openLibraryFor(node);
  });
  els.expandSw.addEventListener("click", (e) => {
    e.stopPropagation();
    writeState(node, { showExpanded: !readState(node).showExpanded });
    applyExpandSwitch(node);
    renderExpand(node);
  });
  els.gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPromptSettings(node, () => { applyAccent(node); refreshBody(node); });
  });
  els.bMine.addEventListener("click", (e) => { e.stopPropagation(); writeState(node, { order: "mine" }); applyOrderUI(node); renderExpand(node); });
  els.bWired.addEventListener("click", (e) => { e.stopPropagation(); writeState(node, { order: "wired" }); applyOrderUI(node); renderExpand(node); });

  for (const b of [els.copyBtn, els.replaceBtn, els.clearBtn, els.tagsBtn, els.expandSw, els.gearBtn, els.bMine, els.bWired]) {
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("mousedown", (ev) => ev.stopPropagation());
  }
}

// ── Right-click menu on the prompt box (Copy / Save as tag) ─────────────────
let _txtMenu = null;
let _txtMenuOutside = null;
let _txtMenuKey = null;
function closeTextMenu() {
  if (_txtMenuOutside) {
    document.removeEventListener("pointerdown", _txtMenuOutside, true);
    document.removeEventListener("wheel", _txtMenuOutside, true);
    _txtMenuOutside = null;
  }
  if (_txtMenuKey) { document.removeEventListener("keydown", _txtMenuKey, true); _txtMenuKey = null; }
  if (_txtMenu) { _txtMenu.remove(); _txtMenu = null; }
}
function openTextMenu(node, x, y, text, hasSel) {
  closeTextMenu();
  const menu = document.createElement("div");
  menu.className = "pix-prm-dd-pop";          // reuse the dark popup + item chrome
  menu.style.setProperty("--acc", accentOf(node));
  menu.style.minWidth = "184px";
  const mkItem = (label, fn) => {
    const it = document.createElement("div");
    it.className = "pix-prm-dd-item";
    it.textContent = label;
    it.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); closeTextMenu(); fn(); });
    menu.appendChild(it);
  };
  mkItem(hasSel ? "Copy selection" : "Copy all", async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      toast("info", "Copied to clipboard");
    } catch { toast("warn", "Could not copy to clipboard"); }
  });
  mkItem(hasSel ? "Save selection as tag" : "Save all as tag", () => openLibraryFor(node, text));
  document.body.appendChild(menu);
  _txtMenu = menu;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + "px";
  _txtMenuOutside = (e) => { if (_txtMenu && !_txtMenu.contains(e.target)) closeTextMenu(); };
  _txtMenuKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeTextMenu(); } };
  setTimeout(() => {
    document.addEventListener("pointerdown", _txtMenuOutside, true);
    document.addEventListener("wheel", _txtMenuOutside, true);
    document.addEventListener("keydown", _txtMenuKey, true);
  }, 0);
}
// Open the fullscreen library. With `prefill`, the create form starts with that
// text so the user only types a name + picks a category + Create (the "save
// selection as a tag" flow). Insert drops the chosen @tag back into the prompt.
function openLibraryFor(node, prefill) {
  openLibraryEditor(node, {
    accent: accentOf(node),
    prefill: prefill || "",
    // `sym` is "#" for a List tag (roll one line) and "@" for a snippet - the editor
    // decides from the card's own kind so Insert always drops in the useful form.
    onInsert: (name, sym) => {
      // Re-resolve every time, like every other consumer does. Capturing this once at
      // open meant a Vue teardown/rebuild of the node's DOM widget mid-session (Vue
      // Compat #5) left Insert writing into a DETACHED textarea and then stamping that
      // dead element's value into node.properties, reverting the live prompt.
      const els = node._pixPromptRoot?._els;
      if (!els) return;
      const s = sym === "#" ? "#" : "@";
      const ta = els.ta;
      const p = ta.selectionStart;
      const before = ta.value.slice(0, p);
      const after = ta.value.slice(p);
      const ins = tagSep(before) + s + name + tagTrail(after);
      ta.value = before + ins + after;
      ta.selectionStart = ta.selectionEnd = p + ins.length;
      writeState(node, { text: ta.value });
      refreshBody(node);
      toast("info", "Inserted " + s + name + " into the prompt");
    },
  });
}

// ── resize floor ───────────────────────────────────────────────────────────
function measurePromptFloor(root) {
  if (!root) return 0;
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  let h = TAWRAP_MIN;   // textarea at its min
  let count = 1;
  // portrow is absolute (floats on the slot row) so it does NOT count toward flow height.
  // The preview flexes, so use its MIN not its grown height (else the node can't shrink).
  const expand = root.querySelector(".pix-prm-expand");
  if (expand && getComputedStyle(expand).display !== "none") { h += EXPAND_MIN; count += 1; }
  const hint = root.querySelector(".pix-prm-lockhint");
  if (hint && hint.offsetParent !== null && getComputedStyle(hint).display !== "none") { h += hint.offsetHeight; count += 1; }
  const bar = root.querySelector(".pix-prm-bar");
  if (bar) { h += bar.offsetHeight; count += 1; }
  if (count > 1) h += gap * (count - 1);
  return h + padV;
}

// ── setup ────────────────────────────────────────────────────────────────
function setupNode(node) {
  injectCSS();
  const root = buildRoot(node);
  node._pixPromptRoot = root;

  // Fresh node picks up the global default join order (configure() restores a saved
  // node's own order after this, so this only sticks for genuinely new nodes).
  // Skipped while a graph is LOADING: a saved node with no promptState key at all
  // (dropped and saved by a build predating this write) has nothing for configure to
  // overwrite with, so the write would stick and flag an untouched workflow modified.
  if (node.properties?.[STATE_KEY]?.order == null && !isGraphLoading()) {
    writeState(node, { order: getDefaultOrder() });
  }

  const st = readState(node);
  root._els.ta.value = st.text;

  installCanvasZoomPassthrough(root);
  const w = node.addDOMWidget("pix_prompt_ui", "pixaroma_prompt", root, {
    getValue: () => null, setValue: () => {},
    getMinHeight: () => WIDGET_MIN_H,
    margin: 4, serialize: false,
  });
  applyAdaptiveCanvasOnly(w);

  node._pixPromptFloorOff = installResizeFloor(root, measurePromptFloor);

  // Keep the visible text column exactly as wide as the textarea's. A ResizeObserver
  // (NOT onResize - Vue Compat #13) catches every cause: the node being resized, the
  // renderer switching, and the textarea's scrollbar appearing or disappearing (that
  // shrinks its CONTENT box, which is what RO reports). It only ever writes to the
  // backdrop, which is absolutely positioned, so it cannot feed back into the
  // textarea's size and loop.
  if (typeof ResizeObserver === "function") {
    node._pixPromptBoxRO = new ResizeObserver(() => syncBackdropBox(root._els));
    node._pixPromptBoxRO.observe(root._els.ta);
  }

  wireEvents(node, root);

  // Re-highlight / re-preview when the library changes (edited in the editor).
  node._pixPromptUnsub = subscribe(() => { refreshBody(node); });
  // Keep the preview in step with an upstream wired node being edited.
  startWiredPoll(node);

  if (node.size[0] < MIN_W) node.size[0] = DEFAULT_W;
  if (node.size[1] < MIN_H) node.size[1] = DEFAULT_H;

  queueMicrotask(() => {
    restoreLastRun(node);
    relabelInputSlot(node);
    applyAccent(node);
    applyOrderUI(node);
    applyExpandSwitch(node);
    refreshWireLock(node);
    syncBackdropBox(root._els);
    refreshBody(node);
  });
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "Pixaroma.Prompt",

  // No global Settings-panel rows: per-node options (button colour, default join
  // order) live on the node's own gear panel (js/prompt/settings.mjs). The defaults
  // for new nodes persist in unregistered settings (Vue Compat #20).

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPrompt") return;

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure?.apply(this, arguments);
      queueMicrotask(() => {
        restoreLastRun(this);
        const root = this._pixPromptRoot;
        if (root && root._els) {
          const st = readState(this);
          if (root._els.ta.value !== st.text) root._els.ta.value = st.text;
          relabelInputSlot(this);
          applyAccent(this);
          applyOrderUI(this);
          applyExpandSwitch(this);
          refreshWireLock(this);
          refreshBody(this);
        }
      });
      return r;
    };

    const origOCC = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = origOCC?.apply(this, arguments);
      queueMicrotask(() => refreshWireLock(this));
      return r;
    };

    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      if (origResize) return origResize.apply(this, arguments);
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed || isVueNodes()) return;
      // isGraphLoading gate - see the same clamp in load_image_mini (convention #7)
      if (isGraphLoading()) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeHelpPopup();
      closeAC();
      closeDD();
      closeTextMenu();
      closeLibraryEditorFor(this);
      closePromptSettingsFor(this);
      this._pixPromptFloorOff?.(); this._pixPromptFloorOff = null;
      this._pixPromptBoxRO?.disconnect(); this._pixPromptBoxRO = null;
      this._pixPromptUnsub?.(); this._pixPromptUnsub = null;
      stopWiredPoll(this);
      this._pixPromptRoot = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaPrompt") return;
    setupNode(node);
  },
});

// ── graphToPrompt: expand @tags + inject PromptState (Sliders / Seed pattern) ─
function buildPromptNodeIndex() {
  const index = new Map();
  const visit = (graph, prefix) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      const fullId = prefix + String(n.id);
      if (n.comfyClass === "PixaromaPrompt" || n.type === "PixaromaPrompt") index.set(fullId, n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner, fullId + ":");
    }
  };
  visit(app.graph, "");
  return index;
}
function findPromptNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  // Fallback for a composite subgraph id ("5:3") we could not match exactly. Subgraph
  // inner ids and root ids are INDEPENDENT counters, so a bare tail can easily belong
  // to an unrelated top-level node - injecting there would swap one node's whole
  // prompt into another with no error. Only accept the tail when exactly ONE indexed
  // node carries it and that node is not a top-level node of its own.
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (!tail) return null;
  let hit = null, seen = 0;
  for (const [key, node] of index) {
    // Only NESTED candidates. A key with no colon is a top-level node, and matching
    // the tail of a subgraph id against one is exactly the mix-up this guard exists
    // to stop: root ids and subgraph inner ids are independent counters, so "5:3"
    // could otherwise land on the unrelated top-level node 3.
    const cut = key.lastIndexOf(":");
    if (cut < 0) continue;
    if (key.slice(cut + 1) === tail) { hit = node; seen++; if (seen > 1) return null; }
  }
  return seen === 1 ? hit : null;
}

// Guard against a second evaluation of this module (a mixed stamped/unstamped import
// URL, a hot reload). Wrapping twice would roll every random slot TWICE per queue, so
// an "In order" list would silently skip every other entry and a shuffle deck would
// drain at double rate. Same flag convention as the other Pixaroma nodes.
// A pick is only SPENT when a queue is actually accepted. graphToPrompt runs for
// Workflow > Export, for workflow sharing and for several Save buttons too, and it
// also runs for a queue that then fails validation - none of those should move an
// "In order" list on. Until this fires, the same pick is handed out again.
if (!app._pixPromptQueuePatched && api && typeof api.queuePrompt === "function") {
  app._pixPromptQueuePatched = true;
  const _origQueuePrompt = api.queuePrompt.bind(api);
  api.queuePrompt = async function (...args) {
    const res = await _origQueuePrompt(...args);   // throws on a rejected queue -> pick kept
    try {
      // Hand the commit the exact prompt object that was POSTed, so it spends THAT
      // build's picks. Searching the args rather than assuming a position keeps this
      // working if the signature ever moves. `output` is the object our graphToPrompt
      // hook stamped.
      let queued = null;
      for (const a of args) {
        if (a && typeof a === "object" && a.output && typeof a.output === "object") { queued = a.output; break; }
      }
      commitPicks(queued);
    } catch (err) { console.error("Pixaroma.Prompt: commitPicks failed", err); }
    return res;
  };
}

if (!app._pixPromptToPromptPatched) {
app._pixPromptToPromptPatched = true;
const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  // Bound to app above, so a future detached call (someone doing
  // `const f = app.graphToPrompt; f()`) cannot lose `this` inside our wrapper.
  const result = await _origGraphToPrompt(...args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      // Stamp this build ONTO the prompt object. commitPicks then spends exactly the
      // picks that produced the prompt that was queued, so a build that is never queued
      // (Export, workflow sharing, a Pixaroma Save button, a run rejected before it
      // starts) can neither have its picks spent nor steal a real run's.
      beginPickBuild(prompt);
      let index = null;
      for (const key of Object.keys(prompt)) {
        try {
          const entry = prompt[key];
          if (!entry || entry.class_type !== "PixaromaPrompt") continue;
          if (!index) index = buildPromptNodeIndex();
          const node = findPromptNode(index, key);
          if (!node) {
            // Fabricating an empty prompt here would silently drop what the user typed.
            // Leave the entry alone (Python falls back to its own default) and SAY so.
            // Python then falls back to its own default, i.e. the typed prompt is
            // dropped and only a wired input survives - too destructive to be silent.
            console.warn("Pixaroma.Prompt: could not match prompt node", key, "- leaving its PromptState alone");
            toast("warn", "A Prompt Pixaroma node could not be matched, so its typed prompt was not sent.");
            continue;
          }
          const st = readState(node);
          // Roll every *wildcard (a random tag) and every #list (a random line) NOW, at
          // queue time, so each run gets a fresh pick; @tags expand deterministically. A
          // different pick changes this string -> the cache key changes -> re-run (no
          // nonce needed, invariant #3).
          const ranRes = expandAll(st.text, makeRunResolvers());
          const expanded = ranRes.out;
          // Remember what this build actually produced so the expanded box can show
          // the REAL words instead of the [shuffled line: x] placeholder (users could
          // not tell what a run had picked). RUNTIME ONLY - writing node.properties
          // here would dirty a clean workflow on every run (invariant #4, the Seed
          // lesson). `src` is the text it was expanded FROM, so a later edit to the
          // box invalidates the readout by itself instead of showing a stale result.
          // `spans` rides along so the readout can colour each tag's words. Runtime
          // only, like the rest of this object - it is deliberately NOT part of the
          // `lastRun` that goes into the image, which stays the plain text.
          node._pixPromptLastRun = { src: st.text, out: expanded, spans: ranRes.spans };
          queueMicrotask(() => { try { renderExpand(node); } catch { /* node may be gone */ } });
          entry.inputs = entry.inputs || {};
          // Cosmetic keys (accent, showExpanded) are DELIBERATELY excluded so a colour
          // pick can't change the run's cache key (project note on injected state).
          entry.inputs.PromptState = JSON.stringify({ text: expanded, order: st.order, sep: st.sep });
        } catch (nodeErr) {
          // Per-node guard: one bad node must not suppress PromptState injection for the rest.
          console.error("Pixaroma.Prompt: graphToPrompt node failed", key, nodeErr);
        }
      }
    }
  } catch (err) {
    console.error("Pixaroma.Prompt: graphToPrompt hook failed", err);
  }
  return result;
};
}

// Settings live on the node's own gear button, so there was no right-click way
// in. Registering here gives BOTH the toolbar gear and a right-click entry (no
// ownMenuItem flag, so the central hook adds the line for us).
registerNodeSettings("PixaromaPrompt", {
  title: "Prompt",
  // paints from its OWN --acc var - run its own render (see Control Panel)
  onChange: (node) => { applyAccent(node); refreshBody(node); },
  open: (node) => openPromptSettings(node, () => { applyAccent(node); refreshBody(node); }),
});
