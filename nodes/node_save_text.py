"""Save Text Pixaroma - collect text across runs, keep it on the node, mirror it
to a .txt file.

Deliberately a THIN node. It passes the text straight through and reports it to
the browser; the browser owns the collected buffer and does the file writing
through /pixaroma/api/save_text/write.

WHY the buffer is not handled here (this is the load-bearing design decision):

  The buffer would have to reach Python through a hidden state input (Vue Compat
  #9), which means it changes on EVERY run. A node whose inputs change is dirty,
  and ComfyUI invalidates everything downstream of a dirty node - so a Save Text
  dropped mid-chain in front of a sampler would re-run that sampler on every
  queue. The whole point of the `text` passthrough is that you CAN put it
  mid-chain, so that had to stay free.

  Keeping Python stateless also means this node caches normally, and that turns
  out to do the duplicate handling for free: queue the same prompt twice and the
  second run is cached, so no `executed` event fires and nothing is collected
  twice. Change the prompt and it runs. That is exactly the wanted behaviour and
  it costs no code. (The browser still has its own duplicate check, because a
  workflow reload clears ComfyUI's cache and the first run afterwards would
  otherwise re-add the last prompt.)

  Consequence, stated honestly: collecting happens while the workflow is open in
  a browser. A headless API run passes text through and writes no file.

So: do NOT add an IS_CHANGED here. `float("nan")` (Save Image's fix, for a node
that must always write a file) would make this node re-run every queue and drag
its downstream with it, which is the bug described above.
"""


class PixaromaSaveText:
    """Collect text from every run into one list you can edit, copy and save."""

    DESCRIPTION = (
        "Collects text across workflow runs. Each run adds what comes in to the "
        "list on the node, separated by a blank line, and the node mirrors that "
        "list to a .txt file so nothing gets lost. Edit the list, copy it, or "
        "clear it to start a new file. Clear never erases the file it already "
        "wrote: it moves on to the next name, so old collections are kept. The "
        "text also passes straight through the output, so the node can sit in "
        "the middle of a chain without changing anything. Useful for keeping the "
        "prompts an LLM generates, or any prompt you tried and want back later."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "The text to collect. Wire a prompt node, a Show "
                            "Text, or an LLM prompt generator here. Each run "
                            "adds one entry. If a run is cached because nothing "
                            "changed, nothing is added, so re-running the same "
                            "prompt does not fill the list with copies."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "The same text that came in, unchanged, so this node can sit in the "
        "middle of a chain. Collecting does not alter it.",
    )
    FUNCTION = "collect"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"
    # Needed or the node never runs when nothing is wired to its output - which
    # is the normal way to use it, parked off to the side collecting.
    OUTPUT_NODE = True

    def collect(self, text=None):
        # Any-type upstreams and list inputs can hand over something that is not
        # a string (see reference_optional_input_is_not_type_guaranteed): coerce
        # rather than raise, so one odd wire cannot fail a whole run.
        if text is None:
            out = ""
        elif isinstance(text, str):
            out = text
        elif isinstance(text, (list, tuple)):
            out = "\n".join(str(t) for t in text if t is not None)
        else:
            out = str(text)

        # The browser reads this and does the collecting. An empty run still
        # reports, so the node can show that it ran and found nothing.
        return {
            "ui": {"pixaroma_save_text": [{"text": out}]},
            "result": (out,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaSaveText": PixaromaSaveText}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSaveText": "Save Text Pixaroma"}
