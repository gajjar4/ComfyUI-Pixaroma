"""Minimax H3 Prompt Pixaroma - write an H3 prompt with a local model, in one node.

Replaces three workflows (text to video, first frame, first and last) of about
ten nodes each. Everything they wired by hand happens inside here: the text
encoder is loaded and cached, the two frames are stitched, the formula is joined
with the idea and the length block, and the model is asked for the prompt.

THE MODE IS NOT STORED. It is derived from which image inputs arrived, so there
is no mode on node.properties to go stale, and the connection handler in the JS
writes no serialized state - which is what keeps this clear of the configure
replay that has bitten the Switch family twice (Vue Compat #17 / #19).

All the text assembly is pure and lives in _h3_prompt_helpers.py so it can be
tested with a bare python and no model on disk
(harness: D:\\Claude Tests\\_h3_prompt_test.py).

The three calls that do the generating are exactly the ones core's own
TextGenerate node makes (comfy_extras/nodes_textgen.py): clip.tokenize, then
clip.generate, then clip.decode. Core's TextGenerateLTX2Prompt is the same shape
as this node for a different model - a TextGenerate that carries its own system
prompt - so this is a sanctioned pattern rather than a workaround.
"""
import torch

import comfy.model_management
import comfy.sd
import comfy.utils
import folder_paths

from ._duration_helpers import frames_from_seconds
from ._h3_prompt_helpers import (
    FIRST_LAST,
    MODE_LABELS,
    assemble,
    mode_for,
    parse_state,
    word_count,
)

# ---------------------------------------------------------------------------
# Model cache
# ---------------------------------------------------------------------------
# ComfyUI caches a CLIPLoader node's OUTPUT between runs, which is what keeps a
# text encoder warm in the workflows this node replaces. Loading inside a node
# gets none of that, so without a cache here a 10 GB encoder would be re-read
# from disk on every single generate.
#
# Deliberately holds ONE entry: swapping the model in settings should release
# the old one rather than sit on two 10 GB encoders. The value is the CLIP
# object core hands back, which owns a ModelPatcher, so ComfyUI's own model
# management can still offload it when something else needs the VRAM.
_CLIP_CACHE = {}


def _release_clip():
    _CLIP_CACHE.clear()
    try:
        comfy.model_management.soft_empty_cache()
    except Exception:
        pass


def _load_clip(name: str, clip_type: str):
    key = (name, clip_type)
    cached = _CLIP_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        path = folder_paths.get_full_path_or_raise("text_encoders", name)
    except Exception:
        raise RuntimeError(
            "[Pixaroma] Minimax H3 Prompt: the text encoder \"%s\" was not found "
            "in your text_encoders folder.\n"
            "  Open the gear on the node and pick a model from the list.\n"
            "  The one these formulas were written for is "
            "qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors (a VISION model is "
            "required, because the first-frame modes show it a picture)." % name
        )
    # Same getattr-with-fallback CLIPLoader itself uses, so an unknown type name
    # degrades instead of raising. The type is largely inert for these models -
    # the encoder comes from the weights - but it is carried so an unusual build
    # can still be pointed at the right branch.
    clip_type_enum = getattr(
        comfy.sd.CLIPType, str(clip_type).upper(), comfy.sd.CLIPType.STABLE_DIFFUSION
    )
    _release_clip()
    clip = comfy.sd.load_clip(
        ckpt_paths=[path],
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
        clip_type=clip_type_enum,
        model_options={},
    )
    _CLIP_CACHE[key] = clip
    return clip


