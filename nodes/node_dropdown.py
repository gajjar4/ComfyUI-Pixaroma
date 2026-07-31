"""Dropdown Pixaroma - a list you write, one value out.

Thin wrapper. All the real logic is pure and lives in _dropdown_helpers.py so
it can be tested without ComfyUI.
"""

from ._dropdown_helpers import selected_value
from ._type_helpers import ANY


class PixaromaDropdown:
    DESCRIPTION = (
        "A dropdown you fill in yourself. Each entry has a short name and the value it stands "
        "for, so you pick 'top left' instead of pasting a whole sentence every time. Handy for "
        "LoRA trigger words, favourite sizes, step counts, or any value you retype often.\n\n"
        "Open the settings from the gear on the node, add your entries, and choose what the node "
        "sends out: text, a whole number, a decimal, or on/off. The output dot renames itself to "
        "match, so you can see at a glance what will come out.\n\n"
        "It ignores whatever it is plugged into: the list and the type are yours, set on the "
        "node. That is the difference from Control Panel Pixaroma, whose controls copy the type "
        "of the input they are wired to.\n\n"
        "The list is saved inside the workflow, so sending someone the workflow sends your "
        "entries with it. Export and Import move a list between workflows.\n\n"
        "Find it by searching for dropdown, list, options, preset, choose, pick, or trigger."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Hidden, not required: a required STRING would show as a widget AND as
        # a convertible input dot in the Vue frontend (Vue Compat #9). The
        # browser injects the real value at graphToPrompt time.
        return {
            "required": {},
            "hidden": {"DropdownState": ("STRING", {"default": "{}"})},
        }

    # ANY, exactly as Control Panel declares its outputs. The TYPED appearance
    # is a frontend concern: js/dropdown/ sets node.outputs[0].type so LiteGraph
    # refuses an incompatible drag on the canvas. There is no second, server-side
    # type check behind that - same as Switch and Control Panel.
    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("value",)
    OUTPUT_TOOLTIPS = (
        "The value behind the entry you picked. What kind of value it is follows the type set "
        "on the node: text, a whole number, a decimal, or on/off.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔢 Values"

    def run(self, DropdownState="{}"):
        return (selected_value(DropdownState),)


NODE_CLASS_MAPPINGS = {"PixaromaDropdown": PixaromaDropdown}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaDropdown": "Dropdown Pixaroma"}
