// ╔═══════════════════════════════════════════════════════════════╗
// ║  Set / Get Pixaroma - wireless "named variable" node pair     ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Pixaroma's own wireless "named variable" node pair, in a PRIVATE namespace:
// classes PixaromaSetNode / PixaromaGetNode with their own registry
// (js/set_get/scope.mjs) that only ever scans Pixaroma Set/Get. It coexists with
// any other pack's Set/Get-style nodes in one workflow with zero interference.
//
// Both are pure-frontend VIRTUAL nodes (isVirtualNode = true): no Python, never
// in the prompt. Resolution at submission goes straight through to the real
// source via getInputLink (same-graph) + resolveVirtualOutput (subgraph). Works
// in both Classic and Nodes 2.0, and inside subgraphs (native path verified on
// frontend 1.45.15).

import { app } from "/scripts/app.js";
import { registerPixaromaSetNode } from "./set_node.mjs";
import { registerPixaromaGetNode } from "./get_node.mjs";
import { startValuePoll } from "./value_preview.mjs";
import { SETTING_ID, recolorAllGets } from "./colors.mjs";
import { registerNodeAccent } from "../shared/node_settings.mjs";
import "./help.mjs"; // registers help for both nodes (convention #16)

app.registerExtension({
  name: "Pixaroma.SetGet",
  // No Settings-panel row: this option lives on the node itself (the gear in
  // the selection toolbar / the right-click entry). The setting id is unchanged
  // and merely unregistered, so an existing choice carries over; the read site
  // supplies the default for the unset case.
  registerCustomNodes() {
    registerPixaromaSetNode();
    registerPixaromaGetNode();
  },
  setup() {
    startValuePoll();
  },
});

// No colour block: a Set / Get node's colour IS its node body colour, which
// ComfyUI's own right-click Colors menu already owns. The panel hosts the
// pairing option, which used to sit in the global Settings panel. Registered on
// BOTH classes so the gear appears whichever half of the pair is selected.
for (const cls of ["PixaromaSetNode", "PixaromaGetNode"]) {
  registerNodeAccent(cls, {
    title: "Set and Get",
    accent: false,
    rows: [
      { kind: "toggle", setting: SETTING_ID, defaultValue: true,
        label: "Get matches its Set's colour",
        hint: "Matching pairs are easy to spot. Off leaves Gets on their own colour." },
    ],
    onRowChange: () => recolorAllGets(),
  });
}
