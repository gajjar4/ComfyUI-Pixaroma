"""AI Prompt Pixaroma - one local model, one saved instruction, text out.

The universal sibling of Video Prompt Pixaroma. That node knows about MiniMax
H3: modes derived from wires, duration tiers, a frame count. This one knows
about nothing - you give it a model and an instruction, wire in whatever you
have, and it hands back text. Which is what makes it chainable: the output is
a plain string and the input takes one, so a row of these is a row of steps.

The three calls that do the generating are exactly the ones core's own
TextGenerate node makes (comfy_extras/nodes_textgen.py): clip.tokenize, then
clip.generate, then clip.decode. Same parameters, same defaults, so a workflow
moved between the two behaves identically.

A NODE WITH NO MODEL IS A WORKING PASS-THROUGH, not an error. That is the
whole reason it can be dropped into a live chain and wired up afterwards, and
it is why there is no auto-picked substitute model here (Video Prompt has one
because it cannot function without a vision model; this one can).
"""
import time

import comfy.model_management
import comfy.sd
import folder_paths

from ._ai_prompt_helpers import (
    as_text,
    build_prompt,
    content_text,
    parse_state,
    reasoning_only,
    status_line,
    strip_reasoning,
    will_generate,
    word_count,
)

# ---------------------------------------------------------------------------
# Model cache
# ---------------------------------------------------------------------------
# MODULE level, so EVERY instance of this node shares it. Two nodes naming the
# same file get one load and one copy in memory, which is the common case for a
# chain - most people use the same model for every step.
#
# Deliberately ONE entry, copied from Video Prompt: swapping models should
# release the old one rather than sit on two 10 GB encoders. Two nodes using
# DIFFERENT models therefore take turns, reloading each run. That is the right
# trade on a 12 GB card; if mixed-model chains turn out to thrash in practice,
# this dict is the one line to widen.
_CLIP_CACHE = {}


def _release_clip(clip=None):
    """Actually give the VRAM back.

    soft_empty_cache() ALONE UNLOADS NOTHING - it empties torch's allocator
    cache while ComfyUI's own current_loaded_models still holds the encoder.
    The model has to be unloaded first. Measured on Video Prompt: 17.1 GB.
    """
    if clip is None:
        for c in _CLIP_CACHE.values():
            clip = c
            break
    _CLIP_CACHE.clear()
    patcher = getattr(clip, "patcher", None)
    if patcher is not None:
        try:
            comfy.model_management.unload_model_and_clones(patcher)
        except Exception:
            try:
                comfy.model_management.unload_all_models()
            except Exception:
                pass
    try:
        comfy.model_management.soft_empty_cache()
    except Exception:
        pass


_NEEDED = (
    "  Put a language model in your ComfyUI/models/text_encoders folder and\n"
    "  pick it from the gear on the node. For anything that has to SEE a\n"
    "  picture it must be a VISION model (a Qwen3-VL build). The one the\n"
    "  Pixaroma formulas were measured against is\n"
    "  qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors (10 GB, 12 GB+ cards):\n"
    "  https://huggingface.co/DreamFast/Qwen3-VL-8B-Heretic-1.3.0/tree/main/comfyui\n"
    "  (take it from that comfyui folder, NOT the repo root)\n"
    "  For an 8 GB card use the 4B instead:\n"
    "  https://huggingface.co/DreamFast/Qwen3-VL-4b-Heretic-ComfyUI/tree/main"
)


def _available():
    try:
        return list(folder_paths.get_filename_list("text_encoders"))
    except Exception:
        return []


def _load_clip(name, clip_type):
    key = (name, clip_type)
    cached = _CLIP_CACHE.get(key)
    if cached is not None:
        return cached

    # Check the live list BEFORE touching the filesystem. Core's get_full_path
    # already normalises the name so a traversal cannot escape the folder, but
    # confirming the file is one this node offered keeps the error honest: the
    # user picked something specific and it is not there.
    if name not in _available():
        have = _available()
        raise RuntimeError(
            "[Pixaroma] AI Prompt: the model \"%s\" is not in your "
            "text_encoders folder.\n%s\n%s"
            % (
                name,
                ("  Files you do have: " + ", ".join(have[:8]) +
                 ("..." if len(have) > 8 else "")) if have
                else "  That folder is empty.",
                _NEEDED,
            )
        )

    # Guarded even though the membership check above passed: the two can
    # disagree if the file goes away between them, and the sibling node wraps
    # this same call for the same reason. Without it a resolver mismatch
    # surfaces as a raw traceback where every other failure here is friendly.
    try:
        path = folder_paths.get_full_path_or_raise("text_encoders", name)
    except Exception as e:
        raise RuntimeError(
            "[Pixaroma] AI Prompt: the model \"%s\" could not be found on disk, "
            "even though it is listed in your text_encoders folder.\n%s"
            % (name, _NEEDED)
        ) from e
    clip_type_enum = getattr(
        comfy.sd.CLIPType, str(clip_type).upper(), comfy.sd.CLIPType.STABLE_DIFFUSION
    )
    _release_clip()
    try:
        clip = comfy.sd.load_clip(
            ckpt_paths=[path],
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
            clip_type=clip_type_enum,
            model_options={},
        )
    except Exception as e:
        raise RuntimeError(
            "[Pixaroma] AI Prompt: \"%s\" could not be loaded as a language "
            "model.\n%s" % (name, _NEEDED)
        ) from e
    # NOTE: do NOT test hasattr(clip, "generate") here. ComfyUI's CLIP wrapper
    # ALWAYS has it - it delegates inward - so the check passes for a T5 and
    # the real failure surfaces later. The honest place is around the CALL.
    _CLIP_CACHE[key] = clip
    return clip


