"""Pixaroma Workflows - reading the workflow folder.

Pure helpers, no ComfyUI imports, so they can be tested on their own
(harness: D:\\Claude Tests\\_workflow_index_test.py).

Everything the browser shows beyond a filename comes from here: what a workflow
contains, a tiny map of its graph for the cover, which files look like junk or
duplicates, and the collections that fill themselves.

Reading 144 files is done ONCE and cached against each file's modified-time and
size, so a second open re-parses only what actually changed. The browser never
fetches the files itself.
"""

import hashlib
import json
import os
import re

# Files bigger than this are almost certainly not a hand-made workflow, and
# parsing one blocks the request. 24 MB is far above the largest real workflow
# seen in the wild (the biggest in the author's own folder is 75 KB).
_MAX_BYTES = 24 * 1024 * 1024

# How many node rectangles the cover map carries. A cover is ~120x64 CSS pixels,
# so past a few dozen boxes nothing more is legible and the payload just grows.
_MAP_CAP = 60

# Total prompt text kept per workflow, for searching. Enough to find a phrase
# somebody remembers; small enough that 144 of them stay a light payload.
_TEXT_CAP = 2000

# Bumped whenever an entry's SHAPE changes, so a cache written by an older
# version is thrown away instead of being replayed into code that no longer
# understands it (v2: the cover map carries a colour string, not a palette index).
_CACHE_VERSION = 2

_MODEL_EXT = (".safetensors", ".ckpt", ".gguf", ".pt", ".pth", ".sft", ".bin")

# Widget strings on these classes are treated as prompt text worth searching.
_TEXTY = ("cliptextencode", "text", "prompt", "string")

# ── collection rules ─────────────────────────────────────────────────────────
# One table, so a new grouping is a data change rather than a code change. Each
# kind is (id, label, predicate over the entry). Order matters: the first
# matching "output kind" wins, so a video workflow is not also filed as
# text-to-image just because it has a sampler in it.

def _has(entry, *needles):
    """True when any node class in this workflow contains one of the needles."""
    low = entry.get("_lower_types") or []
    return any(any(n in t for t in low) for n in needles)


def _kind_video(e):
    return _has(e, "savemp4", "vhs_", "savewebm", "videocombine", "imagetovideo",
                "svd_", "animatediff", "wanimage", "saveanimated")


def _kind_upscale(e):
    return _has(e, "upscalemodel", "imagescale", "upscale")


def _kind_inpaint(e):
    return _has(e, "inpaint", "setlatentnoisemask", "outpaint")


def _kind_img2img(e):
    return _has(e, "vaeencode", "loadimage") and _has(e, "sampler")


def _kind_txt2img(e):
    return _has(e, "sampler") and _has(e, "cliptextencode", "textencode")


# Checked in this order; a workflow lands in the FIRST one that matches, so the
# most specific description of what it makes wins.
_KINDS = [
    ("video", "Video", _kind_video),
    ("inpaint", "Inpaint / Outpaint", _kind_inpaint),
    ("upscale", "Upscale", _kind_upscale),
    ("img2img", "Image to Image", _kind_img2img),
    ("txt2img", "Text to Image", _kind_txt2img),
]

# Model families, matched against the model filenames found in the workflow.
_FAMILIES = [
    ("flux", "Flux", ("flux",)),
    ("qwen", "Qwen", ("qwen",)),
    ("wan", "Wan", ("wan",)),
    ("sdxl", "SDXL", ("sdxl", "sd_xl")),
    ("sd15", "SD 1.5", ("sd15", "v1-5", "sd_v1")),
    ("sd3", "SD 3", ("sd3", "sd_3")),
    ("hunyuan", "Hunyuan", ("hunyuan",)),
    ("krea", "Krea", ("krea",)),
    ("chroma", "Chroma", ("chroma",)),
]


# ── small utilities ──────────────────────────────────────────────────────────

def _is_under(child, parent):
    """True when child sits inside parent. Compares both the collapsed path and
    the resolved one, so a workflows folder reached through a junction (a common
    split-across-drives setup) is still accepted, while '..' cannot escape."""
    try:
        c_abs, p_abs = os.path.abspath(child), os.path.abspath(parent)
        if os.path.commonpath([c_abs, p_abs]) == p_abs:
            return True
    except ValueError:
        pass
    try:
        c_real, p_real = os.path.realpath(child), os.path.realpath(parent)
        return os.path.commonpath([c_real, p_real]) == p_real
    except ValueError:
        return False


def _rel(path, root):
    return os.path.relpath(path, root).replace(os.sep, "/")


