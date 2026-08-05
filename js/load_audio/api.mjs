// Load Audio Pixaroma - talking to the server.
//
// EVERY url goes through pixApiUrl. A root-relative "/view?..." works perfectly
// on localhost and 401s on a hosted ComfyUI, because there the page origin is
// the host's web app and not ComfyUI's API - and our own JS loading fine from
// the root is NOT evidence otherwise (patterns/hosted-urls.md §6).

import { pixApiUrl } from "../shared/api_url.mjs";

/** Sound files in ComfyUI's input folder. Never cached - see convention #18. */
export async function listAudioFiles() {
  try {
    const res = await fetch(pixApiUrl("/pixaroma/api/load_audio/list"), { cache: "no-store" });
    if (!res.ok) return { files: [], error: true };
    const data = await res.json();
    return {
      files: Array.isArray(data?.files) ? data.files : [],
      // The route distinguishes "the folder is empty" from "the scan failed",
      // so the face can say "could not read the folder" instead of the much
      // more alarming "you have no audio files".
      error: data?.error === true,
    };
  } catch (_e) {
    return { files: [], error: true };
  }
}

/** A url the browser can fetch the raw file from, for drawing and playing. */
export function audioFileUrl(name) {
  if (!name) return "";
  return pixApiUrl(`/view?filename=${encodeURIComponent(name)}&type=input`);
}

/**
 * Put a file in ComfyUI's input folder.
 *
 * /upload/image is core's generic upload despite the name - it is what core's
 * own Load Audio uses - and it answers {name, subfolder, type}.
 */
export async function uploadAudio(file) {
  const body = new FormData();
  body.append("image", file, file.name);
  body.append("type", "input");
  const res = await fetch(pixApiUrl("/upload/image"), { method: "POST", body });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const data = await res.json();
  const name = data?.name || file.name;
  // A file dropped into a subfolder comes back with one; the filename we store
  // has to carry it or the node cannot find the file again.
  return data?.subfolder ? `${data.subfolder}/${name}` : name;
}
