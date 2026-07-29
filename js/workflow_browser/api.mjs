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

/** Rename OR move - a move is just a rename with a different folder in it. */
export async function renameOrMove(rel, newRel) {
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
export async function saveCurrentAs(newRel) {
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

/** Favourites are ComfyUI's own bookmarks, so its sidebar shows the same stars. */
export function favourites() {
  return new Set((store()?.bookmarkedWorkflows || []).map((w) => fromStorePath(w.path)));
}

export async function toggleFavourite(rel) {
  const s = store();
  const wf = s?.getWorkflowByPath?.(toStorePath(rel));
  if (!wf) return false;
  // The bookmark flag has moved around between frontend versions, so try the
  // documented shapes in turn and report honestly if none of them exist.
  if (typeof s.bookmarkWorkflow === "function") { await s.bookmarkWorkflow(wf); return true; }
  if (typeof wf.toggleBookmark === "function") { await wf.toggleBookmark(); return true; }
  const bm = app.extensionManager?.workflowBookmark;
  if (typeof bm?.toggle === "function") { await bm.toggle(toStorePath(rel)); return true; }
  return false;
}

export async function refreshStore() {
  await store()?.syncWorkflows?.();
}
