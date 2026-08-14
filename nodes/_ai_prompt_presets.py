"""AI Prompt Pixaroma - presets: a formula PLUS the settings that make it work.

A formula on its own is half a recipe. The Krea 2 formula was measured writing
gibberish at temperature 0.7 and doing the job cleanly at 0.3 on the same model
and the same words, so shipping the text without the number would have shipped
a formula that looks broken. A preset carries both.

WHERE THINGS LIVE, and why it is ONE file each rather than one file per preset:

    shipped   <plugin>/assets/ai_prompt_presets.json
    yours     <ComfyUI user dir>/pixaroma/ai_prompt_presets.json

A preset NAME is user text, and a name that becomes a FILENAME is the single
most common way a save feature turns into a path traversal (path-containment.md
#1: an absolute right-hand side silently discards the base). Keeping every user
preset inside one known JSON file means no path is ever built from user input at
all - there is nothing to contain, rather than something contained carefully.

Yours live outside the plugin folder for the same reason the Civitai key does:
the plugin folder is a git working tree, and a Manager reinstall would wipe it.

Nothing here is read at RUN time. Loading a preset copies its values onto the
node, so Python only ever sees the node's own state - which is why a preset can
never affect a render, only what the browser puts on the node.
"""
import json
import os

MAX_NAME = 80
MAX_FORMULA = 200_000
MAX_NOTE = 400
MAX_PRESETS = 200

# Exactly the settings a preset may carry. The idea, the seed, the join order
# and the separator are deliberately NOT here: those belong to the workflow and
# the wiring, not to the recipe. release_model is a per-workflow memory choice.
SETTING_KEYS = (
    "temperature", "max_length", "top_k", "top_p", "min_p",
    "repetition_penalty", "presence_penalty", "do_sample", "thinking",
    "use_default_template",
)

_ASSET = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "assets", "ai_prompt_presets.json")


def user_store_path():
    """<ComfyUI user dir>/pixaroma/ai_prompt_presets.json, or None if unknown."""
    try:
        import folder_paths
        base = folder_paths.get_user_directory()
    except Exception:
        return None
    if not base:
        return None
    return os.path.join(base, "pixaroma", "ai_prompt_presets.json")


def _clean_text(value, cap):
    if not isinstance(value, str):
        return ""
    return value[:cap]


def normalise(raw):
    """One preset dict with every field present and bounded, or None if unusable.

    A preset with no name or no formula is dropped rather than repaired: a
    nameless entry cannot be picked and a formula-less one does nothing.
    """
    if not isinstance(raw, dict):
        return None
    name = _clean_text(raw.get("name"), MAX_NAME).strip()
    formula = _clean_text(raw.get("formula"), MAX_FORMULA)
    if not name or not formula.strip():
        return None
    settings = {}
    src = raw.get("settings")
    if isinstance(src, dict):
        for key in SETTING_KEYS:
            if key in src:
                settings[key] = src[key]
    return {
        "name": name,
        "note": _clean_text(raw.get("note"), MAX_NOTE).strip(),
        "model_hint": _clean_text(raw.get("model_hint"), 200).strip(),
        "formula": formula,
        "settings": settings,
    }


def _read(path):
    if not path or not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        # A corrupt or hand-edited file must not take the picker down with it.
        return []
    items = data.get("presets") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    out = []
    for item in items[:MAX_PRESETS]:
        one = normalise(item)
        if one:
            out.append(one)
    return out


def load_shipped():
    return _read(_ASSET)


def load_user():
    return _read(user_store_path())


def _write_user(items):
    path = user_store_path()
    if not path:
        return False
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "presets": items}, fh,
                      indent=2, ensure_ascii=False)
        os.replace(tmp, path)          # atomic, so a crash cannot truncate it
        return True
    except Exception:
        return False


def save_user(raw):
    """Add or replace one of the user's own presets. Returns (ok, message)."""
    one = normalise(raw)
    if not one:
        return False, "A preset needs a name and a formula."
    items = load_user()
    # Replace by name, case-insensitively, so saving twice under the same name
    # updates rather than quietly making a second entry that looks identical.
    lowered = one["name"].lower()
    items = [p for p in items if p["name"].lower() != lowered]
    if len(items) >= MAX_PRESETS:
        return False, "That is as many presets as this can hold."
    items.append(one)
    items.sort(key=lambda p: p["name"].lower())
    if not _write_user(items):
        return False, "Could not write the presets file."
    return True, "Saved."


def delete_user(name):
    """Remove one of the user's own presets. Shipped ones cannot be deleted."""
    if not isinstance(name, str) or not name.strip():
        return False, "No name given."
    lowered = name.strip().lower()
    items = load_user()
    kept = [p for p in items if p["name"].lower() != lowered]
    if len(kept) == len(items):
        return False, "There is no preset saved under that name."
    if not _write_user(kept):
        return False, "Could not write the presets file."
    return True, "Deleted."
