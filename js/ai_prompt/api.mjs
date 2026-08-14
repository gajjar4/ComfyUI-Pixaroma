// AI Prompt Pixaroma - the one thing this node asks the server for.
//
// The formula lives ON the node, so there is nothing here to save, reset,
// import or export server-side. All that is left is the list of models on
// disk for the picker.
//
// Re-fetched on every panel open (convention #18): a custom picker backed by
// our own route gets NOTHING from ComfyUI's R refresh, so a session cache
// would look permanently stale after somebody renames a file.

import { pixApiUrl } from "../shared/api_url.mjs";

/**
 * { ok, models: [...], error? }
 *
 * Never rejects. The panel must still open and say what is wrong when the
 * server is unreachable, rather than showing an empty picker with no
 * explanation - an empty folder and a failed scan must not look identical.
 */
export async function fetchModels() {
  try {
    const res = await fetch(pixApiUrl("/pixaroma/api/ai_prompt/models"), {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("models -> " + res.status);
    const data = await res.json();
    return {
      ok: !data?.error,
      models: Array.isArray(data?.models) ? data.models : [],
      error: data?.error ? String(data.error) : null,
    };
  } catch (e) {
    return { ok: false, models: [], error: String(e?.message || e) };
  }
}
