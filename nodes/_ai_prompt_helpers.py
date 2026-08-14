"""AI Prompt Pixaroma - the pure half.

No torch, no ComfyUI imports, so the whole of the text handling can be
exercised with a bare python and no model on disk
(harness: D:\\Claude Tests\\_ai_prompt_test.py).

Two jobs live here:

1. Reading the state blob the browser injects. Every value in it is
   attacker-controlled in the same sense every widget value is - /prompt is
   unauthenticated - so nothing is trusted and everything is clamped.

2. Deciding what string the model is asked, and what comes out when there is
   no model to ask. That second case is the whole reason this node can be
   dropped into a live chain: a node with no model is a working pass-through,
   not an error.

THE FORMULA LIVES ON THE NODE, not in a file. That is the deliberate
difference from Video Prompt, whose formulas are shared files on disk. Three
nodes in a chain must be able to hold three different instructions, a
duplicate must get its own copy, and a shared workflow should carry its
instructions with it. It also removes a whole bug class Video Prompt had to
fix afterwards: a formula in a FILE is not part of the node's cache
signature, so editing one changed nothing until something else did
(video-prompt.md #8). A formula in the state blob re-runs by itself.
"""

import re

# ---------------------------------------------------------------------------
# Joining
# ---------------------------------------------------------------------------
# Mirrors Prompt Pixaroma's SEP_OPTIONS so the two nodes behave the same way
# when you wire text into either of them. The keys are what the state carries;
# the values are what actually goes between the pieces.
SEP_MAP = {
    "newline": "\n",
    "blank": "\n\n",
    "space": " ",
    "comma": ", ",
    "period": ". ",
    "pipe": " | ",
    "break": " BREAK ",
    "none": "",
}
DEFAULT_SEP = "newline"

ORDER_IDEA = "idea"
ORDER_WIRED = "wired"

# The formula is an INSTRUCTION, not content, so it is always first and always
# separated by a plain newline regardless of the user's separator choice -
# which is about how the idea and the wired text meet each other. This is the
# same contract Video Prompt uses ("\n".join of formula, idea, length block),
# and it is why a formula that ends in a label like "IDEA:" reads correctly.
FORMULA_SEP = "\n"

DEFAULT_STATE = {
    "idea": "",
    "formula": "",
    "model": "",
    "clip_type": "minimax",
    "order": ORDER_IDEA,
    "sep": DEFAULT_SEP,
    "seed": 0,
    "temperature": 0.7,
    "max_length": 512,
    "top_k": 64,
    "top_p": 0.95,
    "min_p": 0.05,
    "repetition_penalty": 1.05,
    "presence_penalty": 0.0,
    "do_sample": True,
    "thinking": False,
    "use_default_template": True,
    "release_model": False,
}
# NOTE: there is deliberately no "passthrough" flag. Passing the text through
# is what the node does when there is no model or nothing to send, and a switch
# to turn that OFF could only mean "error instead", which is strictly worse.
# The key existed unread on both sides for a while; it is gone rather than
# wired up.


def _clamp(value, fallback, lo, hi):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return fallback
    if out != out or out in (float("inf"), float("-inf")):
        return fallback
    return max(lo, min(hi, out))


def as_text(value):
    """A string, whatever arrived.

    A wired STRING can reach a node as a length-1 list from some upstream
    packs, and an ANY-type passthrough (our own Switch Pixaroma included) can
    put anything at all on an optional input - see
    reference_optional_input_is_not_type_guaranteed. Everything that is not
    usable text becomes empty rather than raising, because this node's whole
    promise is that it keeps a graph running.
    """
    if isinstance(value, (list, tuple)):
        value = value[0] if value else ""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def parse_state(raw):
    """The injected blob as a dict with every value present and in range."""
    import json

    data = {}
    if isinstance(raw, str) and raw.strip():
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                data = loaded
        except (ValueError, TypeError):
            data = {}
    elif isinstance(raw, dict):
        data = raw

    st = dict(DEFAULT_STATE)
    st.update({k: v for k, v in data.items() if k in DEFAULT_STATE})

    st["idea"] = as_text(st["idea"])
    st["formula"] = as_text(st["formula"])
    st["model"] = as_text(st["model"]).strip()
    st["clip_type"] = as_text(st["clip_type"]).strip() or "minimax"
    st["order"] = ORDER_WIRED if st["order"] == ORDER_WIRED else ORDER_IDEA
    # isinstance FIRST: `x in SEP_MAP` hashes x, so a list or a dict here raised
    # TypeError straight out of parse_state - which run() calls unguarded, so a
    # hand-edited workflow or a crafted /prompt body killed the node with a raw
    # traceback instead of being clamped like every other field.
    st["sep"] = st["sep"] if isinstance(st["sep"], str) and st["sep"] in SEP_MAP \
        else DEFAULT_SEP

    st["seed"] = int(_clamp(st["seed"], 0, 0, 0xFFFFFFFFFFFFFFFF))
    st["temperature"] = _clamp(st["temperature"], 0.7, 0.01, 2.0)
    st["max_length"] = int(_clamp(st["max_length"], 512, 1, 32768))
    st["top_k"] = int(_clamp(st["top_k"], 64, 0, 1000))
    st["top_p"] = _clamp(st["top_p"], 0.95, 0.0, 1.0)
    st["min_p"] = _clamp(st["min_p"], 0.05, 0.0, 1.0)
    st["repetition_penalty"] = _clamp(st["repetition_penalty"], 1.05, 0.0, 5.0)
    st["presence_penalty"] = _clamp(st["presence_penalty"], 0.0, 0.0, 5.0)

    st["do_sample"] = st["do_sample"] is not False
    st["thinking"] = st["thinking"] is True
    st["use_default_template"] = st["use_default_template"] is not False
    st["release_model"] = st["release_model"] is True
    return st


