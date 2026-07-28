// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - the canvas features                  ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Six Pixaroma features that add NO node at all: they patch the canvas itself.
// Because there is no node to select, the selection-toolbar Help button can
// never reach them, so until now they had nowhere to be documented. This
// browser is the only place they can live, which is a large part of why it
// exists.
//
// Same help-def schema as every node, so the article renderer treats them
// identically. They carry no wiring diagram (there are no slots to draw).

export const CANVAS_FEATURES = [
  {
    key: "canvas:align",
    title: "Align",
    tagline: "Nodes snap to line up with each other as you drag, with a guide showing what they lined up with.",
    keywords: "snap guides tidy arrange distribute straight neat messy line up",
    sections: [
      {
        heading: "What it does",
        body: "Drag any node and it snaps to line up with the nodes around it. A thin coloured guide shows what it caught on, so a graph stays tidy without you nudging anything into place by hand. Groups count too, and it works while resizing as well as moving.",
      },
      {
        heading: "Handy to know",
        bullets: [
          "Hold Shift while dragging to ignore snapping for that one move.",
          "The toolbar button turns it on and off, and lights up when it is on.",
          "How close an edge has to be before it snaps is in Settings, under the Pixaroma section.",
          "A pinned Pixaroma Group is left alone.",
        ],
      },
    ],
    footer: "Alt is not a bypass key here: ComfyUI already uses it to duplicate a node mid-drag.",
  },

  {
    key: "canvas:colors",
    title: "Node Colors",
    tagline: "Right-click any node or group to recolour it, with favourites and copy and paste.",
    keywords: "colour color recolour palette theme paint node group background",
    sections: [
      {
        heading: "What it does",
        body: "Right-click a node or a group and pick a colour from the Pixaroma palette. Colours are grouped by hue, so finding a particular green is quick.\n\nSelect several nodes first and the colour lands on all of them at once.",
      },
      {
        heading: "Favourites",
        body: "Save the pairs you use most and they sit at the top of the menu, so a workflow you colour the same way every time takes a couple of clicks rather than a hunt.",
      },
      {
        heading: "Copy and paste a colour",
        body: "Copy the colour from one node and paste it onto another, which is the fastest way to make a group of nodes match something you already got right.",
      },
    ],
    footer: "Node titles stay readable on any colour you pick, because Adaptive node titles chooses white or dark text for you.",
  },

  {
    key: "canvas:group",
    title: "Pixaroma Group",
    tagline: "A group container with Run, Mute, Bypass and Fold buttons built into its header.",
    keywords: "container box fold collapse organise organize tidy group run mute bypass",
    sections: [
      {
        heading: "What it does",
        body: "A box you draw around part of your workflow, with buttons in its header. Run just that section, mute it, bypass it, or fold the whole thing down to a single bar to get it out of the way.",
      },
      {
        heading: "Working with them",
        bullets: [
          "Drag the header to move the group and everything inside it.",
          "Drag any of the four corners to resize.",
          "Groups can sit inside other groups.",
          "Pin a group to lock it in place so a stray drag cannot move it.",
          "Align snapping works on groups too.",
        ],
      },
    ],
    footer: "This is a Pixaroma container, not ComfyUI's own group. That is what lets it carry buttons in the header.",
  },

  {
    key: "canvas:connfx",
    title: "Connection FX",
    tagline: "Compatible slots pull at your wire while you drag it, and sparkle when it connects.",
    keywords: "wire link drag sparkle magnet connect slot snap dot",
    sections: [
      {
        heading: "What it does",
        body: "While you are dragging a wire, every slot nearby that would actually accept it starts to glow, so you can see where the wire is allowed to go before you let go. When the connection lands, a small burst of sparks confirms it.",
      },
      {
        heading: "Handy to know",
        bullets: [
          "It is off by default. Turn it on in Settings, under the Pixaroma section.",
          "It costs nothing while it is off.",
          "Only slots of a matching type light up, so it doubles as a check that a wire will be accepted.",
        ],
      },
    ],
    footer: "Useful when you are learning which outputs fit which inputs, and pretty enough to leave on afterwards.",
  },

  {
    key: "canvas:titles",
    title: "Adaptive node titles",
    tagline: "Title text picks white or dark by itself so it stays readable on any colour.",
    keywords: "readable contrast title text white dark colour color legible",
    sections: [
      {
        heading: "What it does",
        body: "When you colour a node, the title text works out whether white or dark reads better against that colour and switches automatically. A pale yellow node gets dark text, a deep blue one gets white.",
      },
      {
        heading: "Handy to know",
        body: "It is on by default. Turn it off in Settings and titles go back to ComfyUI's usual grey, which can be hard to read on a light node colour.",
      },
    ],
    footer: "This is why you can recolour freely without ever ending up with a title you cannot read.",
  },

  {
    key: "canvas:runfx",
    title: "Run button effects",
    tagline: "A choice of visual effects on ComfyUI's Run button.",
    keywords: "queue button animation fun effect run sparkle rocket flash",
    sections: [
      {
        heading: "What it does",
        body: "Adds an effect to the Run button: a Pixaroma orange tint, a flash, sparkles, a rocket, and a few more. Purely decorative, and it never gets in the way of actually queueing a run.",
      },
      {
        heading: "Handy to know",
        body: "Pick one in Settings, under the Pixaroma section. The default is None, which costs nothing at all.",
      },
    ],
    footer: "Entirely optional. Pick whichever makes pressing Run more enjoyable, or leave it off.",
  },
];
