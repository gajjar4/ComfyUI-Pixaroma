// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma - the right-click "Text size" menu of the text nodes ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// The size itself is js/shared/text_size.mjs. This file adds the menu that makes it findable (few people know
// ComfyUI's own "Textarea widget font size" setting) and puts each node's saved level back on its boxes.
//   All text boxes: Bigger / Smaller / Reset  -> writes ComfyUI's setting, so core's boxes follow too
//   Only this node: Bigger / Smaller / Reset  -> node.properties.pixTextZoom, saved in the workflow
import { app } from "../../../scripts/app.js";
import { TEXT_SIZE_SETTING, nodeTextZoom, applyNodeTextZoom, setNodeTextZoom, notifyTextSize } from "../shared/text_size.mjs";
import { getNodeHelp } from "../shared/help.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";

// true = the node's text boxes are ours (the node level works); false = its box is ComfyUI's own (Text Match's
// words): only the setting reaches it.
const TYPES = new Map([
  ["PixaromaPrompt", true], ["PixaromaPromptMulti", true], ["PixaromaPromptPack", true], ["PixaromaPromptStack", true],
  ["PixaromaPromptEach", true], ["PixaromaText", true], ["PixaromaTextJoinTwo", true], ["PixaromaTextJoinThree", true],
  ["PixaromaTextJoinFour", true], ["PixaromaFindReplace", true], ["PixaromaShowText", true], ["PixaromaSaveText", true],
  ["PixaromaAIPrompt", true], ["PixaromaMusicPrompt", true], ["PixaromaVideoPrompt", true], ["PixaromaPauseText", true],
  ["PixaromaPromptReader", true], ["PixaromaTextMatch", false],
]);

// ComfyUI's slider is 8-24, default 10. One step = 20% of a box's normal size, for the setting and the node level alike.
const MIN = 8, MAX = 24, NORMAL = 10, STEP = 2;
const ZOOM_MIN = 0.6, ZOOM_MAX = 2, ZOOM_STEP = 0.2;

// One help section for every node above, added here instead of in 12 help files (Text Join's three share one list).
const SETTING_PATH = "Settings > Appearance > Node Widget > Textarea widget font size";
const HELP_OWN = {
  heading: "Text too small?",
  body: "Right-click the node > Text size.\n\n"
    + `All text boxes: Bigger / Smaller / Reset changes ComfyUI's own setting (${SETTING_PATH}). Every text box grows `
    + "together, ComfyUI's own boxes too, in every workflow.\n\n"
    + "Only this node: Bigger / Smaller / Reset changes this node alone. It is saved in the workflow, so it travels with it.",
};
const HELP_CORE_BOX = {
  heading: "Text too small?",
  body: "Right-click the node > Text size > All text boxes: Bigger / Smaller / Reset.\n\n"
    + `It changes ComfyUI's own setting (${SETTING_PATH}). This node's box is a ComfyUI text box, so it follows that `
    + "setting together with all the others.",
};
const HELP_WORDS = "font size text size bigger smaller larger zoom small text hard to read";

const comfySize = () => Number(app.ui.settings.getSettingValue(TEXT_SIZE_SETTING)) || NORMAL;
const setComfySize = (v) => app.ui.settings.setSettingValueAsync(TEXT_SIZE_SETTING, Math.min(MAX, Math.max(MIN, v)));

app.registerExtension({
  name: "Pixaroma.TextSize",

  // Core sets the variable from the setting in a watcher, after the setting's change event, so the boxes re-measure
  // when the VARIABLE changes (whoever changed the setting: this menu or the Settings dialog). Its first value, set
  // while ComfyUI starts, is not a change anyone made.
  setup() {
    const html = document.documentElement;
    let last = html.style.getPropertyValue("--comfy-textarea-font-size");
    new MutationObserver(() => {
      const v = html.style.getPropertyValue("--comfy-textarea-font-size");
      if (v === last) return;
      const was = last;
      last = v;
      if (!was) return;
      notifyTextSize();
      // the nodes that grew to fit (Prompt Multi / Stack) are their own undo step, not part of the next action's
      notifyGraphChanged();
    }).observe(html, { attributes: true, attributeFilter: ["style"] });

    // every node file has registered its help by now (they do it when their module loads)
    for (const [cls, own] of TYPES) {
      const def = getNodeHelp(cls);
      if (!Array.isArray(def?.sections)) continue;
      if (!def.sections.some((s) => s?.heading === HELP_OWN.heading)) def.sections.push(own ? HELP_OWN : HELP_CORE_BOX);
      if (!String(def.keywords || "").includes(HELP_WORDS)) def.keywords = `${def.keywords || ""} ${HELP_WORDS}`.trim();
    }
  },

  // After configure() (nodeCreated runs before it), so a loaded node's saved level is there; and once more a frame
  // later, for the nodes that build their boxes in a microtask of their own, after this one (Prompt Multi, Find and
  // Replace...: they reopened at the normal size). Only a changed value is written.
  nodeCreated(node) {
    if (!TYPES.get(node.comfyClass)) return;
    queueMicrotask(() => applyNodeTextZoom(node));
    requestAnimationFrame(() => applyNodeTextZoom(node));
  },

  getNodeMenuItems(node) {
    const own = TYPES.get(node?.comfyClass);
    if (own === undefined) return [];
    const v = comfySize();
    const options = [
      { content: "All text boxes: Bigger", disabled: v >= MAX, callback: () => setComfySize(v + STEP) },
      { content: "All text boxes: Smaller", disabled: v <= MIN, callback: () => setComfySize(v - STEP) },
      { content: "All text boxes: Reset", disabled: v === NORMAL, callback: () => setComfySize(NORMAL) },
    ];
    if (own) {
      const z = nodeTextZoom(node);
      options.push(null,
        { content: "Only this node: Bigger", disabled: z >= ZOOM_MAX, callback: () => setNodeTextZoom(node, z + ZOOM_STEP) },
        { content: "Only this node: Smaller", disabled: z <= ZOOM_MIN, callback: () => setNodeTextZoom(node, z - ZOOM_STEP) },
        { content: "Only this node: Reset", disabled: z === 1, callback: () => setNodeTextZoom(node, 1) });
    }
    return [null, { content: "Text size", has_submenu: true, submenu: { options } }];
  },
});
