"""Pure helpers for Dropdown Pixaroma.

Kept separate from node_dropdown.py so they can be unit-tested without a
ComfyUI import. Everything here is pure: no I/O, no globals, no ComfyUI.

THE PARITY RULE: js/dropdown/coerce.mjs mirrors `readable` and the coercion
rules below so the settings panel can mark a row that will not read as the
chosen type. If you change a rule here, change it there in the SAME commit,
or the panel will promise one thing and the run will do another. The rules are
deliberately simple so that mirroring stays trivial.
"""

import json
import math

# The four types a Dropdown node can be set to. The JS uses these exact
# strings in its state blob, so they are a wire format - do not rename.
TYPES = ("text", "int", "float", "bool")

# What an option emits when its value cannot be read as the chosen type.
# A run must never fail because one row of a list is malformed: the node is a
# convenience, and taking down a whole queue over a typo would be absurd.
FALLBACKS = {"text": "", "int": 0, "float": 0.0, "bool": False}

# Accepted spellings for the on/off type, lowercased and stripped.
_TRUE_WORDS = frozenset(("true", "yes", "on", "y", "t"))
_FALSE_WORDS = frozenset(("false", "no", "off", "n", "f"))

# Same clamp Control Panel applies (`_value_of` in node_sliders.py). A
# hand-edited API file can carry 1e308 or a 400-digit integer, and passing that
# straight into a downstream node is how you get an unhelpful crash somewhere
# far away from the cause.
_LIMIT = 1e12


def normalize_type(kind):
    """Anything -> one of TYPES. Unknown values become 'text'.

    'text' is the safe unknown, not 'int': an unrecognised type is most likely
    a newer version's type we do not know yet, and emitting the raw string
    loses less than emitting 0.
    """
    if not isinstance(kind, str):
        return "text"
    k = kind.strip().lower()
    if k in TYPES:
        return k
    # Tolerate a few obvious aliases so a hand-edited workflow still runs.
    if k in ("string", "str"):
        return "text"
    if k in ("integer", "whole"):
        return "int"
    if k in ("decimal", "number", "double"):
        return "float"
    if k in ("boolean", "toggle", "onoff", "on/off"):
        return "bool"
    return "text"


def _as_number(raw):
    """raw -> finite float, or None if it cannot be read as one."""
    if isinstance(raw, bool):
        # Must precede the int check: bool IS an int in Python, and True would
        # otherwise silently become 1.0 for a float row.
        return 1.0 if raw else 0.0
    if isinstance(raw, (int, float)):
        try:
            # OverflowError is real here: a bare 400-digit integer parses from
            # JSON as an arbitrary-precision int and float() then raises.
            value = float(raw)
        except (TypeError, ValueError, OverflowError):
            return None
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            value = float(text)
        except (TypeError, ValueError, OverflowError):
            return None
    else:
        return None
    if not math.isfinite(value):
        return None
    return value


def readable(raw, kind):
    """Would `raw` read cleanly as `kind`? Mirrored by the JS for the warning marks.

    Text is always readable (anything can be shown as text), which is why
    switching a list TO text never marks a row.
    """
    kind = normalize_type(kind)
    if kind == "text":
        return True
    if kind == "bool":
        if isinstance(raw, bool):
            return True
        if isinstance(raw, str) and raw.strip().lower() in (_TRUE_WORDS | _FALSE_WORDS):
            return True
        # A number reads as on/off by the usual zero/non-zero rule.
        return _as_number(raw) is not None
    return _as_number(raw) is not None


def coerce_value(raw, kind):
    """raw + type -> the Python value the node emits. Never raises."""
    kind = normalize_type(kind)

    if kind == "text":
        if raw is None:
            return ""
        if isinstance(raw, str):
            return raw
        if isinstance(raw, bool):
            # Emit the spelling the user would have typed, not Python's.
            return "true" if raw else "false"
        return str(raw)

    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            word = raw.strip().lower()
            if word in _TRUE_WORDS:
                return True
            if word in _FALSE_WORDS:
                return False
        number = _as_number(raw)
        if number is None:
            return FALLBACKS["bool"]
        return number != 0.0

    number = _as_number(raw)
    if number is None:
        return FALLBACKS[kind]
    number = max(-_LIMIT, min(_LIMIT, number))
    if kind == "int":
        return int(round(number))
    return float(number)


def parse_state(raw):
    """The hidden DropdownState string -> a normalized dict. Never raises.

    Returns {"type": <one of TYPES>, "index": int, "options": [{"name","value"}]}.
    Every field is coerced into shape, because this string can arrive from a
    hand-edited API file as literally anything.
    """
    state = None
    if isinstance(raw, dict):
        state = raw
    elif isinstance(raw, str):
        try:
            # RecursionError too: deeply nested JSON would otherwise take the
            # whole run down rather than just this node.
            state = json.loads(raw)
        except (ValueError, TypeError, RecursionError):
            state = None
    if not isinstance(state, dict):
        state = {}

    kind = normalize_type(state.get("type"))

    raw_options = state.get("options")
    if not isinstance(raw_options, list):
        raw_options = []
    options = []
    for entry in raw_options:
        # A non-dict row (null, a bare string, an array) is dropped rather than
        # crashing the list. Control Panel learned this the hard way: one null
        # row aborted value injection for every OTHER node of its type too.
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        options.append({
            "name": name if isinstance(name, str) else "",
            "value": entry.get("value"),
        })

    index = state.get("index")
    if isinstance(index, bool) or not isinstance(index, (int, float)):
        index = 0
    else:
        try:
            index = int(index)
        except (TypeError, ValueError, OverflowError):
            index = 0

    return {"type": kind, "index": index, "options": options}


def selected_value(raw):
    """The hidden state string -> the single value this node outputs.

    An empty list, or an index pointing past the end, gives the type's fallback
    rather than raising: a workflow with an unconfigured Dropdown should still
    run and show you an empty string, not a red node.
    """
    state = parse_state(raw)
    options = state["options"]
    index = state["index"]
    if not options or index < 0 or index >= len(options):
        return FALLBACKS[state["type"]]
    return coerce_value(options[index].get("value"), state["type"])
