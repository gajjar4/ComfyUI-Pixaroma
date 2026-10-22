"""H3 Timeline Pixaroma - one long MiniMax H3 clip told as SCENES: each scene its own length, its own words and,
when it needs one, its own picture (a new look of the same shot, or a person who joins).

WHAT IT REPLACES. MiniMax H3 Reference to Video + H3 Long Video in one node: it writes each scene's prompt into
the tested EP41 Sing / Talk prompt (or the no-audio Act prompt, _h3_timeline_prompts.py), builds each scene's
conditioning with core's own Reference to Video code, and sets the model up to sample the whole clip in windows
that FOLLOW THE SCENES (_h3_timeline_helpers.scene_windows): every window reads its own scene's words and pictures,
and a scene change lands in the 1.6 s overlap between two windows, where the blend crosses over.

MEASURED 2026-10-22 (research_long_video_2.md "TIMELINE TEST", with a prototype of this wrapper): with a picture,
three scenes (hands clasped / dance / wave) change smoothly, no flash, no ghost; a person's picture from a scene on
brings them in from the edge; a new look picture dissolves in over ~0.4 s; each new scene drifts back toward the
picture's pose for a moment at its start. Without any picture the windows do not agree (double exposures), so
scene 1 must have one.

The scenes live in the browser (js/h3_timeline/) and reach this node through the hidden TimelineState input
(Vue Compat #9). Pictures are names in ComfyUI's input folder, resolved through _path_guard and refused outside it.
"""
from __future__ import annotations

from ._folder_source import refresh_copy, source_stamp
from ._h3_long_video_helpers import FPS
from ._h3_timeline_helpers import (clip_frames, cut_box, describe_scenes, fit_box, parse_state, scene_windows,
                                   split_scenes)
from ._h3_timeline_prompts import MODES, ROLE_PERSON, build_prompt
from ._path_guard import is_path_under, rel_is_rooted
from ._resize_helpers import normalize_bit_depth
from .node_h3_long_video import WRAPPER_KEY, _diffusion_model_kind, _Windows


class _SceneWindows(_Windows):
    """The H3 Long Video wrapper with windows that follow the scenes, each window reading its scene's text,
    token tags and references. Scene 1 is the sampler's own conditioning, so its windows run unchanged."""

    def __init__(self, lengths, scene_conds, later_conds=None):
        super().__init__(0, 0)
        self.lengths = list(lengths)
        self.scene_conds = scene_conds          # [(cross_attn, extras) or None] per scene
        # {scene: (cross_attn, extras)}: the conditioning for the LATER windows of a scene that was split (too long
        # for one window even at the smallest reach, scene_windows), when someone walked in during its first window:
        # worded as already there (people_sentence `arrived`)
        self.later_conds = dict(later_conds or {})
        self._ctx = {}

    def _context(self, dm, sc, cond, like):
        key = (sc, str(like.device), str(like.dtype))      # sc = a scene index, or ("later", scene)
        if key not in self._ctx:
            self._ctx[key] = dm.preprocess_text_embeds(cond.to(device=like.device, dtype=like.dtype))
        return self._ctx[key]

    def __call__(self, executor, x, timestep, context, transformer_options=None, **kwargs):
        if transformer_options is None:
            transformer_options = {}
        if not isinstance(x, (list, tuple)) or len(x) != 2 or getattr(x[0], "ndim", 0) != 5:
            return executor(x, timestep, context, transformer_options, **kwargs)
        video, audio = x[0], x[1]
        wins = scene_windows(video.shape[2], audio.shape[-1], self.lengths)
        if wins is None:
            return executor(x, timestep, context, transformer_options, **kwargs)
        import torch
        if self._told != video.shape[2]:
            self._told = video.shape[2]
            print("[Pixaroma] H3 Timeline: {} scenes, {} windows".format(len(self.lengths), len(wins)))
        spans = [w[:4] for w in wins]
        wv, wa = self._blend(spans, video.device)
        payload = kwargs.get("minimax_payload") or {}
        own_text = list(transformer_options.get("cond_or_uncond") or [0]) == [0]
        dm = getattr(executor, "class_obj", None)
        dm = getattr(dm, "diffusion_model", dm)
        mask_v, mask_a = kwargs.get("denoise_mask"), kwargs.get("audio_denoise_mask")
        out_v = torch.zeros(video.shape, dtype=torch.float32, device=video.device)
        out_a = torch.zeros(audio.shape, dtype=torch.float32, device=audio.device)
        seen = set()
        for (l0, l1, a0, a1, sc), w_v, w_a in zip(wins, wv, wa):
            ctx, src = context, payload
            ck, entry = sc, None
            if own_text:
                if sc in seen and sc in self.later_conds:       # windows come in time order: not the scene's first
                    ck, entry = ("later", sc), self.later_conds[sc]
                elif sc < len(self.scene_conds):
                    entry = self.scene_conds[sc]
            seen.add(sc)
            if entry is not None and dm is not None and hasattr(dm, "preprocess_text_embeds"):
                cond, extras = entry
                ctx = self._context(dm, ck, cond, context)
                src = dict(payload)
                if extras.get("minimax_refs") is not None:
                    src["refs"] = extras["minimax_refs"]
                if extras.get("minimax_token_tags") is not None:
                    src["text_token_tags"] = extras["minimax_token_tags"]
                else:
                    src.pop("text_token_tags", None)
            kw = dict(kwargs)
            kw["minimax_payload"] = self._window_payload(src, l0, l1, a0, a1, audio.shape[-1])
            if mask_v is not None:
                kw["denoise_mask"] = mask_v[:, :, l0:l1]
            if mask_a is not None:
                kw["audio_denoise_mask"] = mask_a[..., a0:a1]
            o = executor([video[:, :, l0:l1], audio[..., a0:a1]], timestep, ctx, transformer_options.copy(), **kw)
            out_v[:, :, l0:l1] += o[0].float() * w_v
            out_a[..., a0:a1] += o[1].float() * w_a.to(audio.device)
            del o
        return [out_v.to(video.dtype), out_a.to(audio.dtype)]


