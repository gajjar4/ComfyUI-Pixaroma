"""Load Audio Pixaroma - pick a sound file, see it, take the part you want.

Deliberately model-agnostic. Everything about which frame counts a video model
accepts lives in Duration Pixaroma; this node only ever hears "take this many
seconds" and obeys, so it is just as useful for Wan, for Hunyuan, or for someone
who only wants to trim a voiceover.

Frontend-driven (Vue Compat #9): the file, the start point and the fallback
length live on node.properties in the browser and are injected into the hidden
LoadAudioState input by the graphToPrompt hook in js/load_audio/index.js. The
waveform is drawn in the browser from the real file, so nothing here has to
decode audio just to show a picture of it.

The window maths is pure and lives in _audio_window_helpers.py
(harness: D:\\Claude Tests\\_audio_nodes_test.py).
"""
from __future__ import annotations

import json
import os

import folder_paths

from ._audio_window_helpers import apply_window, plan_window, window_report
from ._path_guard import comfy_roots, is_path_under, rel_is_rooted

HIDDEN_INPUT = "LoadAudioState"


def _decode(path):
    """(waveform [C, L], sample_rate). Uses core's own loader when it is there.

    Imported lazily and guarded: comfy_extras.nodes_audio pulls in av, and a
    private helper of core's is exactly the kind of thing that gets renamed. A
    torchaudio fallback keeps the node alive if it ever does (and an optional
    dependency that imports fine can still fail at call time, so the fallback is
    tried on ANY failure, not just ImportError).
    """
    try:
        from comfy_extras.nodes_audio import load as _core_load
        return _core_load(path)
    except Exception:
        import torchaudio
        return torchaudio.load(path)


def _resolve(name):
    """Turn an untrusted filename into a real path inside ComfyUI's own folders.

    Order matters. rel_is_rooted runs FIRST, before anything touches the
    filesystem: on Windows merely resolving \\\\attacker\\share opens SMB and
    leaks an NTLM hash, and /prompt is unauthenticated, so this value is
    attacker-controlled like every other input (see patterns/path-containment.md).
    """
    if not name or not isinstance(name, str):
        return None
    # "song.mp3 [input]" -> screen the bare name, let core parse the annotation.
    bare = name.split(" [")[0] if " [" in name else name
    if rel_is_rooted(bare):
        return None
    try:
        path = folder_paths.get_annotated_filepath(name)
    except Exception:
        return None
    if not path or not os.path.isfile(path):
        return None
    roots = comfy_roots()
    if not roots or not is_path_under(path, *roots):
        return None
    return path


def _state(raw):
    try:
        st = json.loads(raw or "{}")
    except Exception:
        return {}
    return st if isinstance(st, dict) else {}


class PixaromaLoadAudio:
    DESCRIPTION = (
        "Loads a sound file and hands on the part of it you choose. The node draws the whole "
        "waveform so you can see where the loud parts are, and you drag a window across it to "
        "pick your moment: no counting seconds in your head, no cutting the file up in another "
        "program first.\n\n"
        "Wire the seconds output of Duration Pixaroma into the duration input and the window is "
        "exactly as long as the video you are about to make, so the picture and the sound cannot "
        "drift apart. Leave that input empty and you get the whole file, or a length you set in "
        "the node's settings.\n\n"
        "If your window runs off the end of the file, the node either fills the rest with silence "
        "or loops back to the start, whichever you chose in the settings, and it tells you it did.\n\n"
        "Works with any model. Find it by searching for audio, sound, music, song, wav, mp3, or trim."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Hidden rather than required: a required STRING shows BOTH as a widget
        # and as a convertible input dot in the Vue frontend (Vue Compat #9).
        return {
            "required": {},
            "optional": {
                "duration": ("FLOAT", {
                    "forceInput": True,
                    "tooltip": "How many seconds to take, normally wired from the seconds output "
                               "of Duration Pixaroma. Leave it unconnected to use the whole file "
                               "or the length set in this node's settings.",
                }),
            },
            "hidden": {HIDDEN_INPUT: ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    OUTPUT_TOOLTIPS = (
        "The piece of the file you selected, ready to wire into a save node, a sync node, or "
        "anything else that takes audio.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🎵 Audio"

    @classmethod
    def IS_CHANGED(cls, duration=None, **kwargs):
        """Re-run when the FILE ITSELF changes.

        The state blob is a real input, so the filename, start point and length
        are already part of the cache signature. What is not is the CONTENT of
        the file - overwrite song.mp3 with a different take under the same name
        and nothing else here would notice. mtime + size rather than a hash: a
        three-minute song is megabytes and this runs on every graph validation.
        """
        st = _state(kwargs.get(HIDDEN_INPUT, "{}"))
        path = _resolve(st.get("file", ""))
        if not path:
            return ""
        try:
            s = os.stat(path)
            return "{}:{}".format(s.st_mtime_ns, s.st_size)
        except OSError:
            return ""

    def run(self, duration=None, **kwargs):
        st = _state(kwargs.get(HIDDEN_INPUT, "{}"))
        name = st.get("file", "")
        path = _resolve(name)
        if not path:
            raise ValueError(
                "[Pixaroma] Load Audio: no usable sound file selected"
                + (" ({!r} was not found in ComfyUI's input folder)".format(name) if name else "")
                + ". Pick one on the node, or use its Upload button."
            )

        waveform, sample_rate = _decode(path)
        if waveform.ndim == 2:
            waveform = waveform.unsqueeze(0)      # [C, L] -> [1, C, L]

        # The wired duration wins; otherwise fall back to what the settings say.
        # 0 means "everything from the start point to the end of the file".
        if duration is None:
            want = 0.0 if st.get("whenUnwired", "whole") == "whole" else st.get("length", 0.0)
        else:
            want = duration

        plan = plan_window(waveform.shape[-1], sample_rate, st.get("start", 0.0), want)
        when_short = "loop" if st.get("whenShort") == "loop" else "silence"
        out = apply_window(waveform, plan, when_short)
        rep = window_report(plan, sample_rate)

        if rep["short"]:
            print(
                "[Pixaroma] Load Audio: wanted {:.2f}s from {:.2f}s but the file only had "
                "{:.2f}s left, so {:.2f}s was {}.".format(
                    rep["want_s"], rep["start_s"], rep["take_s"], rep["fill_s"],
                    "looped" if when_short == "loop" else "filled with silence")
            )

        return {
            # The face reads this to show what actually happened on the last run.
            "ui": {"pixaroma_load_audio": [{
                "file": os.path.basename(path),
                "start": round(rep["start_s"], 3),
                "length": round(rep["want_s"], 3),
                "taken": round(rep["take_s"], 3),
                "filled": round(rep["fill_s"], 3),
                "short": rep["short"],
                "mode": when_short,
                "wired": duration is not None,
            }]},
            "result": ({"waveform": out, "sample_rate": sample_rate},),
        }


NODE_CLASS_MAPPINGS = {"PixaromaLoadAudio": PixaromaLoadAudio}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadAudio": "Load Audio Pixaroma"}
