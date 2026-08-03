"""Save Image Pixaroma - save images to ANY folder on disk (or output/),
with filename tokens, PNG/JPG, optional workflow embedding, and batch support.

The node face (folder + filename pattern + live preview + format) and the
right-click settings panel live in js/save_image/. State arrives via the
hidden SaveImageState input, injected by the frontend at graphToPrompt time
(Pattern #9). %NodeName.widget% tokens (e.g. %Seed Pixaroma.seed%) are
resolved FRONTEND-side before injection; %date:FMT%, %input%, %width%,
%height%, %batch_num% and %counter% are resolved here.
"""

import json
import os
import re
import time
import uuid
from collections import OrderedDict

import folder_paths
import numpy as np
from PIL import Image

from ._path_guard import (
    folder_allowed as _pix_folder_allowed,
    prescreen as _pix_prescreen,
    denied_message as _pix_denied_message,
)
from ._save_helpers import (
    _build_pnginfo,
    _expand_date_tokens,
    _json_safe,
    _metadata_disabled,
    _next_counter,
    _resolve_save_folder,
    _safe_prefix,
)

# Keys MUST match js/save_image/state.mjs::DEFAULT_STATE.
DEFAULT_STATE = {
    "version": 1,
    "folder": "",
    "pattern": "image_%date:yyyy-MM-dd%_%counter%",
    "format": "png",
    "quality": 100,
    "embedWorkflow": True,
    "civitaiMeta": False,
    "saveOnRun": True,
    "dateStyle": "yyyy-MM-dd",  # JS-only (what the + Date chip inserts)
    "counterDigits": 3,         # %counter% zero-padding (001 = 3)
    "folded": False,            # JS-only (node body collapsed on the canvas)
    "hideBarWhenFolded": False, # JS-only (also hide the toolbar when folded)
}

# Extensions stripped off a wired `name` value so "cat.png" doesn't become
# "cat.png_00001.png". Only known media extensions - "model_v1.2" keeps its dot.
_MEDIA_EXT_RE = re.compile(
    r"\.(png|jpe?g|webp|gif|bmp|tiff?|avif|mp4|mov|webm|mkv|m4v)$", re.IGNORECASE
)

_PREVIEW_MAX = 16  # frames shown in the node preview (all files still save)

# ── token-served previews (files saved OUTSIDE ComfyUI's folders) ────────────
# /view can only serve input/output/temp, so the node preview fetches external
# files through /pixaroma/api/save_image/file?t=<token>. The registry maps
# opaque tokens to EXACT paths this session wrote - the client never sends a
# path, so there is no traversal surface. Bounded FIFO; dies with the process.
_SERVE_TOKENS = OrderedDict()
_SERVE_CAP = 256


def _register_serve_token(path):
    tok = uuid.uuid4().hex
    _SERVE_TOKENS[tok] = path
    while len(_SERVE_TOKENS) > _SERVE_CAP:
        _SERVE_TOKENS.popitem(last=False)
    return tok


def resolve_serve_token(tok):
    """Exact-token lookup used by the serving route. None for anything else."""
    return _SERVE_TOKENS.get(str(tok or ""))


def _expand_native_tokens(s):
    """Expand ComfyUI's native %year% %month% %day% %hour% %minute% %second%
    tokens. Native SaveImage gets these from folder_paths.get_save_image_path
    (compute_vars), which this node bypasses because it saves to arbitrary
    folders - so expand them here with the same zero-padded values (real user
    report: they worked in Preview Image Pixaroma but came out literal here)."""
    if not isinstance(s, str) or "%" not in s:
        return s
    now = time.localtime()
    for k, v in (
        ("%year%", f"{now.tm_year:04}"),
        ("%month%", f"{now.tm_mon:02}"),
        ("%day%", f"{now.tm_mday:02}"),
        ("%hour%", f"{now.tm_hour:02}"),
        ("%minute%", f"{now.tm_min:02}"),
        ("%second%", f"{now.tm_sec:02}"),
    ):
        s = s.replace(k, v)
    return s