def _num(v, default=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    # A workflow written by a broken exporter can carry inf/nan, which would
    # serialise to invalid JSON and break the whole response.
    if f != f or f in (float("inf"), float("-inf")):
        return default
    return f


def _xy(v):
    """Node pos/size is a 2-list in modern files and a {"0":x,"1":y} dict in
    some older ones. Accept both rather than dropping the node from the map."""
    if isinstance(v, dict):
        return _num(v.get("0") if "0" in v else v.get(0)), _num(v.get("1") if "1" in v else v.get(1))
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return _num(v[0]), _num(v[1])
    return 0.0, 0.0


_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _node_color(color):
    """The node's OWN colour, as a plain hex string, or "" when it has none.

    This used to be a hash of the colour into a fixed 8-swatch palette, which
    meant a green node could be drawn brown - the cover looked arbitrary
    because it WAS arbitrary. The real colour is carried instead, and the
    browser lifts it to a readable brightness (ComfyUI node colours are
    near-black, being title tints on a dark canvas, so drawing them literally
    gives an unreadable cover).

    Anything that is not a plain hex value - `rgba(0,0,0,0)`, a css name, junk
    from a hand-edited file - becomes "" rather than being passed through, so
    the drawing code only ever has one shape to deal with.
    """
    if not isinstance(color, str):
        return ""
    c = color.strip()
    return c.lower() if _HEX_RE.match(c) else ""


def _clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _walk_strings(widgets):
    """Widget values can nest (lists, dicts) depending on the node. Yield every
    string found, so a model filename is not missed because of its shape."""
    stack = [widgets]
    seen = 0
    while stack and seen < 400:
        cur = stack.pop()
        seen += 1
        if isinstance(cur, str):
            yield cur
        elif isinstance(cur, dict):
            stack.extend(cur.values())
        elif isinstance(cur, (list, tuple)):
            stack.extend(cur)


# ── one workflow ─────────────────────────────────────────────────────────────

def summarize_workflow(path, root):
    """Everything the browser needs about one workflow file.

    Never raises. A file that is missing, too big, outside the root, or not
    valid JSON comes back with an "error" set and empty everything else, so one
    bad file cannot take out the whole listing.
    """
    name = os.path.splitext(os.path.basename(path))[0]
    blank = {
        "name": name, "rel": _rel(path, root) if root else os.path.basename(path),
        "folder": "", "size": 0, "modified": 0.0, "node_count": 0,
        "class_types": [], "models": [], "loras": [], "text": "",
        "map": [], "fingerprint": "", "error": None,
    }

    if root and not _is_under(path, root):
        blank["error"] = "outside the workflows folder"
        return blank

    try:
        st = os.stat(path)
    except OSError as e:
        blank["error"] = "cannot read: %s" % e.__class__.__name__
        return blank

    blank["size"] = st.st_size
    blank["modified"] = st.st_mtime
    rel = _rel(path, root)
    blank["rel"] = rel
    blank["folder"] = os.path.dirname(rel)

    if st.st_size > _MAX_BYTES:
        blank["error"] = "file is too large to read"
        return blank

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError, UnicodeDecodeError) as e:
        blank["error"] = "not a readable workflow: %s" % e.__class__.__name__
        return blank

    if not isinstance(data, dict):
        blank["error"] = "not a workflow file"
        return blank

    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        blank["error"] = "no nodes in this file"
        return blank

    types, lower, models, loras, texts, boxes = [], [], [], [], [], []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        t = n.get("type")
        if isinstance(t, str) and t:
            types.append(t)
            lower.append(t.lower())
        tl = (t or "").lower()

        widgets = n.get("widgets_values")
        if widgets is not None:
            is_lora = "lora" in tl
            texty = any(k in tl for k in _TEXTY)
            for s in _walk_strings(widgets):
                low = s.lower()
                if low.endswith(_MODEL_EXT):
                    (loras if is_lora else models).append(s)
                elif texty and len(s) > 8:
                    texts.append(s)

        x, y = _xy(n.get("pos"))
        w, h = _xy(n.get("size"))
        boxes.append((x, y, w if w > 0 else 200.0, h if h > 0 else 80.0,
                      _node_color(n.get("color"))))

    # ── the cover map: node rectangles normalised into a 0..1 box ──
    cover = []
    if boxes:
        keep = boxes[:_MAP_CAP]
        min_x = min(b[0] for b in keep)
        min_y = min(b[1] for b in keep)
        max_x = max(b[0] + b[2] for b in keep)
        max_y = max(b[1] + b[3] for b in keep)
        span_x = max_x - min_x
        span_y = max_y - min_y
        # A single node, or every node stacked at one point, gives a zero span.
        if span_x <= 0:
            span_x = 1.0
        if span_y <= 0:
            span_y = 1.0
        for (x, y, w, h, col) in keep:
            cover.append([
                round(_clamp01((x - min_x) / span_x), 4),
                round(_clamp01((y - min_y) / span_y), 4),
                round(_clamp01(w / span_x), 4),
                round(_clamp01(h / span_y), 4),
                col,
            ])

    uniq_types = sorted(set(types))
    uniq_models = sorted(set(models))
    uniq_loras = sorted(set(loras))

    # Same shape of graph + same models = the same workflow wearing two names.
    # Deliberately ignores prompt text and node positions, which is what makes
    # it useful for spotting the copies people accumulate.
    fp_src = "|".join(sorted(types)) + "||" + "|".join(uniq_models) + "||" + "|".join(uniq_loras)
    fingerprint = hashlib.md5(fp_src.encode("utf-8")).hexdigest() if types else ""

    text = " ".join(texts)
    if len(text) > _TEXT_CAP:
        text = text[:_TEXT_CAP]

    blank.update({
        "node_count": len(nodes),
        "class_types": uniq_types,
        "models": uniq_models,
        "loras": uniq_loras,
        "text": text,
        "map": cover,
        "fingerprint": fingerprint,
    })
    return blank


