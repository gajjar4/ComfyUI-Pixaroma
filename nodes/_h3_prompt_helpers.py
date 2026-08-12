# nodes/_h3_prompt_helpers.py
"""Pure helpers for Minimax H3 Prompt Pixaroma.

NO torch, NO ComfyUI imports at module scope, so the whole assembly can be
unit-tested with a bare python (harness: D:\\Claude Tests\\_h3_prompt_test.py).
Anything that needs a tensor lives in node_h3_prompt.py instead.

WHAT THIS REPLACES
------------------
Three workflows, each about ten nodes, that differed only in which formula text
went into a Text Join Three. The formulas themselves were extracted verbatim
from those workflows on 2026-08-12, so a prompt built here is byte-identical to
one the tested workflows produced. The two things that make that true and are
easy to break:

  * the join is a SINGLE newline with empty parts skipped (the Text Join Three
    was configured `{"sep":"newline","skipEmpty":true}`), and
  * each formula already ENDS with "IDEA:\\n", so the join adds the blank line
    that the tested prompts had between that label and the idea.

Change either and every formula in the pack is being fed a shape it was never
measured against.
"""
from __future__ import annotations

import json
import os
import re

# ---------------------------------------------------------------------------
# Modes. A FIXED tuple, deliberately: the mode is the only thing that reaches a
# filename here, and validating it against this tuple means no request can ever
# name a file we did not ship. That is cheaper and stronger than sanitising a
# free string (.claude/patterns/path-containment.md).
# ---------------------------------------------------------------------------
TEXT_TO_VIDEO = "text_to_video"
FIRST_FRAME = "first_frame"
FIRST_LAST = "first_last"
MODES = (TEXT_TO_VIDEO, FIRST_FRAME, FIRST_LAST)

MODE_LABELS = {
    TEXT_TO_VIDEO: "Text to video",
    FIRST_FRAME: "First frame",
    FIRST_LAST: "First and last frame",
}

_PACK_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SHIPPED_DIR = os.path.join(_PACK_DIR, "assets", "h3_formulas")

_DEFAULT_MODEL = "qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors"

# Mirrors the TextGenerate widget values in the three tested workflows. Changing
# any of these changes every prompt the pack produces, so they are named here
# rather than scattered as literals.
DEFAULT_SAMPLING = {
    "model": _DEFAULT_MODEL,
    "clip_type": "minimax",
    "temperature": 0.3,
    "max_length": 512,
    "top_k": 64,
    "top_p": 0.95,
    "min_p": 0.05,
    "repetition_penalty": 1.05,
    "presence_penalty": 0.0,
    "thinking": False,
    "use_default_template": True,
}

# MiniMax H3's frame shape: 24 fps, snap up to 17n + 5, which is where the
# familiar 5 s -> 124 frames comes from. Carried here so the node can hand out a
# FRAME COUNT as well as a length, and the video can no longer be rendered at a
# different duration than the prompt was written for - the exact mismatch that
# spoiled the first real clip (project_h3_first_real_clips).
DEFAULT_VIDEO = {
    "fps": 24.0,
    "step": 17,
    "plus": 5,
    "min_frames": 0,
}


def valid_mode(mode) -> bool:
    return isinstance(mode, str) and mode in MODES


def mode_for(has_first: bool, has_last: bool) -> str:
    """Which formula to run, derived purely from which images arrived.

    Nothing here is stored on the node, which is the whole point: a mode that is
    computed can never go stale on a workflow load, and a connection handler
    that writes no serialized state needs none of the configure-replay gating
    that has bitten the Switch family twice (Vue Compat #17 / #19).

    A last frame with NO first frame is treated as first-frame-only rather than
    refused: the picture is still a real anchor, and refusing would mean a wire
    that silently does nothing.
    """
    if has_first and has_last:
        return FIRST_LAST
    if has_first or has_last:
        return FIRST_FRAME
    return TEXT_TO_VIDEO


