"""Music Prompt Pixaroma - the pure half.

No torch, no ComfyUI imports, so every decision this node makes can be
exercised with a bare python and no model on disk
(harness: D:\\Claude Tests\\_music_prompt_test.py).

WHAT THIS NODE IS. `MiniMaxMusic3TextEncode` takes a `caption` and a `lyrics`
string, and they are different KINDS of writing: one describes the sound, the
other is sung out loud. AI Prompt emits one string, so today that is two nodes
and the idea has to be typed into both. This node takes the idea once and runs
the model twice on one load.

THE FORMULAS ARE BAKED IN, and that is the deliberate difference from AI
Prompt, whose whole design is that the formula lives on the node. Here the
wording is not the user's dial - it took three measured rounds to get the
lyrics one working and it is tuned to a TEMPERATURE as much as to a model
(ai-prompt.md #15.1: eight rewrites at 0.7 all failed and 0.3 fixed them with
no wording change). So the caption runs at 0.3 and the lyrics at 0.8, both
baked, and the CONTROLS on the face steer the song instead.

WHAT THE CONTROLS DO. They append the same natural-language clauses the
measurements used, because the shipped lyrics formula already reads length and
structure out of the idea. Measured inputs were literally
"a 30 second song about love" and "a song about love, 3 verses, 3 choruses and
a bridge", so `structure_clause` rebuilds exactly that shape rather than
inventing a directive block (ai-prompt.md #14b: prefer wording already measured
over new wording that reads better).

⚠️ VERSES ARE A REQUEST, NOT A GUARANTEE, and the face must not promise
otherwise. Measured: 1 and 2 come back exactly as asked on both seeds, 3
drifts, and asking for 6 returns 5. `MAX_VERSES` is 3 for that reason - do not
raise it without new measurements.
"""

# Reused, never re-rolled. These took twenty-odd documented fixes on the
# sibling and a second copy WILL drift (music-prompt.md, "the one architectural
# rule"). `_clamp` is private to that module but this is the same package and
# sharing it is the whole point.
from ._ai_prompt_helpers import _clamp, as_text
from ._music_prompt_formulas import CAPTION_FORMULA, LYRICS_FORMULA

__all__ = [
    "CAPTION_FORMULA",
    "LYRICS_FORMULA",
    "CAPTION_SAMPLING",
    "LYRICS_SAMPLING",
    "DEFAULT_STATE",
    "MAX_SECONDS",
    "AUTO_SHAPE",
    "MAX_VERSES",
    "auto_verses",
    "VERSES_AUTO",
    "build_caption_prompt",
    "build_lyrics_prompt",
    "idea_text",
    "parse_state",
    "status_line",
    "structure_clause",
    "will_generate",
]

# The real ceiling, read from source rather than guessed:
# MAX_AUDIO_FRAMES 9000 / AUDIO_FRAMES_PER_SECOND 25 in
# comfy/ldm/minimax_music/ar.py. It is 360, not the 300 that gets assumed, and
# the encode node itself defaults to 120.
MAX_SECONDS = 360
MIN_SECONDS = 5
DEFAULT_SECONDS = 120

# 0 means "let the length decide", which is the formula's own shape rule.
VERSES_AUTO = 0
MAX_VERSES = 3

# ⚠️ AUTO NAMES THE SHAPE. It does not leave the model to infer it from prose.
#
# The formula ALREADY prescribes a shape per length in its own words. The model
# reads it unreliably, and both failures a user hit came from that:
#
#   - a 60 second song came back with one verse and one chorus - the UNDER-FORTY
#     shape - and ran 21 seconds;
#   - a 30 second song came back with an empty [Intro] on top of a full verse and
#     chorus, and the chorus was chopped off the end.
#
# Naming the shape outright fixes both, measured on one idea with four or five
# seeds an arm, nothing else moving:
#
#     60s  say nothing              3/5 filled the minute
#     60s  "2 verses and 2 choruses" 5/5 filled the minute
#
#     30s  say nothing              1/4 free of an empty section
#     30s  "1 verse and 1 chorus"   4/4 free of an empty section
#
# The thresholds ARE the formula's own table, so this states what it already
# says rather than inventing a policy. 90 seconds and up is deliberately absent:
# 120s and 180s both measured 1.00x on Auto, and an explicit 3 verses drifts back
# to 2 at 180s, so naming it there would make things worse. Do not fix what
# measures fine.
#
# This is not Auto quietly becoming something else. Auto means the length decides
# the shape; this is the length deciding it. The clause produced is BYTE-IDENTICAL
# to choosing that verse count by hand, which is why the measurements above
# transfer with no new run.
#
# ⚠️ TWO OTHER APPROACHES FAILED - see music-prompt.md #6, do not retry them:
# telling the writer a SHORTER target changed nothing (8 lines either way), and
# telling it not to leave a section empty produced 26 sung lines on one seed.
AUTO_SHAPE = (
    (40, 1),    # under 40 seconds: one verse and one chorus
    (90, 2),    # 40 up to 90: two verses and two choruses
)               # 90 and over: say nothing


def auto_verses(seconds):
    """The verse count Auto asks for at this length, or 0 to say nothing."""
    for limit, verses in AUTO_SHAPE:
        if int(seconds) < limit:
            return verses
    return VERSES_AUTO

# MEASURED WITH THE WORDING, so they travel with it. The caption wants a low
# temperature to stay factual; the lyrics want a high one or every song rhymes
# the same way. Splitting these two apart is what makes one model load do two
# genuinely different jobs.
CAPTION_SAMPLING = {"temperature": 0.3, "max_length": 500}
LYRICS_SAMPLING = {"temperature": 0.8, "max_length": 900}

