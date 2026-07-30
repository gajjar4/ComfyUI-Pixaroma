// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Workflows - every call that touches a workflow       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Deliberately the ONLY file in this feature that talks to the server or to
// ComfyUI's workflow store, so the calls that can cost somebody their work sit
// in one small file that can be read end to end.
//
// ── How a workflow is opened, and why it looks like this ────────────────────
//
// The obvious call is a trap. `app.extensionManager.workflow.openWorkflow(wf)`
// returns a Promise that resolves immediately and flips `activeWorkflow` to the
// target, but it NEVER LOADS THE GRAPH: measured against a real 14-node file,
// `isLoaded` stayed false and the canvas still showed the previous workflow
// after six seconds of polling, and the workflow was not even added to the open
// tabs. It is store bookkeeping, not an open.
//
// ComfyUI's own sidebar goes through a workflow SERVICE that lives in a
// hash-named chunk (dialogService-<hash>.js). That is not reachable from an
// extension - not on app.extensionManager, not in window.comfyAPI, and
// app.workflowManager does not exist - and importing the chunk by name would
// break on every frontend release.
//
// So we replay the app's own call, built only from stable public objects. This
// was verified against a live ComfyUI (2026-07-29):
//   - a 14-node file loads all 14 nodes into the correct tab, unmodified;
//   - switching AWAY from a workflow with unsaved edits does not lose them,
//     they stay in that workflow's tab exactly as with the native sidebar;
//   - switching BACK to an open, modified workflow restores the MODIFIED state,
//     not the version on disk.
//
// Two rules must never be relaxed:
//   1. NEVER pass { force: true } to load(). It refetches from disk and would
//      silently throw away unsaved edits.
//   2. NEVER call save()/saveAs() except from an explicit user action.

import { app } from "/scripts/app.js";

const BASE = "/pixaroma/api/workflows";

const store = () => app.extensionManager?.workflow;

// ── server ───────────────────────────────────────────────────────────────────