def _tensor_to_pil(tensor):
    """Convert a HxWxC float [0,1] tensor frame to a PIL.Image.

    ComfyUI's IMAGE contract is 3 or 4 channels, but a misbehaving upstream
    node can emit 1/2/5+ channels - PIL's fromarray raises a raw TypeError on
    those, so normalize instead of crashing the save (1 -> grayscale, 2 ->
    grayscale+alpha, 5+ -> first three as RGB).
    """
    arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    if arr.ndim == 3:
        c = arr.shape[2]
        if c == 1:
            return Image.fromarray(arr[:, :, 0], "L")
        if c == 2:
            return Image.fromarray(arr, "LA")
        if c > 4:
            arr = arr[:, :, :3]
    return Image.fromarray(arr)


_EXIF_MAX = 64000  # JPEG APP1 segment tops out ~65 KB; Pillow raises
                   # "EXIF data is too long" past it (verified empirically)


def _build_jpeg_exif(prompt=None, workflow=None, parameters=None):
    """EXIF bytes embedding workflow + prompt, using the community convention
    ComfyUI already reads for WebP (0x010E ImageDescription = 'Workflow:<json>',
    0x010F Make = 'Prompt:<json>'). Best effort: the current ComfyUI frontend
    has NO jpeg workflow reader (verified in the bundle's
    getWorkflowDataFromFile), so drag-back restore works from PNG only - but
    other tools can read this, and a future frontend may add it.

    A big graph easily exceeds the ~65 KB JPEG EXIF segment limit and Pillow
    then raises AT SAVE TIME - so try workflow+prompt, fall back to workflow
    only, and skip embedding entirely when even that is too large (the JPG
    still saves; PNG is the reload format anyway).

    A1111-style `parameters` text goes in EXIF UserComment (0x9286, inside the
    Exif IFD 0x8769) with the standard 8-byte "UNICODE\\0" prefix + UTF-16-BE
    payload, which is what Civitai's reader expects and what piexif produces for
    encoding="unicode". It is preferred over the workflow, because it is normally
    small and it is the ONLY part Civitai can read - dropping it to make room for
    a giant workflow would defeat the point.

    But "normally small" is not always: UTF-16 costs 2 bytes per character, so a
    ~32000-character prompt alone busts the 64 KB limit. The ladder therefore ends
    with two attempts that DROP the user comment, so an enormous prompt costs only
    the Civitai part and still leaves the workflow EXIF that used to fit, rather
    than losing everything.
    """
    # PNG goes through _build_pnginfo, which gates itself; the JPG path builds
    # its own bytes, so it needs the same gate here or --disable-metadata would
    # hold for PNG and leak for JPG.
    if _metadata_disabled():
        return None

    def _user_comment(exif, include=True):
        if not include or not (isinstance(parameters, str) and parameters.strip()):
            return
        try:
            ifd = exif.get_ifd(0x8769)
            ifd[0x9286] = b"UNICODE\x00" + parameters.encode("utf-16-be")
        except Exception:
            pass

    have_params = isinstance(parameters, str) and bool(parameters.strip())
    try:
        # (workflow, prompt, include_user_comment), most complete first.
        attempts = (
            (workflow, prompt, True),
            (workflow, None, True),
            (None, None, True),
            # Last resorts with the user comment dropped, so a huge prompt does
            # not also cost the workflow EXIF that fitted before this feature.
            # Fullest first, same as above, or a fitting bigger payload would be
            # skipped in favour of the smaller one tried earlier.
            (workflow, prompt, False),
            (workflow, None, False),
        )
        for wf, pr, include in attempts:
            if wf is None and pr is None and not (include and have_params):
                continue
            exif = Image.Exif()
            if wf is not None:
                exif[0x010E] = "Workflow:" + json.dumps(_json_safe(wf))
            if pr is not None:
                exif[0x010F] = "Prompt:" + json.dumps(_json_safe(pr))
            _user_comment(exif, include)
            data = exif.tobytes()
            if len(data) <= _EXIF_MAX:
                return data
        return None
    except Exception:
        return None


