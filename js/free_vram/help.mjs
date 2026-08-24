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
      heading: "Reading the bar",
      // A REAL bar, not a description of one. Naming the three colours in prose
      // was already here and still did not land, because the words were not the
      // thing (free-vram.md #11b).
      bar: {
        caption: ["0 GB", "the whole card", "24 GB"],
        segments: [
          { pct: 51.7, color: "#4d4d4d", value: "12.4 GB", label: "still in use" },
          { pct: 35, color: "#f66744", value: "8.4 GB", label: "this node just freed" },
          { pct: 13.3, color: "#2f2f2f", value: "3.2 GB", label: "was already free" },
        ],
        note: "Everything to the RIGHT of the grey is free memory: 8.4 + 3.2 = 11.6 GB free. "
            + "The three parts always add up to the whole card.",
      },
      body:
        "The whole bar is your whole graphics card. It never changes length: what changes is how "
        + "it is divided. Left to right it is always used, then what this node released, then "
        + "what was already free.\n\n"
        + "The one rule: everything to the RIGHT of the grey is free memory, and the orange is "
        + "the part of it you gained by adding this node. A wide orange band means it did real "
        + "work. A sliver means it barely helped, so something else is holding the card and the "
        + "node is probably in the wrong place. No orange at all means there was nothing loaded "
        + "to let go of.\n\n"
        + "Hover the bar for the four figures as text.",
      defs: [
        ["Grey", "Still in use after the cleanup. This is the card minus whatever is free now."],
        ["Orange", "What this node just released: how much was free afterwards, minus how much "
          + "was free before."],
        ["Dark", "What was already free before it ran. Nothing to do with this node, it is just "
          + "the room you already had."],
      ],
    },
    {
      heading: "Reading the line underneath",
      body:
        "Two figures answering two different questions. The orange one is what THIS NODE did. "
        + "The grey one beside it is where you STAND NOW, which is the figure that decides "
        + "whether the next stage fits.\n\n"
        + "So `freed 8.4 GB` next to `11.6 GB free of 24` means the node handed back 8.4 GB, and "
        + "11.6 GB of your 24 GB card is free as a result. That second figure is the orange and "
        + "the dark parts of the bar added together: everything to the right of the grey.\n\n"
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
        + "is already free. When it skips, the face says skipped.\n\n"
        + "Worth turning on once a workflow is settled. Letting go of a model you did not need "
        + "to let go of costs you the time to load it back, so on a run where there was plenty "
        + "of room anyway the node is pure delay.\n\n"
        + "The number to set is not about your card. It is about the NEXT thing that has to "
        + "load: set the limit to roughly the size of the model waiting downstream, so the node "
        + "acts when that model would not fit and stays out of the way when it would. If you do "
        + "not know the size, the file on disk is close enough.",
    },
    {
      heading: "What to set the limit to",
      body:
        "Run the workflow once with the limit OFF and read the bar. The number you want is a "
        + "little more than the grey part, because the grey is what the next stage will be "
        + "asking for.\n\n"
        + "As a starting point, by card:",
      table: {
        headers: ["Your card", "Try a limit of", "Because"],
        rows: [
          ["8 GB", "6 GB",
           "Almost nothing fits twice, so you want it firing on nearly every run. A low limit "
           + "here mostly protects you from the pointless case where the workflow only ran a "
           + "small model."],
          ["12 GB", "8 GB",
           "Enough room for one big model but not two. Fires whenever a real model is still "
           + "resident, skips when only a VAE or an upscaler was used."],
          ["16 GB", "10 GB",
           "A common SDXL or Flux setup. Leaves the node quiet on light runs and acting before "
           + "anything large loads."],
          ["24 GB", "12 GB",
           "You can usually hold one big model with room to spare, so only bother when half the "
           + "card is gone. Raise it towards 16 GB if you run video models."],
          ["32 GB and up", "half the card",
           "At this size the limit is only there to stop needless reloads. Set it to half and "
           + "forget it."],
        ],
      },
      bullets: [
        "Higher limit means it acts more often. Lower means it acts less.",
        "Set it too high and it fires on every run, which is the same as leaving the limit off.",
        "Set it too low and it never fires, and you are back to the out of memory error it was "
          + "meant to prevent.",
        "Two stages of similar size on one card is the case where this matters most: set the "
          + "limit just above what stage two needs.",
      ],
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