# ---------------------------------------------------------------------------
# Where the editable copies live
# ---------------------------------------------------------------------------
def user_dir() -> str:
    """<ComfyUI user dir>/pixaroma/h3_formulas.

    NOT inside the plugin folder. The plugin is a git working tree, so an edited
    formula there is one `git add -A` from being published, and a Manager
    reinstall would wipe it. Same reasoning as the Civitai key sidecar and the
    path guard's own allowlist.

    No makedirs here - this is called on every read. Creating it is the writer's
    job (_path_guard._config_path does the same and for the same reason).
    """
    base = None
    try:
        import folder_paths

        base = folder_paths.get_user_directory()
    except Exception:
        base = None
    if not base:
        base = os.path.join(os.path.expanduser("~"), ".pixaroma")
    return os.path.join(base, "pixaroma", "h3_formulas")


def _shipped(mode: str, suffix: str) -> str:
    return os.path.join(_SHIPPED_DIR, mode + suffix)


def _override(mode: str, suffix: str) -> str:
    return os.path.join(user_dir(), mode + suffix)


def _read_text(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None


def _write_text(path: str, text: str) -> bool:
    """Atomic write. A half-written formula is worse than an old one: the node
    would still run and would quietly produce a truncated prompt."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
        return True
    except Exception:
        return False


def load_formula(mode: str) -> str:
    """The user's edited formula if there is one, else the shipped default."""
    if not valid_mode(mode):
        return ""
    text = _read_text(_override(mode, ".txt"))
    if text is None:
        text = _read_text(_shipped(mode, ".txt"))
    return text or ""


def shipped_formula(mode: str) -> str:
    if not valid_mode(mode):
        return ""
    return _read_text(_shipped(mode, ".txt")) or ""


def is_edited(mode: str) -> bool:
    """True when a user override exists, so the panel can mark the row."""
    if not valid_mode(mode):
        return False
    return os.path.exists(_override(mode, ".txt")) or os.path.exists(
        _override(mode, ".durations.json")
    )


def save_formula(mode: str, text: str) -> bool:
    if not valid_mode(mode) or not isinstance(text, str):
        return False
    return _write_text(_override(mode, ".txt"), text)


def reset_formula(mode: str) -> bool:
    """Delete the override so the shipped formula is used again."""
    if not valid_mode(mode):
        return False
    ok = True
    for suffix in (".txt", ".durations.json"):
        p = _override(mode, suffix)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                ok = False
    return ok


def _coerce_tiers(obj):
    """Keep only well-formed {name, value} entries.

    A damaged override must degrade to the shipped list, never raise in the
    middle of a render and never hand the model a half-list.
    """
    if not isinstance(obj, list):
        return None
    out = []
    for item in obj:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        value = item.get("value")
        if isinstance(name, str) and isinstance(value, str) and name.strip():
            out.append({"name": name, "value": value})
    return out or None


def load_durations(mode: str) -> list:
    if not valid_mode(mode):
        return []
    raw = _read_text(_override(mode, ".durations.json"))
    if raw is not None:
        try:
            tiers = _coerce_tiers(json.loads(raw))
            if tiers:
                return tiers
        except Exception:
            pass
    raw = _read_text(_shipped(mode, ".durations.json"))
    try:
        return _coerce_tiers(json.loads(raw)) or []
    except Exception:
        return []


def save_durations(mode: str, tiers) -> bool:
    if not valid_mode(mode):
        return False
    clean = _coerce_tiers(tiers)
    if clean is None:
        return False
    return _write_text(
        _override(mode, ".durations.json"),
        json.dumps(clean, ensure_ascii=False, indent=2),
    )


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
_SECONDS_RE = re.compile(r"(\d+(?:\.\d+)?)")


def seconds_from_tier(name) -> float:
    """'8 seconds' -> 8.0. Returns 0.0 when there is no number to find, so a
    hand-renamed tier degrades to 'unknown' rather than to a wrong number."""
    if not isinstance(name, str):
        return 0.0
    m = _SECONDS_RE.search(name)
    if not m:
        return 0.0
    try:
        return float(m.group(1))
    except (TypeError, ValueError):
        return 0.0


def pick_tier(tiers, index, name=None):
    """Resolve the chosen tier, preferring the NAME over the index.

    The name survives a reordered or edited tier list; the index does not. A
    saved workflow that picked '8 seconds' should still get 8 seconds after the
    user inserts a 6-second tier above it.
    """
    tiers = tiers or []
    if not tiers:
        return None
    if isinstance(name, str) and name:
        for t in tiers:
            if t.get("name") == name:
                return t
    try:
        i = int(index)
    except (TypeError, ValueError):
        i = 0
    if 0 <= i < len(tiers):
        return tiers[i]
    return tiers[0]


def join_parts(parts, sep="\n") -> str:
    """The Text Join Three contract: skipEmpty, single separator.

    Whitespace-only parts count as empty, matching the node it replaces.
    """
    kept = [p for p in parts if isinstance(p, str) and p.strip()]
    return sep.join(kept)


def build_prompt(formula: str, idea: str, length_block: str) -> str:
    """Formula + idea + length, in that order. See the module docstring for why
    the order and the separator are not free choices."""
    return join_parts([formula, idea, length_block], "\n")


def word_count(text) -> int:
    if not isinstance(text, str):
        return 0
    return len(text.split())


def parse_state(raw):
    """Defensive read of the hidden state blob.

    request.json() and a widget value can both be ANY type, so this never
    assumes a dict (reference_request_json_returns_any_type).
    """
    if isinstance(raw, dict):
        obj = raw
    else:
        try:
            obj = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
        except Exception:
            obj = {}
    if not isinstance(obj, dict):
        obj = {}
    out = dict(DEFAULT_SAMPLING)
    out.update(DEFAULT_VIDEO)
    out.update(
        {
            "idea": "",
            "tier_index": 0,
            "tier_name": "",
            "seed": 0,
            "release_model": False,
        }
    )
    # Only keys we already know about: an unknown key in a hand-edited blob must
    # not become a kwarg further down.
    for k, v in obj.items():
        if k in out:
            out[k] = v
    # Types the caller relies on. A string seed from a hand-edited blob would
    # reach torch and raise deep inside generation instead of here.
    out["idea"] = out["idea"] if isinstance(out["idea"], str) else ""
    out["tier_name"] = out["tier_name"] if isinstance(out["tier_name"], str) else ""
    for key, cast, default in (
        ("tier_index", int, 0),
        ("seed", int, 0),
        ("max_length", int, 512),
        ("top_k", int, 64),
        ("temperature", float, 0.3),
        ("top_p", float, 0.95),
        ("min_p", float, 0.05),
        ("repetition_penalty", float, 1.05),
        ("presence_penalty", float, 0.0),
        ("fps", float, 24.0),
        ("step", int, 17),
        ("plus", int, 5),
        ("min_frames", int, 0),
    ):
        try:
            out[key] = cast(out[key])
        except (TypeError, ValueError):
            out[key] = default
    out["thinking"] = out["thinking"] is True
    out["use_default_template"] = out["use_default_template"] is not False
    out["release_model"] = out["release_model"] is True
    if not isinstance(out["model"], str) or not out["model"].strip():
        out["model"] = _DEFAULT_MODEL
    if not isinstance(out["clip_type"], str) or not out["clip_type"].strip():
        out["clip_type"] = "minimax"
    # Clamps. max_length is the one that matters: the abliterated models do not
    # emit a stop token reliably, so an absurd value here is a multi-minute run.
    out["max_length"] = max(1, min(32768, out["max_length"]))
    out["seed"] = max(0, min(0xFFFFFFFFFFFFFFFF, out["seed"]))
    return out


def assemble(state, mode: str):
    """The whole text side of a run, in one testable call.

    Returns (prompt, seconds, tier_name). Kept separate from the node so the
    harness can diff a generated prompt against the tested workflows without
    ComfyUI, torch or a model on disk.
    """
    st = parse_state(state)
    tiers = load_durations(mode)
    tier = pick_tier(tiers, st["tier_index"], st["tier_name"])
    length_block = tier.get("value", "") if tier else ""
    tier_name = tier.get("name", "") if tier else ""
    prompt = build_prompt(load_formula(mode), st["idea"], length_block)
    return prompt, seconds_from_tier(tier_name), tier_name