# Shared by both passes. Lifted from the measured preset settings; they are the
# same in each, so they are stated once.
COMMON_SAMPLING = {
    "top_k": 64,
    "top_p": 0.95,
    "min_p": 0.05,
    "repetition_penalty": 1.05,
    "presence_penalty": 0.0,
    "do_sample": True,
}

DEFAULT_STATE = {
    "idea": "",
    "model": "",
    # Inert - ComfyUI detects the encoder from the file's contents - but it is
    # what the probes passed, so it is what this passes.
    "clip_type": "krea2",
    "seed": 0,
    "seconds": DEFAULT_SECONDS,
    "verses": VERSES_AUTO,
    "bridge": False,
    "instrumental": False,
    "release_model": False,
}


def parse_state(raw):
    """The injected blob as a dict with every value present and in range.

    Nothing here is trusted: /prompt is unauthenticated, so a hand-edited
    workflow or a crafted body can put anything in any field.
    """
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
    st["model"] = as_text(st["model"]).strip()
    st["clip_type"] = as_text(st["clip_type"]).strip() or "krea2"

    st["seed"] = int(_clamp(st["seed"], 0, 0, 0xFFFFFFFFFFFFFFFF))
    st["seconds"] = int(
        _clamp(st["seconds"], DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS)
    )
    st["verses"] = int(_clamp(st["verses"], VERSES_AUTO, VERSES_AUTO, MAX_VERSES))

    st["bridge"] = st["bridge"] is True
    st["instrumental"] = st["instrumental"] is True
    st["release_model"] = st["release_model"] is True
    return st


def _join(parts, sep):
    """Join, dropping blank pieces so a missing one takes its separator too."""
    return sep.join(p for p in parts if isinstance(p, str) and p.strip())


def _listy(items):
    """a, b and c - the grammar the measured ideas actually used.

    "2 verses and 2 choruses" and "3 verses, 3 choruses and a bridge" are both
    real measured inputs, and this reproduces each exactly.
    """
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def _plural(count, word):
    return "%d %s" % (count, word if count == 1 else word + "es"
                      if word.endswith("s") else word + "s")


def structure_clause(seconds, verses=VERSES_AUTO, bridge=False, instrumental=False):
    """The tail appended to the idea, in the shape the measurements used.

    Length is always stated, because the node has a control for it and relying
    on the user to type "a 30 second song" is exactly the friction this node
    exists to remove. Structure is otherwise only stated when asked for, so the
    formula's own shape rule runs - except that Auto NAMES that shape rather
    than leaving it to be inferred from prose (see AUTO_SHAPE).
    """
    bits = []
    if seconds:
        bits.append("%d seconds long" % int(seconds))

    if not verses and seconds:
        verses = auto_verses(seconds)

    wanted = []
    if verses and verses >= 1:
        # Verses and choruses move together: every measured pair asked for both,
        # and a verse count with no chorus is not a song shape anyone wanted.
        wanted.append(_plural(int(verses), "verse"))
        wanted.append(_plural(int(verses), "chorus"))
    if bridge:
        wanted.append("a bridge")
    if instrumental:
        wanted.append("an instrumental section")

    if wanted:
        bits.append(_listy(wanted))
    return ", ".join(bits)


def idea_text(idea, wired):
    """The user's own words: what they typed, plus anything wired in."""
    return _join([as_text(idea), as_text(wired)], "\n")


def build_caption_prompt(idea, wired):
    """What the model is asked for the CAPTION.

    Deliberately gets the idea ALONE - no length, no structure. The caption
    describes SOUND, and "120 seconds long" is not a sound; feeding it in only
    invites the number into a field that is meant to carry genre, key and
    instruments. Every measured caption run used a plain idea.
    """
    return _join([CAPTION_FORMULA, idea_text(idea, wired)], "\n")


def build_lyrics_prompt(idea, wired, caption="", seconds=DEFAULT_SECONDS,
                        verses=VERSES_AUTO, bridge=False, instrumental=False):
    """What the model is asked for the LYRICS.

    It sees the caption as well as the idea, and BOTH halves are load-bearing.
    Measured: caption alone loses the subject outright - "a 30 second song
    about love" produced lyrics that never said love once, because the caption
    describes sound and never mentions what the song is about. The idea alone
    loses the mood the caption just settled. Together they keep the theme, the
    length and the feel.
    """
    clause = structure_clause(seconds, verses, bridge, instrumental)
    subject = idea_text(idea, wired)
    if clause:
        subject = ("%s, %s" % (subject, clause)) if subject.strip() else clause

    caption = as_text(caption).strip()
    if caption:
        # Labelled, so the model can tell the description of the sound apart
        # from the thing the song is about. Unlabelled, a caption reads as more
        # idea and its facts start turning up in sung lines.
        subject = "%s\n\nThe music it will be sung over:\n%s" % (subject, caption)
    return _join([LYRICS_FORMULA, subject], "\n")


def will_generate(state, wired_text, has_clip):
    """True when there is both something to ask with and something to ask."""
    if not (has_clip or state.get("model")):
        return False
    return bool(idea_text(state.get("idea", ""), wired_text).strip())


def status_line(state, wired_text, has_clip, generated):
    """A SHORT note for the readout, or "" when there is nothing worth saying."""
    if generated:
        return ""
    if not (has_clip or state.get("model")):
        return "no model, your text passed through"
    return "nothing to send, your text passed through"