def _resolve_picture(name):
    """An input-folder picture name -> its real path, or None. The same order as Load Audio's _resolve
    (patterns/path-containment.md): the rooted prescreen BEFORE anything touches the disk, then containment in the
    INPUT folder only (a timeline picture is always an upload there)."""
    import os
    import folder_paths
    if not name or not isinstance(name, str):
        return None
    bare = name.split(" [")[0] if " [" in name else name
    if rel_is_rooted(bare):
        return None
    try:
        path = folder_paths.get_annotated_filepath(name)
        root = folder_paths.get_input_directory()
    except Exception:
        return None
    if not root or not is_path_under(path, root):
        return None
    return path if os.path.isfile(path) else None


def _load_picture(name, n):
    import numpy as np
    import torch
    import node_helpers
    from PIL import Image, ImageOps
    # A picture taken from one of the user's own folders (Load Image's picker, + Folder) is a COPY in
    # input/pixaroma_folders: bring it up to date with the original first, like Load Image does. Never raises; a
    # no-op for every other picture.
    refresh_copy(name)
    path = _resolve_picture(name)
    if path is None:
        raise ValueError("H3 Timeline: scene {}'s picture \"{}\" is not in ComfyUI's input folder. Pick it again on "
                         "the node.".format(n, name))
    img = node_helpers.pillow(Image.open, path)
    img = node_helpers.pillow(ImageOps.exif_transpose, img)
    img = normalize_bit_depth(img).convert("RGB")      # a 16-bit picture would clip to near white
    return torch.from_numpy(np.asarray(img).astype(np.float32) / 255.0)[None]


def _pictures_stamp(state):
    """For IS_CHANGED: what each scene picture IS now, so a picture changed under the same name re-runs the node.
    A folder copy: the ORIGINAL's size + time (the copy is refreshed later, inside the Run; hashing it here would
    change the key once more at the next Run, node_load_image.IS_CHANGED). Any other: the file's bytes, like core
    Load Image. Only through _resolve_picture (IS_CHANGED is a second entry point). Never raises."""
    import hashlib
    m = hashlib.sha256()
    try:
        names = []
        for sc in parse_state(state)["scenes"]:
            if sc["picture"] and sc["picture"] not in names:
                names.append(sc["picture"])
        for name in names:
            m.update(name.encode("utf-8", "replace") + b"\0")
            stamp = source_stamp(name)
            if stamp:
                m.update(stamp.encode("utf-8"))
                continue
            path = _resolve_picture(name)
            if path is None:
                m.update(b"missing")
                continue
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    m.update(chunk)
    except Exception as e:
        m.update(repr(e).encode("utf-8", "replace"))
    return m.hexdigest()


def _frame_picture(img, w, h, fit, x, y):
    """A scene's look picture -> exactly the video frame's size: cut to fill at (x, y), or fitted inside with black
    bars."""
    import torch
    import comfy.utils
    src_h, src_w = int(img.shape[1]), int(img.shape[2])
    s = img.movedim(-1, 1)
    if fit == "fit":
        sw, sh, left, top = fit_box(src_w, src_h, w, h)
        out = torch.zeros((1, 3, h, w), dtype=s.dtype, device=s.device)
        out[:, :, top:top + sh, left:left + sw] = comfy.utils.common_upscale(s, sw, sh, "lanczos", "disabled")
    else:
        sw, sh, left, top = cut_box(src_w, src_h, w, h, x, y)
        out = comfy.utils.common_upscale(s, sw, sh, "lanczos", "disabled")[:, :, top:top + h, left:left + w]
    return out.movedim(1, -1).clamp(0.0, 1.0)


