// Free VRAM Pixaroma - the help shown by the orange ? in the selection toolbar
// and in the full Help browser. Written for someone making pictures, not for
// someone reading the code.

export const FREE_VRAM_HELP = {
  title: "Free VRAM Pixaroma",
  tagline: "Hand the graphics card's memory back, at the exact point you choose.",
  sections: [
    {
      heading: "What it is for",
      body:
        "A workflow with two heavy stages tends to fail on the second one. The first model is "
        + "still sitting in the card's memory when the second is asked for, there is nowhere to "
        + "put it, and the run stops with an out of memory error.\n\n"
        + "Put this node on the wire between the two stages and the first model is let go before "
        + "the second is loaded. Whatever you wire in comes straight back out unchanged, so it "
        + "drops into any wire without altering the picture, the text or the numbers passing "
        + "through it.",
    },
    {
      heading: "Where to put it",
      body:
        "Only the INPUT matters. Take the wire from whatever you want cleaned up after and drop "
        + "it on this node, and it acts once that thing has been made. To free after the VAE "
        + "decode, drag from the VAE Decode output onto this node and stop there. The output "
        + "does not need connecting.\n\n"
        + "Connect the output as well when a particular later step has to find the room already "
        + "made. The value then passes through this node on its way there, which pins the "
        + "cleanup between the two.\n\n"
        + "Leaving the output free is also the cheaper of the two: nothing downstream means "
        + "nothing whose saved results this node can disturb, which matters once you have read "
        + "Free on every run below.\n\n"
        + "A node with nothing wired in does nothing at all, and says so on its face.",
      defs: [
        ["Input only", "Frees after the thing you dragged from. Simplest, and it disturbs no "
          + "cached results anywhere in the workflow."],
        ["Input and output", "Frees BETWEEN two steps, so the next one is guaranteed to find "
          + "the room already made. Everything after it then re-runs each time."],
      ],
    },
    {
      heading: "The three buttons",
      defs: [
        ["All", "Lets go of the models AND hands the spare memory back to the card. This is the "
          + "one you want when the next stage needs the room."],
        ["Models", "Lets go of the models but lets ComfyUI keep the memory it has reserved. A "
          + "little faster than All, and enough when it is only ComfyUI itself that needs room."],
        ["Cache", "Keeps the models loaded and only hands the spare memory back to the card. Use "
          + "this when something OUTSIDE ComfyUI wants the card: a game, a video editor, a "
          + "second ComfyUI. Inside ComfyUI it changes almost nothing, because that spare memory "
          + "was already available to it."],
      ],
    },
    {
      heading: "Reading the node",
      body:
        "The bar is the whole card. Grey is still in use, orange is what this node just "
        + "released, and the dark part was already free before it ran. Hover it for the exact "
        + "numbers.\n\n"
        + "Underneath, the line says how much came back and how much of the card is free now. "
        + "With Cache it says returned rather than freed, because that memory went back to the "
        + "card rather than becoming newly available to ComfyUI.",
    },
    {
      heading: "Free on every run",
      body:
        "This one is worth understanding, and it lives behind the gear.\n\n"
        + "Normally ComfyUI skips a node when nothing above it changed. That is exactly the "
        + "situation this node exists for: you adjust only the second stage, so the first stage "
        + "is skipped, so nothing lets go of the model the first stage left behind, and you get "
        + "the out of memory error anyway.\n\n"
        + "So the switch is on by default and the node always acts. The cost is that everything "
        + "wired AFTER it has to run again too, because ComfyUI can no longer tell that this "
        + "node produced the same thing as last time. Turn it off if you would rather keep those "
        + "cached results and accept that the cleanup sometimes gets skipped.",
    },
    {
      heading: "Only when memory is low",
      body:
        "Also behind the gear. Set a limit and the node does nothing while more than that much "
        + "is already free.\n\n"
        + "Worth turning on once a workflow is settled. Letting go of a model you did not need "
        + "to let go of costs you the time to load it back, so on a run where there was plenty "
        + "of room anyway the node is pure delay. When it skips, the face says so.",
    },
    {
      heading: "Good to know",
      bullets: [
        "It never changes what passes through it. An image in is the same image out.",
        "Freeing costs time on the next run, because the model has to load again. Use it where "
          + "you need it, not everywhere.",
        "Several of these on one canvas is fine, and each keeps its own settings.",
        "It runs whether or not the output is connected, so it is never quietly doing nothing "
          + "unless you left the input empty.",
        "Monitor Pixaroma shows the same numbers live, and has a Free VRAM button for when you "
          + "want to do it by hand rather than as part of a run.",
      ],
    },
  ],
  // No `links` block: that key is SECTION level and takes [label, url] pairs
  // for real web addresses, not a node reference. The Monitor mention above is
  // a plain sentence on purpose.
};