# ---------------------------------------------------------------------------
# Stitching
# ---------------------------------------------------------------------------
def _stitch_right(image1, image2):
    """First frame on the LEFT, last frame on the RIGHT, in one picture.

    A faithful copy of core's ImageStitch for the exact settings the tested FFLF
    workflow used (direction right, match_image_size on, no spacing), rather
    than a call into it: the V3 node returns an IO.NodeOutput whose shape is
    internal API, and this is fifteen lines.

    Which half is which is load-bearing - the whole FFLF formula is written
    around left meaning the start - so it is fixed here in Python and can no
    longer be wired backwards by accident.
    """
    if image2 is None:
        return image1
    if image1 is None:
        return image2
    if image1.shape[0] != image2.shape[0]:
        n = max(image1.shape[0], image2.shape[0])
        if image1.shape[0] < n:
            image1 = torch.cat(
                [image1, image1[-1:].repeat(n - image1.shape[0], 1, 1, 1)]
            )
        if image2.shape[0] < n:
            image2 = torch.cat(
                [image2, image2[-1:].repeat(n - image2.shape[0], 1, 1, 1)]
            )
    h1 = int(image1.shape[1])
    h2, w2 = int(image2.shape[1]), int(image2.shape[2])
    if h1 < 1 or h2 < 1 or w2 < 1:
        return image1
    target_h = h1
    target_w = max(1, int(h1 * (w2 / h2)))
    image2 = comfy.utils.common_upscale(
        image2.movedim(-1, 1), target_w, target_h, "lanczos", "disabled"
    ).movedim(1, -1)
    return torch.cat([image1, image2], dim=2)


def _first_image(*candidates):
    for c in candidates:
        if c is not None:
            return c
    return None