def _fit_audio(audio, seconds):
    """The track cut (or padded with real silence) to the clip: as <Audio 1> it must be the clip's length, or H3
    Long Video's windows cannot cut it per window (is_track_ref). -> (audio or None, readout)."""
    import torch
    try:
        wave, sr = audio["waveform"], int(audio["sample_rate"])
        if not torch.is_tensor(wave) or wave.ndim != 3 or wave.shape[-1] < 1 or sr <= 0:
            return None, "the audio input is not a sound"
    except Exception:
        return None, "the audio input is not a sound"
    have = wave.shape[-1] / float(sr)
    want = int(round(seconds * sr))
    if wave.shape[-1] >= want:
        wave = wave[..., :want]
        note = "audio {:.1f} s, fits".format(have) if have - seconds < 0.5 else \
            "audio {:.1f} s, the video uses the first {:.1f} s".format(have, seconds)
    else:
        pad = torch.zeros(wave.shape[:-1] + (want - wave.shape[-1],), dtype=wave.dtype, device=wave.device)
        wave = torch.cat([wave, pad], dim=-1)
        note = "audio {:.1f} s for a {:.1f} s video: the last {:.1f} s are silent".format(have, seconds, seconds - have)
    return {"waveform": wave.contiguous(), "sample_rate": sr}, note


