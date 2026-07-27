// LoRA Loader Pixaroma - thin fetch wrappers over the server routes in
// server_routes.py. The list is cached for the session; info is cached per LoRA so
// re-opening the info panel is instant. The Civitai call is never cached here (it
// caches server-side as a sidecar file, so a second call is instant and offline).

let _listCache = null;
let _listPromise = null;
const _infoCache = new Map();
const _infoPromise = new Map();

export async function listLoras(force = false) {
  if (!force && _listCache) return _listCache;
  if (!force && _listPromise) return _listPromise;
  const p = (async () => {
    try {
      // no-store: the route sends no cache headers, and a heuristically-cached
      // copy of this list is exactly the "renamed file never appears" bug.
      const r = await fetch("/pixaroma/api/lora/list", { cache: "no-store" });
      const j = await r.json();
      // j.error = the SERVER's folder scan failed (not an empty folder). Treat it
      // like a network failure: keep whatever list we had. Trusting it as a real
      // [] made hasLora() brand every row "missing" - a workflow-wide false alarm.
      if (!j.error && Array.isArray(j.loras)) _listCache = j.loras;
    } catch {
      // Transient failure: KEEP the previous list (stale beats empty - nulling it
      // here used to wipe a perfectly good cache now that every dropdown open
      // force-refetches). A never-fetched cache stays null so hasLora() stays
      // "unknown" and no false missing-marks appear.
    }
    // Only clear the in-flight slot if it is still OURS - a forced call may have
    // replaced it while we were in the air (keeps the dedupe honest).
    if (_listPromise === p) _listPromise = null;
    return _listCache || [];
  })();
  _listPromise = p;
  return p;
}

export async function loraInfo(name, force = false) {
  if (!name) return { ok: false, message: "No LoRA selected." };
  if (!force && _infoCache.has(name)) return _infoCache.get(name);
  // Dedupe concurrent non-forced fetches for the same name (two nodes, same LoRA)
  // so they share one response instead of racing to overwrite the cache.
  if (!force && _infoPromise.has(name)) return _infoPromise.get(name);
  const p = (async () => {
    try {
      const r = await fetch("/pixaroma/api/lora/info?name=" + encodeURIComponent(name));
      const j = await r.json();
      // Cache SUCCESS only. A server-reported failure ({ok:false}) used to be
      // cached like a hit, so a LoRA that was briefly unresolvable (still copying,
      // a path the server could not verify) showed its error for the rest of the
      // session even after the cause was gone - plain panel opens are non-forced,
      // so only F5 cleared it.
      if (j && j.ok) _infoCache.set(name, j);
      return j;
    } catch (e) {
      return { ok: false, message: "Could not reach the server." }; // not cached -> retry next time
    } finally {
      _infoPromise.delete(name);
    }
  })();
  if (!force) _infoPromise.set(name, p);
  return p;
}

// Drop a cached info entry (after a Civitai fetch rewrote the sidecar).
export function invalidateInfo(name) {
  _infoCache.delete(name);
}

// Refresh-time invalidators (wired to ComfyUI's R via js/shared/refresh.mjs).
// The list cache goes stale the moment a file is renamed/added on disk; the
// server is always fresh (folder_paths re-validates on directory mtime), so
// dropping OUR copy is all a refresh needs.
export function invalidateList() {
  _listCache = null;
}
export function invalidateAllInfo() {
  _infoCache.clear();
}

// Is this name in the last fetched list? null = list not fetched yet (unknown),
// so callers can avoid false "missing" marks before the first load.
export function hasLora(name) {
  return _listCache ? _listCache.includes(name) : null;
}

// `bust` (a timestamp or counter) forces past the browser's image cache - the
// thumb route sends max-age=3600 and the URL otherwise never changes, so a
// preview replaced by a Civitai fetch kept showing the OLD image up to an hour.
export function thumbUrl(name, bust) {
  return "/pixaroma/api/lora/thumb?name=" + encodeURIComponent(name) +
    (bust ? "&t=" + bust : "");
}

export async function civitaiLookup(name) {
  try {
    const r = await fetch("/pixaroma/api/lora/civitai?name=" + encodeURIComponent(name));
    return await r.json();
  } catch {
    return { ok: false, reason: "offline", message: "Could not reach Civitai." };
  }
}

// Delete the saved Civitai sidecar (<base>.civitai.info) next to the LoRA, so its
// info reverts to the file's own words. Caller should invalidateInfo(name) after.
export async function deleteCivitai(name) {
  try {
    const r = await fetch("/pixaroma/api/lora/civitai_delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return await r.json();
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
