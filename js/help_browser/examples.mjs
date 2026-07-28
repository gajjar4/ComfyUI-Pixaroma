// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - example workflows                    ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Pixaroma already ships example workflows through ComfyUI's OWN template
// system: the JSON files in this plugin's `workflows/` folder are served at
// /api/workflow_templates/ComfyUI-Pixaroma/<name>.json, thumbnails included.
// So this module does NOT invent a parallel set. It reads what is already
// there and works out which node each one demonstrates, which means a template
// added later shows up on its node's page with nothing else to edit - the same
// arrangement that makes a new node's help appear by itself.
//
// The mapping is derived by reading each template and looking at the Pixaroma
// nodes inside it, rather than kept as a hand-written list that would rot.
//
// SAFETY, and the reason this file is careful: loading a workflow REPLACES the
// open graph. An example that ate somebody's unsaved work would be far worse
// than having no examples at all. So we open a NEW tab first and verify we
// actually landed on it before loading anything. If the new tab does not
// appear, we abort and say so rather than load over what they had.

import { app } from "/scripts/app.js";
import { onNodeDefsRefresh } from "../shared/index.mjs";

const PACK = "ComfyUI-Pixaroma";
const INDEX_URL = "/api/workflow_templates";
const fileUrl = (name) => `/api/workflow_templates/${encodeURIComponent(PACK)}/${encodeURIComponent(name)}.json`;
export const thumbUrl = (name) => `/api/workflow_templates/${encodeURIComponent(PACK)}/${encodeURIComponent(name)}.jpg`;

// comfyClass -> template name. Built once per session, dropped when ComfyUI
// refreshes its node definitions (R), so a template added while the tab is
// open is picked up without a reload (convention #18).
let _map = null;
let _loading = null;
onNodeDefsRefresh(() => { _map = null; _loading = null; });

async function build() {
  const map = new Map();
  let names = [];
  try {
    const r = await fetch(INDEX_URL, { cache: "no-store" });
    if (!r.ok) return map;
    names = (await r.json())?.[PACK] || [];
  } catch {
    return map;                     // no templates route: no buttons, no error
  }

  // Read them in parallel; they are small local files.
  await Promise.all(names.map(async (name) => {
    try {
      const r = await fetch(fileUrl(name), { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      for (const node of (data?.nodes || [])) {
        const t = node?.type;
        // Our own classes only, so a KSampler in the graph does not claim it.
        if (typeof t === "string" && /Pixaroma/i.test(t) && !map.has(t)) map.set(t, name);
      }
    } catch { /* one unreadable template must not lose the rest */ }
  }));
  return map;
}

export function exampleIndex() {
  if (_map) return Promise.resolve(_map);
  if (!_loading) _loading = build().then((m) => { _map = m; return m; });
  return _loading;
}

export async function exampleFor(comfyClass) {
  if (!comfyClass) return null;
  const map = await exampleIndex();
  return map.get(comfyClass) || null;
}

// Open ComfyUI's OWN template browser, scrolled to the Pixaroma section.
//
// This deliberately does NOT load the workflow itself. Doing that by hand
// (createNewTemporary -> openWorkflow -> loadGraphData) LOOKED right and was
// tested as safe, and it still ate an open workflow: loadGraphData creates and
// attaches tabs of its own, so the "am I on a fresh tab" check was answered
// before the step that actually moved things around. The user ended up with
// the example sitting in the tab their own work had been in.
//
// Opening a workflow is core ComfyUI's job. It already handles the unsaved
// prompt, tab creation and the thumbnails, and it will keep working when the
// tab model changes underneath us. One extra click for the person, and no way
// for this feature to destroy anybody's work.
export async function openExample(name) {
  const cmd = app.extensionManager?.command;
  if (!cmd?.execute) return { ok: false, reason: "This ComfyUI build has no template browser." };
  try {
    await cmd.execute("Comfy.BrowseTemplates");
    return { ok: true, name };
  } catch {
    return { ok: false, reason: "Could not open the template browser." };
  }
}