def _join(parts, sep):
    """Join, dropping blank pieces so a missing one takes its separator too.

    Same rule as Prompt Pixaroma and Text Join: a piece that is whitespace-only
    contributes nothing, and never leaves a stray separator behind.
    """
    kept = [p for p in parts if isinstance(p, str) and p.strip()]
    return sep.join(kept)


def content_text(idea, wired, order, sep):
    """The user's own words: the idea and the wired text, in the chosen order.

    This is also EXACTLY what a pass-through returns. The formula is left out
    on purpose - it is an instruction to a model, so emitting it as content
    when there is no model to read it would put "describe this image in ten
    words" into somebody's positive prompt.
    """
    separator = SEP_MAP.get(sep, SEP_MAP[DEFAULT_SEP])
    pieces = [wired, idea] if order == ORDER_WIRED else [idea, wired]
    return _join(pieces, separator)


def build_prompt(formula, idea, wired, order, sep):
    """The whole string the model is asked."""
    return _join([formula, content_text(idea, wired, order, sep)], FORMULA_SEP)


def will_generate(state, wired_text, has_clip):
    """True when there is both something to ask with and something to ask.

    ONE condition causes a pass-through: no model, or nothing to send. A
    missing formula is not a failure - it just means the model gets the idea by
    itself, which is exactly what a quick "rewrite this" wants.
    """
    if not (has_clip or state.get("model")):
        return False
    return bool(build_prompt(
        state.get("formula", ""),
        state.get("idea", ""),
        wired_text,
        state.get("order", ORDER_IDEA),
        state.get("sep", DEFAULT_SEP),
    ).strip())


def status_line(state, wired_text, has_clip, generated):
    """A SHORT note for the readout, or "" when there is nothing worth saying.

    It deliberately does NOT name the model on a normal run: the banner at the
    top of the node already does, and repeating a 48-character filename beside
    the word count wrapped onto a second line and crowded the PROMPT label.

    The pass-through wordings stay, because those explain something the user
    cannot otherwise see - why the text came back unchanged.
    """
    if generated:
        return ""
    if not (has_clip or state.get("model")):
        return "no model, text passed through"
    return "nothing to send, text passed through"


# A REASONING model narrates its working before it answers, and that narration
# is not the prompt. Qwen3 (the plain one, as used by Z-Image) does it even
# with thinking off, because the template that would suppress it is not the one
# a lumina2-type encoder applies. Without this the node hands back 380 words of
# "Okay, the user wants me to ..." and the image model renders that.
#
# Core's own text node strips a CLOSED block, and these two patterns are copied
# from it so the behaviour matches. What core does not cover is the case this
# was reported from: the reasoning ran past max_length, so there is an opening
# tag and no closing one and NOTHING was ever answered. Core leaves the raw
# reasoning in place there; see reasoning_only() for why that has to be told
# apart rather than passed on.
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
_THINK_TAGS = re.compile(r"</?think>|<\|channel>\w*\n?|<channel\|>|<\|turn>\w*\n?")


def strip_reasoning(text):
    """The answer, with any reasoning block removed. Never raises."""
    if not isinstance(text, str):
        return ""
    out = _THINK_BLOCK.sub("", text)
    if "</think>" in out:
        # Truncated: keep whatever follows the last close.
        out = out.rsplit("</think>", 1)[-1]
    elif "<think>" in out:
        # An opening tag and NO closing one: the model ran out of room in the
        # middle of thinking, so everything from that tag onward is unfinished
        # reasoning and none of it is an answer. Core strips the bare tag and
        # hands the reasoning back as though it were one, which is precisely
        # how "Okay, the user wants me to..." reached a user's image.
        out = out.split("<think>", 1)[0]
    return _THINK_TAGS.sub("", out).strip()


def reasoning_only(raw):
    """True when the model spent the whole budget thinking and never answered.

    Told apart from an ordinary empty answer because the fix is different and
    specific: raise Max len, or pick a model that does not reason. Returning
    the reasoning instead - which is what core does here - puts "Okay, the user
    wants me to..." into somebody's image.
    """
    if not isinstance(raw, str) or "<think>" not in raw:
        return False
    return not strip_reasoning(raw)


def word_count(text):
    return len([w for w in str(text or "").split() if w.strip()])