async function getJSON(url) {
  // no-store on our side too: this list must match the disk, and a heuristically
  // cached copy would quietly show workflows that have been renamed or deleted.
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const fetchIndex = () => getJSON(`${BASE}/index`);
export const fetchMeta = () => getJSON(`${BASE}/meta`);
export const saveMeta = (patch) => postJSON(`${BASE}/meta`, patch);
export const folderAction = (body) => postJSON(`${BASE}/folder`, body);
export const reveal = (path) => postJSON(`${BASE}/reveal`, { path });

/** Store a hand-picked cover as a real file. It used to be embedded in the
 *  sidecar as base64, which meant the whole panel re-downloaded every cover on
 *  every open - three of them already made that file 96 KB. */
export const setCover = (rel, dataUrl) => postJSON(`${BASE}/cover`, { rel, dataUrl });

/** Remove a cover. The server deletes the picture too, unless another workflow
 *  still points at it. */
export const clearCover = (rel) => saveMeta({ covers: { [rel]: null } });

// ── ComfyUI's workflow store ────────────────────────────────────────────────

/** The store keys workflows as "workflows/<relative path>". */
export const toStorePath = (rel) => (rel.startsWith("workflows/") ? rel : `workflows/${rel}`);
export const fromStorePath = (p) => (p || "").replace(/^workflows\//, "");

export function activePath() {
  return fromStorePath(store()?.activeWorkflow?.path || "");
}

export function openPaths() {
  return (store()?.openWorkflows || []).map((w) => fromStorePath(w.path));
}

export function isModified(rel) {
  const w = store()?.getWorkflowByPath?.(toStorePath(rel));
  return !!w?.isModified;
}

/**
 * Open a workflow. See the note at the top of this file before changing ANY
 * line of this function.
 */
export async function openWorkflow(rel) {
  const s = store();
  if (!s?.getWorkflowByPath) throw new Error("This ComfyUI build has no workflow store.");
  const wf = s.getWorkflowByPath(toStorePath(rel));
  if (!wf) throw new Error("That workflow is no longer there.");

  // No { force: true }: on an already-open workflow this is a no-op and its
  // unsaved edits survive. Forcing would refetch from disk and lose them.
  await wf.load();
  await app.loadGraphData(wf.activeState, true, true, wf);
  return wf;
}

/** Is there already a workflow at this path? Asked before a rename, move or
 *  save-as, because the underlying write overwrites without complaint - the
 *  duplicate path has always passed ?overwrite=false for exactly that reason,
 *  and the others had no equivalent. */
export async function exists(rel) {
  try {
    const r = await fetch(`/api/userdata/${encodeURIComponent(toStorePath(rel))}`,
                          { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch {
    return false;      // unreachable server: let the real call report the problem
  }
}

/** Rename OR move - a move is just a rename with a different folder in it. */
export async function renameOrMove(rel, newRel) {
  if (rel !== newRel && await exists(newRel)) {
    throw new Error(`There is already a workflow called "${newRel.split("/").pop()}" there.`);
  }
  const s = store();
  const wf = s?.getWorkflowByPath?.(toStorePath(rel));
  if (!wf) throw new Error("That workflow is no longer there.");
  // Through the store, never by moving the file behind its back: this is what
  // keeps an open tab pointing at the right file and its modified flag intact.
  if (typeof wf.rename === "function") await wf.rename(toStorePath(newRel));
  else if (typeof s.renameWorkflow === "function") await s.renameWorkflow(wf, toStorePath(newRel));
  else throw new Error("This ComfyUI build cannot rename workflows.");
  await s.syncWorkflows?.();
}

export async function remove(rel) {
  const s = store();
  const wf = s?.getWorkflowByPath?.(toStorePath(rel));
  if (!wf) throw new Error("That workflow is no longer there.");
  if (typeof wf.delete === "function") await wf.delete();
  else if (typeof s.deleteWorkflow === "function") await s.deleteWorkflow(wf);
  else throw new Error("This ComfyUI build cannot delete workflows.");
  await s.syncWorkflows?.();
}

/** Save the workflow that is open RIGHT NOW into a folder. User action only. */
export async function saveCurrentAs(newRel, { overwrite = false } = {}) {
  if (!overwrite && await exists(newRel)) {
    throw new Error(`There is already a workflow called "${newRel.split("/").pop()}" there.`);
  }
  const s = store();
  const wf = s?.activeWorkflow;
  if (!wf) throw new Error("Nothing is open to save.");
  if (typeof wf.saveAs !== "function") throw new Error("This ComfyUI build cannot save-as.");
  await wf.saveAs(toStorePath(newRel));
  await s.syncWorkflows?.();
}

/**
 * Copy a workflow beside itself. Uses ComfyUI's own userdata endpoints rather
 * than reading and rewriting the file ourselves, so the copy is byte-identical
 * and lands where core expects it.
 */
export async function duplicate(rel, newRel) {
  const enc = (p) => encodeURIComponent(toStorePath(p));
  const r = await fetch(`/api/userdata/${enc(rel)}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Could not read that workflow.");
  const body = await r.text();
  const w = await fetch(`/api/userdata/${enc(newRel)}?overwrite=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!w.ok) throw new Error(w.status === 409 ? "A workflow with that name already exists." : "Could not save the copy.");
  await store()?.syncWorkflows?.();
}

/**
 * ComfyUI does NOT read the favourites file at startup. Its bookmark store is
 * empty until something calls loadBookmarks() - normally its own Workflows
 * sidebar being opened. Two consequences, and the second one destroys data:
 *
 *   1. reading the list straight away reports NO favourites even when the file
 *      has some, so every star showed as unset;
 *   2. toggling in that state appends to an EMPTY in-memory list and saves it,
 *      which overwrites the file and wipes every favourite that was on disk.
 *      This wiped a real one during development.
 *
 * So the store is loaded from disk before the list is read AND before anything
 * is toggled. It is one small local file, and being right matters more than the
 * few milliseconds.
 */
export async function ensureFavouritesLoaded() {
  const bm = bookmarkStore();
  if (typeof bm?.loadBookmarks !== "function") return false;
  try {
    await bm.loadBookmarks();
    return true;
  } catch {
    return false;
  }
}

/** Favourites are ComfyUI's own bookmarks, so its sidebar shows the same stars.
 *  Only meaningful after ensureFavouritesLoaded() has resolved. */
export function favourites() {
  return new Set((store()?.bookmarkedWorkflows || []).map((w) => fromStorePath(w.path)));
}

/**
 * Favourites live in ComfyUI's `workflowBookmark` store, which persists them to
 * `user/default/workflows/.index.json` - the same file and the same stars its
 * own sidebar shows.
 *
 * That store is NOT on `app.extensionManager` (which exposes only a read-only
 * `bookmarkedWorkflows` list), so it has to be reached through pinia.
 *
 * There is deliberately NO fallback that writes `.index.json` ourselves. It was
 * tried and it DESTROYS DATA: the store holds its own copy in memory, so a
 * direct write drifts from it, the star does not light up, and the app's next
 * save overwrites the file from its stale copy. During development that silently
 * wiped a real favourite. Failing honestly is better than a fallback that can
 * delete the other favourites as a side effect.
 */
function bookmarkStore() {
  try {
    const pinia = document.querySelector("#vue-app")?.__vue_app__?.config?.globalProperties?.$pinia;
    return pinia?._s?.get("workflowBookmark") || null;
  } catch {
    return null;
  }
}

export async function toggleFavourite(rel) {
  const bm = bookmarkStore();
  if (typeof bm?.toggleBookmarked !== "function") {
    throw new Error("This ComfyUI build keeps favourites somewhere this panel cannot reach. "
      + "Use the star in ComfyUI's own Workflows sidebar.");
  }
  // MUST come first. Toggling against a store that has not read the file yet
  // saves a list built from nothing and erases every existing favourite.
  await ensureFavouritesLoaded();
  await bm.toggleBookmarked(toStorePath(rel));
  return true;
}

export async function refreshStore() {
  await store()?.syncWorkflows?.();
}