# ── the whole folder ─────────────────────────────────────────────────────────

def _cache_key(st):
    return [st.st_mtime_ns, st.st_size]


def _load_cache(cache_path):
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            c = json.load(f)
        if isinstance(c, dict) and c.get("version") == _CACHE_VERSION and isinstance(c.get("entries"), dict):
            return c["entries"]
    except (OSError, ValueError, UnicodeDecodeError):
        pass
    return {}


def _save_cache(cache_path, entries):
    """Written to a temp file and moved into place, so a crash or a full disk
    part-way through leaves the previous cache intact rather than a broken one
    that then has to be detected and thrown away on every future open."""
    tmp = cache_path + ".tmp"
    try:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": _CACHE_VERSION, "entries": entries}, f)
        os.replace(tmp, cache_path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass


def build_index(root, cache_path):
    """Summarise every .json under root, re-reading only files whose modified
    time or size changed since last time. Returns a list of entries."""
    old = _load_cache(cache_path)
    new_entries = {}
    out = []

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip anything hidden, and ComfyUI's own bookkeeping.
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if not fn.lower().endswith(".json") or fn.startswith("."):
                continue
            full = os.path.join(dirpath, fn)
            rel = _rel(full, root)
            try:
                key = _cache_key(os.stat(full))
            except OSError:
                continue
            hit = old.get(rel)
            if hit and hit.get("key") == key and isinstance(hit.get("data"), dict):
                data = hit["data"]
            else:
                data = summarize_workflow(full, root)
            new_entries[rel] = {"key": key, "data": data}
            out.append(data)

    _save_cache(cache_path, new_entries)
    out.sort(key=lambda e: (e.get("folder", ""), e.get("name", "").lower()))
    return out


# ── what is wrong with this folder ───────────────────────────────────────────

# Node types the FRONTEND registers, which therefore never appear in Python's
# NODE_CLASS_MAPPINGS. Without this, every workflow containing a sticky note
# looks broken - it flagged 108 of one user's 143 workflows on the first run.
#
# This list only covers ComfyUI's own; a custom pack can register frontend-only
# nodes too (rgthree does), which is why the BROWSER recomputes this against
# LiteGraph.registered_node_types and overrides whatever comes from here. Treat
# the value below as a fallback, not the answer.
_FRONTEND_ONLY = frozenset({
    "Note", "MarkdownNote", "PrimitiveNode", "Reroute", "GroupNode",
})


def detect_issues(index, registered_types):
    """The three things worth telling someone about their workflow folder."""
    unsaved, missing = [], []
    by_fp = {}

    for e in index:
        if e.get("error"):
            continue
        if e.get("name", "").lower().startswith("unsaved workflow"):
            unsaved.append({"rel": e["rel"], "name": e["name"]})

        gone = sorted(t for t in e.get("class_types", [])
                      if t not in registered_types and t not in _FRONTEND_ONLY)
        if gone:
            missing.append({"rel": e["rel"], "name": e["name"], "missing": gone})

        fp = e.get("fingerprint")
        if fp:
            by_fp.setdefault(fp, []).append(e)

    duplicates = [g for g in by_fp.values() if len(g) > 1]
    duplicates.sort(key=lambda g: -len(g))
    return {"unsaved_names": unsaved, "duplicates": duplicates, "missing_nodes": missing}


# ── collections that fill themselves ─────────────────────────────────────────

def collections(index):
    """Group workflows by what they make and which model they use, read out of
    the files themselves. Real folders are untouched; these sit alongside."""
    kinds = {}
    families = {}
    lora_items = []

    for e in index:
        if e.get("error"):
            continue
        e["_lower_types"] = [t.lower() for t in e.get("class_types", [])]
        try:
            for kid, label, pred in _KINDS:
                if pred(e):
                    kinds.setdefault(kid, {"label": label, "items": []})["items"].append(e["rel"])
                    break

            if e.get("loras"):
                lora_items.append(e["rel"])

            hit = set()
            for m in e.get("models", []) + e.get("loras", []):
                low = m.lower()
                for fid, label, needles in _FAMILIES:
                    if fid not in hit and any(n in low for n in needles):
                        hit.add(fid)
                        families.setdefault(fid, {"label": label, "items": []})["items"].append(e["rel"])
        finally:
            del e["_lower_types"]

    out = []
    for kid, label, _ in _KINDS:
        if kid in kinds:
            out.append({"id": kid, "group": "kind", "label": label,
                        "items": kinds[kid]["items"], "count": len(kinds[kid]["items"])})
    if lora_items:
        out.append({"id": "lora", "group": "kind", "label": "Uses a LoRA",
                    "items": lora_items, "count": len(lora_items)})
    for fid, label, _ in _FAMILIES:
        if fid in families:
            out.append({"id": fid, "group": "model", "label": label,
                        "items": families[fid]["items"], "count": len(families[fid]["items"])})
    return out