class PixaromaH3Prompt:
    DESCRIPTION = (
        "Writes a MiniMax H3 video prompt for you, on your own machine, using a small "
        "language model you already have. It replaces three separate workflows and about "
        "ten nodes with one.\n\n"
        "Type your idea in plain words, pick how long the video should be, and press Run. "
        "The node hands back a finished H3 prompt with all the fields and rules that model "
        "expects, plus the frame count to render it at.\n\n"
        "What it writes depends on what you wire in, and it switches by itself. Nothing "
        "connected means text to video. A first frame connected means it looks at that "
        "picture and animates it. Both a first and a last frame means it writes the journey "
        "from one to the other, and it joins the two pictures for you so they can never end "
        "up the wrong way round.\n\n"
        "The wording it follows lives in the settings, one for each of the three cases, and "
        "you can edit any of them and put the original back. The length choices live there "
        "too, because how much to write is the setting that changes the result most.\n\n"
        "Wire the frames output into your H3 node so the video is rendered at the same "
        "length the prompt was written for. Getting those two out of step is the easiest "
        "way to spoil a clip.\n\n"
        "Needs a vision model in your text_encoders folder, because the first-frame modes "
        "have to see the picture.\n\n"
        "Find it by searching for h3, minimax, prompt, llm, or write prompt."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Everything the face shows rides in the hidden state blob, injected by
        # the browser at graphToPrompt time (Vue Compat #9). A required STRING
        # would render as a widget AND a convertible input dot.
        return {
            "required": {},
            "optional": {
                "first_frame": (
                    "IMAGE",
                    {
                        "tooltip": "The picture the video starts on. Connecting this "
                        "switches the node to first-frame mode, so it describes what it "
                        "sees and animates it. Leave it empty for text to video."
                    },
                ),
                "last_frame": (
                    "IMAGE",
                    {
                        "tooltip": "The picture the video ends on. Connecting this as "
                        "well as a first frame switches the node to first-and-last mode, "
                        "where it writes the movement from one picture to the other."
                    },
                ),
                "clip": (
                    "CLIP",
                    {
                        "tooltip": "Optional. Wire a CLIP Loader here to use that model "
                        "instead of the one chosen in the node's settings. Handy for "
                        "sharing a single loaded model between several of these nodes."
                    },
                ),
            },
            "hidden": {"H3PromptState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING", "INT", "FLOAT")
    RETURN_NAMES = ("text", "frames", "seconds")
    OUTPUT_TOOLTIPS = (
        "The finished MiniMax H3 prompt. Wire it into the prompt or text input of your H3 "
        "node.",
        "How many frames to render, already adjusted to the pattern H3 accepts. Wire this "
        "into the length input of your H3 node so the video is exactly as long as the "
        "prompt was written for.",
        "How long the video will really be in seconds, which is the frame count divided by "
        "the frame rate. Use it for anything that has to line up with the video, such as "
        "the length of an audio track.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"
    OUTPUT_NODE = True

    # NO IS_CHANGED on purpose. H3PromptState is a real input, so the idea, the
    # length and the seed are already part of the cache signature - exactly as
    # Duration Pixaroma does it. That is also what makes a Fixed seed cache and
    # a Random one re-run, with no nonce (Seed Pixaroma, issue #11).

    def run(self, first_frame=None, last_frame=None, clip=None, H3PromptState="{}"):
        st = parse_state(H3PromptState)
        mode = mode_for(first_frame is not None, last_frame is not None)
        prompt, asked_seconds, tier_name = assemble(H3PromptState, mode)

        if not prompt.strip():
            raise RuntimeError(
                "[Pixaroma] Minimax H3 Prompt: there is no formula to run for "
                "\"%s\". Open the gear on the node and press Reset on that formula "
                "to put the shipped one back." % MODE_LABELS.get(mode, mode)
            )

        if mode == FIRST_LAST:
            image = _stitch_right(first_frame, last_frame)
        else:
            image = _first_image(first_frame, last_frame)

        model = clip if clip is not None else _load_clip(st["model"], st["clip_type"])

        # BYTE-IDENTICAL to core's TextGenerate.execute, including video and
        # audio. Do NOT wrap this in a try/except TypeError "for safety": every
        # tokenizer in the chain ends in **kwargs, so nothing here can raise
        # TypeError, and a fallback that quietly dropped skip_template or
        # thinking would change what the model is asked without saying so. That
        # fallback existed for one build of this node and cost an afternoon,
        # because it was the obvious suspect for a difference that turned out
        # not to exist. Measured 2026-08-12: this node and core's TextGenerate
        # score identically (2/6) on the same image, prompt text and seeds.
        #
        # `image` is singular on purpose. Qwen3VLTokenizer takes `images` as a
        # list but reads a singular `image` out of kwargs and splits it by batch
        # (comfy/text_encoders/qwen3vl.py, tokenize_with_weights).
        tokens = model.tokenize(
            prompt,
            image=image,
            skip_template=not st["use_default_template"],
            min_length=1,
            thinking=st["thinking"],
            video=None,
            audio=None,
        )

        generated = model.generate(
            tokens,
            do_sample=True,
            max_length=st["max_length"],
            temperature=st["temperature"],
            top_k=st["top_k"],
            top_p=st["top_p"],
            min_p=st["min_p"],
            repetition_penalty=st["repetition_penalty"],
            presence_penalty=st["presence_penalty"],
            seed=st["seed"],
        )
        text = model.decode(generated)
        text = text.strip() if isinstance(text, str) else ""

        frames = frames_from_seconds(
            asked_seconds, st["fps"], st["step"], st["plus"], st["min_frames"]
        )
        fps = st["fps"] if st["fps"] > 0 else 24.0
        true_seconds = round(frames / fps, 4)

        if st["release_model"] and clip is None:
            _release_clip()

        return {
            "ui": {
                "pixaroma_h3_prompt": [
                    {
                        "text": text,
                        "words": word_count(text),
                        "mode": mode,
                        "mode_label": MODE_LABELS.get(mode, mode),
                        "tier": tier_name,
                        "asked_seconds": asked_seconds,
                        "frames": frames,
                        "seconds": true_seconds,
                        "seed": st["seed"],
                    }
                ]
            },
            "result": (text, frames, true_seconds),
        }


NODE_CLASS_MAPPINGS = {"PixaromaH3Prompt": PixaromaH3Prompt}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaH3Prompt": "Minimax H3 Prompt Pixaroma"}