class PixaromaSaveImage:
    DESCRIPTION = (
        "Save Image Pixaroma - save images to any folder on your computer, not just ComfyUI's output folder. "
        "Type or paste a path, or click Browse to pick a folder with the normal Windows dialog; leave the field "
        "empty to use the output folder. The filename field supports tokens and shows a live 'Will save as' "
        "preview of the exact file that will be written. Tokens: %input% (the wired name input, e.g. the filename "
        "from Load Image Pixaroma), %date:yyyy-MM-dd% (and any date/time format), %counter% (auto-incrementing, "
        "never overwrites), %width%, %height%, %batch_num%, plus node references like %Seed Pixaroma.seed%. "
        "Use / in the name to create subfolders. Format is PNG (lossless, embeds the workflow so the file can be "
        "dragged back into ComfyUI) or JPG (smaller, quality setting in the right-click panel; ComfyUI cannot "
        "reload workflows from JPG). Right-click the node for date style, counter digits, JPG quality, "
        "workflow embedding, and Civitai generation info. Batches save every frame with the counter "
        "increasing.\n\n"
        "Add Civitai generation info (right-click) also writes the settings in the format Civitai reads, "
        "so an image posted there shows the checkpoint, the LoRAs and their strengths, plus steps, seed, "
        "sampler and size. The values are read from your workflow automatically, so nothing needs wiring "
        "into this node. The first save after adding a new model pauses briefly to fingerprint it, then "
        "it is remembered.\n\n"
        "Saved images show in a large preview on the node: one image fills the area, a batch shows as a grid. "
        "Click a picture in the grid to view it big, click it or hover for the arrows to flip through, and the "
        "X returns to the grid. Copy puts the shown image on the clipboard, Open shows it in a new browser tab. "
        "Resize the node to make the preview bigger. The Mode toggle switches Save (files are written on every "
        "run) and Preview (images show on the node, nothing goes to your folder), so it can double as a preview "
        "node. Open Folder shows the save location in your file explorer; the window can appear on the taskbar."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "Image (or batch) to save. Every frame in a batch is written, with the counter increasing per file."}),
            },
            "optional": {
                "name": ("STRING", {"forceInput": True, "tooltip": "Optional text used by the %input% token in the filename, e.g. wire the filename output of Load Image Pixaroma here to keep the original name."}),
            },
            "hidden": {
                "SaveImageState": "STRING",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so every Run actually saves. Without this,
        # deleting the saved files and clicking Run again did NOTHING
        # (ComfyUI's input-hash cache skipped the node) - real user report
        # on day one. Same choice as Preview Image Pixaroma.
        return float("nan")

    def save(self, images, name=None, SaveImageState="", prompt=None, extra_pnginfo=None,
             unique_id=None):
        state = dict(DEFAULT_STATE)
        try:
            data = json.loads(SaveImageState) if SaveImageState else {}
            if isinstance(data, dict):
                state.update(data)
        except Exception:
            pass

        fmt = "jpg" if str(state.get("format", "png")).lower() in ("jpg", "jpeg") else "png"
        ext = ".jpg" if fmt == "jpg" else ".png"
        try:
            quality = max(1, min(100, int(state.get("quality", 100))))
        except Exception:
            quality = 100
        embed = bool(state.get("embedWorkflow", True))
        civitai_on = bool(state.get("civitaiMeta", False))
        save_on = bool(state.get("saveOnRun", True))
        try:
            digits = max(1, min(8, int(state.get("counterDigits", 3))))
        except Exception:
            digits = 3

        h = int(images.shape[1])
        w = int(images.shape[2])
        folder_raw = state.get("folder", "")
        # CONTAINMENT (2026-08-03, ComfyUI-Manager PR #3118).
        # `folder` arrives in the hidden SaveImageState blob and /prompt is
        # unauthenticated, so this string is attacker-controlled. It used to be
        # honoured verbatim for any absolute path: `inside_output` was computed
        # but only ever picked the UI payload shape, never gated the write. A
        # crafted prompt could therefore drop PNG/JPG files anywhere the ComfyUI
        # process can write. Saving to your own folders still works - see
        # _path_guard: anything you picked with the Browse button is approved,
        # and so are ComfyUI's own folders.
        # prescreen first (raw string, no filesystem touch) because
        # _resolve_save_folder calls realpath, which reaches out over SMB for a
        # UNC path before we would otherwise get a look at it.
        if not _pix_prescreen(folder_raw):
            raise ValueError(_pix_denied_message(str(folder_raw)))
        folder_abs, inside_output = _resolve_save_folder(folder_raw)
        if not _pix_folder_allowed(folder_abs):
            raise ValueError(_pix_denied_message(folder_abs))

        # Saving switched off: the node acts as a pure PREVIEW. Frames go to
        # ComfyUI's temp/ folder (auto-cleared on restart, /view-servable,
        # workflow embedded like native PreviewImage) - nothing is written to
        # the user's folder.
        if not save_on:
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo)
            entries = []
            for i, tensor in enumerate(images):
                if i >= _PREVIEW_MAX:
                    break
                pil = _tensor_to_pil(tensor)
                fname = f"pixaroma_save_preview_{uuid.uuid4().hex}.png"
                pil.save(os.path.join(temp_dir, fname), "PNG", pnginfo=pnginfo)
                entries.append({"filename": fname, "subfolder": "", "type": "temp"})
            if not entries:
                entries.append({"filename": ""})
            entries[0]["_pixaroma_status"] = {
                "saved": 0,
                "folder": folder_abs,
                "w": w,
                "h": h,
                "inside_output": inside_output,
                "note": "Preview mode - nothing was written to your folder",
            }
            return {"ui": {"pixaroma_save_frames": entries}}

        # ---- resolve the pattern (batch-level tokens) ----
        pattern = str(state.get("pattern") or DEFAULT_STATE["pattern"])
        input_name = ""
        if name is not None:
            input_name = name if isinstance(name, str) else str(name)
            input_name = _MEDIA_EXT_RE.sub("", input_name.strip())
            # separators would create surprise subfolders; folders belong to
            # the PATTERN (type / there), not to a wired name
            input_name = input_name.replace("\\", "_").replace("/", "_")
        resolved = pattern.replace("%input%", input_name)
        resolved = _expand_date_tokens(resolved)
        resolved = _expand_native_tokens(resolved)
        resolved = resolved.replace("%width%", str(w)).replace("%height%", str(h))
        note = None
        rel = _safe_prefix(resolved)
        if not rel:
            rel = "image_%counter%"
            note = "filename pattern was invalid, used 'image_%counter%'"

        # Civitai-readable generation settings, read from the graph (opt-in).
        # Built BEFORE the pnginfo so it can ride in the same chunk set. Wrapped
        # because metadata is a nice-to-have: nothing here may cost the user
        # their image.
        a1111 = None
        if civitai_on and not _metadata_disabled():
            try:
                from ._civitai_meta import build_metadata
                a1111 = build_metadata(prompt, extra_pnginfo, unique_id, w, h)
            except Exception as e:
                print("[Save Image Pixaroma] Civitai metadata skipped: %s" % e)

        pnginfo = None
        exif_bytes = None
        if fmt == "png" and (embed or a1111):
            pnginfo = _build_pnginfo(
                prompt=prompt if embed else None,
                extra_pnginfo=extra_pnginfo if embed else None,
                parameters=a1111,
            )
        elif fmt == "jpg" and (embed or a1111):
            wf = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
            exif_bytes = _build_jpeg_exif(
                prompt=prompt if embed else None,
                workflow=wf if embed else None,
                parameters=a1111,
            )

        out_real = os.path.realpath(folder_paths.get_output_directory())
        results = []
        counters = {}      # per target dir: next FILE %counter% to try
        dir_counters = {}  # per (parent, segment): resolved FOLDER %counter%
        saved = 0
        for i, tensor in enumerate(images):
            rel_frame = rel.replace("%batch_num%", str(i))
            parts = [p for p in rel_frame.split("/") if p]
            base_tpl = parts[-1] if parts else "image_%counter%"
            sub_dirs = parts[:-1]
            # %counter% in a FOLDER segment: resolve it ONCE per run (whole
            # batch shares the folder), scanning existing sibling dirs so
            # e.g. take_%counter%/frame makes take_00001, take_00002, ...
            # per run instead of a folder literally named take_%counter%.
            if sub_dirs and any("%counter%" in d for d in sub_dirs):
                resolved_dirs = []
                parent = folder_abs
                for d in sub_dirs:
                    if "%counter%" in d:
                        ck = (parent.lower(), d)
                        if ck not in dir_counters:
                            dir_counters[ck] = _next_counter(parent, d)
                        d = d.replace("%counter%", f"{dir_counters[ck]:0{digits}}")
                    resolved_dirs.append(d)
                    parent = os.path.join(parent, d)
                sub_dirs = resolved_dirs
            target_dir = os.path.join(folder_abs, *sub_dirs) if sub_dirs else folder_abs
            try:
                os.makedirs(target_dir, exist_ok=True)
            except Exception as e:
                raise RuntimeError(
                    f"Save Image Pixaroma: cannot create folder '{target_dir}': {e}"
                )

            has_counter = "%counter%" in base_tpl
            # key by dir + template so filename FAMILIES count independently
            # (e.g. img_%batch_num%_%counter% - each batch_num scans its own
            # existing files instead of inheriting another family's counter)
            key = (target_dir.lower(), base_tpl)
            if has_counter and key not in counters:
                counters[key] = _next_counter(target_dir, base_tpl + ext)

            # Claim the name with O_EXCL so files NEVER overwrite (bump on
            # collision; a pattern without %counter% auto-suffixes instead).
            counter = counters.get(key, 1)
            suffix = 0
            path = fname = None
            while True:
                if has_counter:
                    fname = base_tpl.replace("%counter%", f"{counter:0{digits}}") + ext
                elif suffix == 0:
                    fname = base_tpl + ext
                else:
                    fname = f"{base_tpl}_{suffix:0{digits}}{ext}"
                cand = os.path.join(target_dir, fname)
                try:
                    fd = os.open(cand, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                    os.close(fd)
                    path = cand
                    break
                except FileExistsError:
                    if has_counter:
                        counter += 1
                    else:
                        suffix += 1
                    if counter > 99999999 or suffix > 99999999:
                        raise RuntimeError(
                            "Save Image Pixaroma: could not find a free filename (counter overflow)"
                        )
                except OSError as e:
                    # read-only folder, AV lock, dead network share, ... -
                    # a clear message instead of a raw traceback
                    raise RuntimeError(
                        f"Save Image Pixaroma: cannot write in '{target_dir}': {e}"
                    )
            if has_counter:
                counters[key] = counter + 1

            pil = _tensor_to_pil(tensor)
            ok = False
            try:
                if fmt == "png":
                    # RGBA is preserved - PNG keeps transparency.
                    pil.save(path, "PNG", pnginfo=pnginfo, compress_level=4)
                else:
                    rgb = pil
                    if pil.mode == "RGBA":
                        # JPG has no alpha: premultiply over black (consistent
                        # with the rest of the suite).
                        arr = np.asarray(pil).astype(np.float32)
                        a = arr[..., 3:4] / 255.0
                        rgb = Image.fromarray(
                            (arr[..., :3] * a).clip(0, 255).astype(np.uint8)
                        )
                    elif pil.mode != "RGB":
                        rgb = pil.convert("RGB")
                    if exif_bytes:
                        try:
                            rgb.save(path, "JPEG", quality=quality, exif=exif_bytes)
                        except ValueError:
                            # EXIF rejected by this Pillow build (size limit
                            # differences) - the image matters more, save plain
                            rgb.save(path, "JPEG", quality=quality)
                    else:
                        rgb.save(path, "JPEG", quality=quality)
                ok = True
            finally:
                if not ok:
                    # remove the claimed 0-byte file so failures leave no junk
                    try:
                        os.remove(path)
                    except OSError:
                        pass
            saved += 1

            entry = {"filename": fname}
            if inside_output:
                # all entries kept - native SaveImage parity for the Assets
                # panel; the frontend caps the DISPLAY at 16 itself
                sub = os.path.relpath(target_dir, out_real)
                entry["subfolder"] = "" if sub == "." else sub.replace("\\", "/")
                entry["type"] = "output"
            else:
                # external entries beyond the preview cap carry no token, so
                # they are dead weight in the payload - skip them (the status
                # dict carries the true saved count)
                if len(results) >= _PREVIEW_MAX:
                    continue
                entry["path"] = path
                # full-quality preview via the token route (/view can't
                # serve external paths)
                entry["token"] = _register_serve_token(path)
            results.append(entry)

        status = {
            "saved": saved,
            "folder": folder_abs,
            "w": w,
            "h": h,
            "inside_output": inside_output,
        }
        if note:
            status["note"] = note
        if results:
            results[0]["_pixaroma_status"] = status

        # Inside output/: emit the standard ui.images key so the Media Assets
        # panel refreshes (Preview Pattern #14); the JS previews via /view.
        # Outside: our custom key with token-served entries (/view can't serve
        # those paths). ONE key either way so the Assets stack badge stays
        # correct (Preview Pattern #16).
        ui_key = "images" if inside_output else "pixaroma_save_frames"
        return {"ui": {ui_key: results}}


NODE_CLASS_MAPPINGS = {"PixaromaSaveImage": PixaromaSaveImage}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSaveImage": "Save Image Pixaroma"}