def _img(x):
    """An IMAGE input as plain RGB, or None if it is not actually an image.

    Two jobs, both earned on Video Prompt:

    1. An `optional` input is NOT type-guaranteed. Any ANY-type passthrough can
       put a list or a string here, and `x is not None` would then be True.
    2. DROP THE ALPHA. Qwen3-VL normalises exactly three channels and then
       reshapes patches using the real channel count, so a 4-channel RGBA image
       builds a 2048-wide patch against a 1536-wide vision tower and dies in a
       torch matmul - AFTER the 10 GB load. Remove Background Pixaroma returns
       genuine RGBA, so this is one wire away.
    """
    if getattr(x, "ndim", 0) != 4:
        return None
    try:
        if int(x.shape[-1]) > 3:
            return x[..., :3].contiguous()
    except (AttributeError, TypeError, ValueError, IndexError):
        # AttributeError because .contiguous() is torch-only: a numpy RGBA
        # batch has ndim 4 and a .shape, so it reaches the slice and dies on a
        # method it does not have. Refusing it is the point of this function.
        return None
    return x


def _audio(x):
    """An AUDIO input, or None if it is not one.

    Same rule as _img: the guard has to be inside a try, because on a
    non-mapping the membership test is itself the thing that raises.
    """
    try:
        if isinstance(x, dict) and "waveform" in x:
            return x
    except Exception:
        return None
    return None