class PixaromaH3Timeline:
    DESCRIPTION = (
        "Tell one long MiniMax H3 video as scenes: each scene has its own length, a few words for what happens, "
        "and, if it needs one, its own picture. Scene 1's picture is the start picture. A later picture is either a "
        "New look (the same shot with a change, like a hat or another dress; it fades in, so for a natural change write "
        "the action in the scene before, with no picture) or Add person (any photo "
        "of someone who joins; they can walk in).\n\n"
        "It replaces MiniMax H3 Reference to Video and H3 Long Video: wire model, clip and both VAEs in, and the "
        "model, positive and latent out to H3 Audio Sync and the sampler. Sing and Talk put your words into the "
        "tested EP41 prompts and use the audio input as the song or the voice (lock it with H3 Audio Sync); Act needs "
        "no audio and H3 makes the sound itself.\n\n"
        "The video is made in one run, in windows that follow your scenes, so each scene change blends over a "
        "couple of seconds with no cut or flash. A scene is 4 seconds or more. A person who joins stays for the "
        "scene they join in: write their arrival and what they do next in one scene, and keep that scene at about "
        "13 seconds or less (a longer one is made in two parts and the person can slide between them). Works only "
        "with MiniMax H3."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "Your MiniMax H3 model (after its LoRAs). The node sets it up to make "
                                               "the video scene by scene."}),
                "clip": ("CLIP", {"tooltip": "The MiniMax H3 text encoder: it reads each scene's prompt and pictures."}),
                "vae": ("VAE", {"tooltip": "The MiniMax H3 video VAE."}),
                "audio_vae": ("VAE", {"tooltip": "The MiniMax H3 audio VAE."}),
                "mode": (list(MODES), {"default": "Sing", "tooltip": (
                    "Sing: the picture sings the audio (a song). Talk: the picture speaks the audio (a voice). Act: no "
                    "audio, H3 makes the sound itself. Your scene words go into the tested prompt for that mode.")}),
                "width": ("INT", {"default": 480, "min": 128, "max": 2048, "step": 32,
                                  "tooltip": "Video width. H3 sizes are multiples of 32."}),
                "height": ("INT", {"default": 864, "min": 128, "max": 2048, "step": 32,
                                   "tooltip": "Video height. H3 sizes are multiples of 32."}),
            },
            "optional": {
                "audio": ("AUDIO", {"tooltip": (
                    "The song (Sing) or the voice (Talk), as long as the video or longer: it is cut to the video's "
                    "length. Wire the same sound into H3 Audio Sync's track so the mouth follows it. Not used in Act.")}),
            },
            "hidden": {
                "TimelineState": "STRING",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "LATENT", "FLOAT")
    RETURN_NAMES = ("model", "positive", "latent", "seconds")
    OUTPUT_TOOLTIPS = (
        "Your model, set to make the video scene by scene. Wire it to H3 Audio Sync (or straight to the sampler).",
        "Scene 1's conditioning (the node swaps in the other scenes while it samples). Wire it to the sampler, and "
        "through Conditioning Zero Out to its negative.",
        "The empty video + sound latent for the whole length. Wire it to H3 Audio Sync's latent (or the sampler).",
        "The video's length in seconds (all scenes added up, on H3's frame grid). Not for the Load Audio that feeds "
        "this node: the scenes set the length.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🎵 Audio"

    @classmethod
    def IS_CHANGED(cls, TimelineState=None, **kwargs):
        # The scenes text is already in the cache key; this adds what the pictures ARE, so a picture edited or
        # replaced under the same name (or a folder picture's original) re-runs the node.
        return _pictures_stamp(TimelineState)

    def run(self, model, clip, vae, audio_vae, mode, width, height, audio=None, TimelineState=None, unique_id=None):
        try:
            from comfy_extras.nodes_minimax_h3 import MiniMaxH3ReferenceToVideo
        except Exception as e:
            raise RuntimeError("H3 Timeline needs a ComfyUI with MiniMax H3 support (core 0.42 or newer).") from e
        scenes = parse_state(TimelineState)["scenes"]
        lengths = [s["length"] for s in scenes]
        frames = clip_frames(lengths)
        seconds = frames / float(FPS)
        w = max(128, int(width) // 32 * 32)
        h = max(128, int(height) // 32 * 32)
        mode = mode if mode in MODES else "Sing"
        note = ""
        track = None
        if mode != "Act":
            if audio is None:
                note = "no audio wired: made as Act (H3 makes the sound)"
            else:
                track, note = _fit_audio(audio, seconds)
            if track is None:
                print("[Pixaroma] H3 Timeline: " + note + ".")
                mode = "Act"
        if not scenes[0]["picture"]:
            raise ValueError("H3 Timeline: scene 1 needs a picture (the start picture). H3 cannot keep a long video "
                             "together without one.")

        loaded = {}

        def picture(name, n):
            if name not in loaded:
                loaded[name] = _load_picture(name, n)
            return loaded[name]

        look, people, built, scene_conds, later_conds = None, [], {}, [], {}
        positive = latent = None
        split = split_scenes(lengths)

        def make(text, i):
            key = (text, look[:4], tuple(people))
            if key not in built:
                refs = {"ref_image_0": _frame_picture(picture(look[0], look[4]), w, h, look[1], look[2], look[3])}
                for k, p in enumerate(people):
                    refs["ref_image_{}".format(k + 1)] = picture(p, i + 1)
                out = MiniMaxH3ReferenceToVideo.execute(
                    clip=clip, prompt=text, width=w, height=h, length=frames, ref_image_size="match",
                    vae=vae, audio_vae=audio_vae, ref_images=refs,
                    ref_audios={"ref_audio_0": track} if track is not None else None)
                built[key] = (out[0], out[1])
            return built[key]

        for i, sc in enumerate(scenes):
            entering = ()
            if sc["picture"]:
                if i == 0 or sc["role"] != ROLE_PERSON:
                    look = (sc["picture"], sc["fit"], sc["x"], sc["y"], i + 1)
                elif sc["picture"] not in people:
                    people = people + [sc["picture"]]
                    entering = (len(people) - 1,)
            cond, lat = make(build_prompt(mode, sc["words"], len(people), entering, later=i > 0), i)
            if i == 0:
                positive, latent = cond, lat
                scene_conds.append(None)
            else:
                scene_conds.append(None if cond is positive else (cond[0][0], cond[0][1]))
            if entering and i in split:
                # Only read when this scene is split into windows (wrapper): the later ones see them already there.
                later, _ = make(build_prompt(mode, sc["words"], len(people), later=True, arrived=entering), i)
                later_conds[i] = (later[0][0], later[0][1])

        if type(getattr(model, "model", None)).__name__ != "MiniMaxH3":
            print("[Pixaroma] H3 Timeline: this model is not MiniMax H3, the scenes will not work.")
        m = model.clone()
        kind = _diffusion_model_kind()
        m.remove_wrappers_with_key(kind, WRAPPER_KEY)     # H3 Long Video before this node: the scenes take over
        m.add_wrapper_with_key(kind, WRAPPER_KEY, _SceneWindows(lengths, scene_conds, later_conds))

        spans = describe_scenes(lengths, frames)
        ui = {"h3_timeline": [{"frames": frames, "seconds": round(seconds, 2), "mode": mode, "audio": note,
                               "scenes": [[a, b] for a, b in spans]}]}
        return {"ui": ui, "result": (m, positive, latent, seconds)}


NODE_CLASS_MAPPINGS = {"PixaromaH3Timeline": PixaromaH3Timeline}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaH3Timeline": "H3 Timeline Pixaroma"}
