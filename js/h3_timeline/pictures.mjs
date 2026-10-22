// H3 Timeline Pixaroma - scene pictures: the input-folder list, upload, the
// picture URL, each picture's real size, and the small picker popup.
//
// A scene picture is a NAME in ComfyUI's input folder ("singer.jpg",
// "Studio/hat.png"), exactly like core Load Image's value, so Python resolves it
// the same way (nodes/node_h3_timeline._resolve_picture, input folder only).

import { api } from "../../../scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { comboViewRoute } from "../shared/view_url.mjs";

/** The picture's URL for an <img> or a CSS background (never root-relative). */
export const pictureUrl = (name) => pixApiUrl(comboViewRoute(name));

const sizes = new Map();          // name -> {w, h} | "loading" | "failed"

/** The picture's real size, loaded once; `then` runs when it arrives. */
export function pictureSize(name, then) {
  if (!name) return null;
  const s = sizes.get(name);
  if (s && typeof s === "object") return s;
  if (s === "loading" || s === "failed") return null;
  sizes.set(name, "loading");
  const img = new Image();
  img.onload = () => { sizes.set(name, { w: img.naturalWidth, h: img.naturalHeight }); then?.(); };
  img.onerror = () => { sizes.set(name, "failed"); then?.(); };
  img.src = pictureUrl(name);
  return null;
}
export const pictureFailed = (name) => sizes.get(name) === "failed";

/** Core's own list of input pictures (core Load Image's choices). Fetched on every
 *  open, so a file added outside ComfyUI shows (convention #18). */
export async function listPictures() {
  try {
    const res = await api.fetchApi("/object_info/LoadImage", { cache: "no-store" });
    const info = await res.json();
    const spec = info?.LoadImage?.input?.required?.image;
    const list = Array.isArray(spec?.[0]) ? spec[0] : (spec?.[1]?.options || []);
    return list.filter((n) => typeof n === "string");
  } catch {
    return [];
  }
}

/** Upload a picture File into the input folder; -> its name there. */
export async function uploadPicture(file) {
  const body = new FormData();
  body.append("image", file, file.name || "timeline.png");
  const res = await api.fetchApi("/upload/image", { method: "POST", body });
  if (res.status !== 200) throw new Error(`the upload answered ${res.status}`);
  const d = await res.json();
  return d?.subfolder ? `${d.subfolder}/${d.name}` : d?.name;
}

/** Ask for a picture file (the system dialog); -> File or null. */
export function askFile() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

let openPop = null;

export function closePicker() {
  const p = openPop;
  openPop = null;
  p?.close();
}

/** The picker popup under a scene's picture: Upload, Remove (when it has one),
 *  then the input pictures grouped by folder. `onPick(name | null)`. */
export async function openPicker(anchor, { current, canRemove, onPick, onUpload }) {
  closePicker();
  const pop = document.createElement("div");
  pop.className = "pix-h3t-pop";
  pop.setAttribute("role", "listbox");
  const up = document.createElement("button");
  up.className = "act";
  up.textContent = "Upload a picture...";
  up.onclick = () => { closePicker(); onUpload(); };
  pop.appendChild(up);
  if (canRemove) {
    const rm = document.createElement("button");
    rm.className = "act plain";
    rm.textContent = "No picture (keeps the look)";
    rm.onclick = () => { closePicker(); onPick(null); };
    pop.appendChild(rm);
  }
  const loading = document.createElement("div");
  loading.className = "empty";
  loading.textContent = "Loading the input folder...";
  pop.appendChild(loading);
  document.body.appendChild(pop);

  const onDown = (e) => { if (!pop.contains(e.target)) closePicker(); };
  const onWheel = (e) => { if (!pop.contains(e.target)) closePicker(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closePicker(); } };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("wheel", onWheel, true);
  window.addEventListener("keydown", onKey, true);
  const me = {
    close() {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onKey, true);
      pop.remove();
    },
  };
  openPop = me;
  placeZoomedPopup(pop, anchor, { baseMaxHeightPx: 320 });

  const names = await listPictures();
  if (openPop !== me) return;
  loading.remove();
  if (!names.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No pictures in the input folder yet.";
    pop.appendChild(e);
  }
  const groups = new Map();
  for (const n of names) {
    const i = n.lastIndexOf("/");
    const g = i < 0 ? "" : n.slice(0, i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(n);
  }
  let onItem = null;
  for (const [g, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (groups.size > 1) {
      const sec = document.createElement("div");
      sec.className = "sec";
      sec.textContent = g || "input";
      pop.appendChild(sec);
    }
    for (const n of list) {
      const b = document.createElement("button");
      b.className = "item" + (n === current ? " on" : "");
      b.textContent = n.slice(n.lastIndexOf("/") + 1);
      b.title = n;
      b.setAttribute("role", "option");
      b.onclick = () => { closePicker(); onPick(n); };
      pop.appendChild(b);
      if (n === current) onItem = b;
    }
  }
  placeZoomedPopup(pop, anchor, { baseMaxHeightPx: 320 });
  onItem?.scrollIntoView({ block: "nearest" });
}