class PixaromaAIPrompt:
    DESCRIPTION = (
        "Runs a language model you already have, on your own machine, using an "
        "instruction you save on the node. Wire in a picture, a video, some audio or "
        "text, type an idea, and it hands back text.\n\n"
        "The instruction is called the formula and it lives on this node, so every "
        "copy carries its own. That is what makes these chainable: put one after "
        "another and each does a different job, like describe this photo, then rewrite "
        "it in another style, then shorten it.\n\n"
        "With no model chosen it simply passes its text straight through, so you can "
        "drop it into a working graph and set it up afterwards without breaking "
        "anything. The banner on the node always says which it is about to do.\n\n"
        "Wire text in and it is joined with your idea, the same way Prompt Pixaroma "
        "joins its text input, and you choose which of the two comes first.\n\n"
        "Nothing is sent anywhere. It needs a model in your text_encoders folder, and "
        "a vision model if it has to look at a picture.\n\n"
        "Find it by searching for ai, prompt, llm, caption, or rewrite."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Everything the face shows rides in the hidden state blob, injected by
        # the browser at graphToPrompt time (Vue Compat #9). A required STRING
        # would render as a widget AND a convertible input dot.
        return {
            "required": {},
            "optional": {
                "clip": (
                    "CLIP",
                    {
                        "tooltip": "Optional. A model on a wire, from a CLIPLoader or "
                        "another node. While this is connected it is used instead of "
                        "the one picked in the settings, and Free VRAM is skipped "
                        "because that model is not this node's to unload."
                    },
                ),
                "image": (
                    "IMAGE",
                    {
                        "tooltip": "Optional. A picture for the model to look at. Needs "
                        "a vision model (a Qwen3-VL build); a text-only one accepts the "
                        "picture and silently ignores it."
                    },
                ),
                "video": (
                    "IMAGE",
                    {
                        "tooltip": "Optional. Video frames as an image batch. Assumed to "
                        "be 24 frames per second and sampled down to one per second "
                        "inside the model, so a long clip is fine."
                    },
                ),
                "audio": (
                    "AUDIO",
                    {
                        "tooltip": "Optional. Sound for the model to listen to. Needs a "
                        "model that can hear; most vision models cannot."
                    },
                ),
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": "Optional. Text from another node, joined with your "
                        "idea. Which one comes first is the segment in the node's slot "
                        "band, and its default is in the settings.",
                    },
                ),
            },
            "hidden": {"AIPromptState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "What the model wrote. With no model chosen this is your idea and any wired "
        "text joined together and passed through unchanged, so a chain keeps working "
        "while you are still setting it up.",
    )
    FUNCTION = "run"
    # Without this the node NEVER RUNS unless its output is wired into something
    # that eventually reaches a real output node - so pressing Generate on a
    # node you are still setting up would do nothing at all, silently. Measured:
    # the first live test queued fine and the readout stayed empty forever.
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"

    def run(self, clip=None, image=None, video=None, audio=None, text=None,
            AIPromptState="{}"):
        started = time.time()
        st = parse_state(AIPromptState)

        wired = as_text(text)
        has_clip = clip is not None

        # ---- the pass-through path ----------------------------------------
        if not will_generate(st, wired, has_clip):
            out = content_text(st["idea"], wired, st["order"], st["sep"])
            return {
                "ui": {
                    "pixaroma_ai_prompt": [{
                        "text": out,
                        "generated": False,
                        "status": status_line(st, wired, has_clip, False),
                        # So the face can tell the user when its own banner is
                        # lying: graphToPrompt DROPS an input whose origin node
                        # is muted or bypassed, so the wire can be there in the
                        # UI while Python never received a model.
                        "used_clip": has_clip,
                        "words": word_count(out),
                        "seconds": round(time.time() - started, 2),
                    }]
                },
                "result": (out,),
            }

        # ---- the generating path -------------------------------------------
        prompt = build_prompt(
            st["formula"], st["idea"], wired, st["order"], st["sep"]
        )

        own_clip = False
        if not has_clip:
            clip = _load_clip(st["model"], st["clip_type"])
            own_clip = True

        img = _img(image)
        vid = _img(video)
        aud = _audio(audio)

        # Byte-identical to core's TextGenerate. Do NOT wrap this in a
        # try/except TypeError "for safety": every tokenizer in the chain ends
        # in **kwargs, so nothing here CAN raise TypeError, and a fallback that
        # quietly dropped skip_template would change what the model is asked
        # without saying so. `image` is singular on purpose - that is what core
        # passes and what Qwen3VLTokenizer reads out of kwargs.
        tokens = clip.tokenize(
            prompt,
            image=img,
            skip_template=not st["use_default_template"],
            min_length=1,
            thinking=st["thinking"],
            video=vid,
            audio=aud,
        )

        try:
            generated_ids = clip.generate(
                tokens,
                do_sample=st["do_sample"],
                max_length=st["max_length"],
                temperature=st["temperature"],
                top_k=st["top_k"],
                top_p=st["top_p"],
                min_p=st["min_p"],
                repetition_penalty=st["repetition_penalty"],
                presence_penalty=st["presence_penalty"],
                seed=st["seed"],
            )
        except AttributeError as e:
            # Narrow on purpose. Without the gate this wrapped a multi-minute
            # generation and reported any version skew as "download a
            # different 10 GB model", with the real traceback hidden.
            if "generate" not in str(e):
                raise
            raise RuntimeError(
                "[Pixaroma] AI Prompt: \"%s\" is not a language model - it cannot "
                "write text. Pick a Qwen3-VL build instead.\n%s"
                % (st["model"] if own_clip else "the model on the clip wire", _NEEDED)
            ) from e

        out = clip.decode(generated_ids)
        out = out if isinstance(out, str) else str(out or "")

        # A reasoning model narrates before it answers, and that narration is
        # not the prompt. Plain Qwen3 - the Z-Image text encoder - does it even
        # with thinking off, so without this the node returns 380 words of
        # "Okay, the user wants me to ..." and the image model renders it.
        ran_out_thinking = reasoning_only(out)
        out = strip_reasoning(out)

        # The text is a plain string by now, so the model can go. Only ours -
        # a model that arrived on a wire belongs to a loader the user placed
        # and may be shared with the rest of the graph.
        if st["release_model"] and own_clip:
            _release_clip(clip)

        return {
            "ui": {
                "pixaroma_ai_prompt": [{
                    "text": out,
                    "generated": True,
                    # An empty answer because the model thought until it ran out
                    # of room needs its own words: the fix is Max len or a
                    # different model, and an unexplained empty box sends people
                    # rewriting a formula that was never the problem.
                    "status": ("this model reasons, and it used the whole Max len "
                               "thinking before it wrote anything - raise Max len, "
                               "or pick a model that does not reason")
                    if ran_out_thinking else status_line(st, wired, has_clip, True),
                    "used_clip": has_clip,
                    "words": word_count(out),
                    "seconds": round(time.time() - started, 2),
                }]
            },
            "result": (out,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaAIPrompt": PixaromaAIPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaAIPrompt": "AI Prompt Pixaroma"}
