// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma - Screenshot the canvas                             ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// One button beside the Help ? that captures what is on screen, saves it to
// ComfyUI's output folder, and puts it on the clipboard ready to paste into a
// Discord question. Just the picture: no workflow is embedded.
//
// It reuses the same save route Preview Image already uses, so there is no new
// backend and no restart needed.
//
// WHY SCREEN CAPTURE RATHER THAN canvas.toDataURL():
// The obvious approach is to export the LiteGraph canvas directly - no
// permission prompt, instant. It does not work. Pixaroma nodes draw their
// bodies with DOM widgets (Load Video's player, Load Image's picker, every
// slider and panel) which are HTML layered OVER the canvas, not painted into
// it. Measured on a Load Video node with its video preview plainly visible:
// the exported canvas contained ZERO coloured pixels. It captures the node
// frames and wires and nothing that makes a Pixaroma node look like one.
//
// getDisplayMedia captures what is actually composited on screen, so it gets
// everything. The cost is the browser's "choose what to share" prompt, which
// is not avoidable: capturing the screen is privileged by design. On Chromium
// `preferCurrentTab` pre-selects this tab, so it is one extra click.

const SAVE_URL = "/pixaroma/api/preview/save";
const PREFIX = "pixaroma_screenshots/Screenshot";

// Grab a single frame, then stop sharing immediately. Leaving the track open
// would keep the browser's "sharing your screen" state alive, which is both
// alarming and rude.
async function grabFrame() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("This browser cannot capture the screen.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
    preferCurrentTab: true,      // Chromium: pre-select this tab. Ignored elsewhere.
    selfBrowserSurface: "include",
  });
  const track = stream.getVideoTracks()[0];
  try {
    let bitmap = null;
    if (typeof window.ImageCapture === "function") {
      try { bitmap = await new window.ImageCapture(track).grabFrame(); } catch { /* fall through */ }
    }
    if (!bitmap) {
      // Fallback: play the stream into a hidden <video> and take one frame.
      const v = document.createElement("video");
      v.srcObject = stream;
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 220));   // let a frame arrive
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 1920;
      c.height = v.videoHeight || 1080;
      c.getContext("2d").drawImage(v, 0, 0);
      v.pause();
      v.srcObject = null;
      return c;
    }
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return c;
  } finally {
    // Always stop, including when the grab threw.
    for (const t of stream.getTracks()) t.stop();
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function copyToClipboard(blob) {
  try {
    if (!blob || !window.ClipboardItem || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;      // clipboard is a bonus, never the point
  }
}

// -> { ok, filename, subfolder, copied } or { ok:false, reason }
export async function captureCanvas() {
  let canvas;
  try {
    canvas = await grabFrame();
  } catch (e) {
    // A user who closes the share dialog has not hit an error, they changed
    // their mind, so say nothing alarming.
    const msg = String(e?.name === "NotAllowedError" ? "Screenshot cancelled." : (e?.message || "Could not capture the screen."));
    return { ok: false, reason: msg, cancelled: e?.name === "NotAllowedError" };
  }

  const blob = await canvasToBlob(canvas);
  const copied = await copyToClipboard(blob);

  let saved = null;
  try {
    const r = await fetch(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: canvas.toDataURL("image/png"),
        filename_prefix: PREFIX,
      }),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.status === "success") saved = j;
    }
  } catch { /* the clipboard copy may still have worked */ }

  if (!saved && !copied) return { ok: false, reason: "Captured, but could not save or copy it." };
  return { ok: true, filename: saved?.filename || null, subfolder: saved?.subfolder ?? null, copied };
}
