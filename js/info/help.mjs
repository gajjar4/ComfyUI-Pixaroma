// Info Pixaroma - help for the selection-toolbar ? and the Help browser.
// Plain words for an artist, no em dashes (house rules).

export const INFO_HELP = {
  title: "Info Pixaroma",
  tagline: "A small button on the canvas that opens a note to read.",
  sections: [
    {
      heading: "What it does",
      body: "Info turns a workflow note into a button. The canvas stays clean: instead of big notes around the graph, you see small buttons like Read me, Models or Run times, and a click opens the note in a reading window.\n\nThe note is the same rich text Note Pixaroma makes: headings, lists, icons, tables, code, and Download, YouTube and Discord buttons.",
    },
    {
      heading: "How to use",
      bullets: [
        "Add the node. A small popup offers starters: pick one to set the title, icon, colour and the empty headings of that kind of note, or close it for a plain Info button.",
        "Click the button to read the note. Drag the reading window by its title bar; Esc or the X closes it.",
        "To change the note or the button, press Edit in the reading window, or right-click the button and choose Edit.",
        "Drag the button's corner to make it bigger or smaller. The text and icon grow with it.",
      ],
    },
    {
      heading: "The editor",
      defs: [
        ["Title", "The text on the button."],
        ["Icon", "One of the Pixaroma icons. They ship with Pixaroma, so a shared workflow shows the same icon on every PC."],
        ["Colour", "The button colour. The text turns dark on a light colour so it stays readable."],
        ["The note", "Everything below the strip is the Note Pixaroma editor. Save keeps both the note and the button."],
      ],
    },
    {
      heading: "The starters",
      defs: [
        ["Read me", "What the workflow does, how to use it, what you need."],
        ["Models", "The files to download and the folder each one goes in."],
        ["Nodes", "Custom nodes to install, what each node does, which ones to change."],
        ["Settings", "The best settings and the sizes that work."],
        ["Prompt tips", "How to write a prompt, examples, words that help."],
        ["Run times", "Time per size, VRAM and RAM, what to change on a smaller card."],
        ["Tips", "Tips and what works best."],
        ["Attention", "Things to check before Run, known problems and fixes."],
        ["Links", "The video, the model page, the community."],
        ["Blank", "An empty note."],
      ],
    },
  ],
  footer: "A starter only fills the note when it is empty, so it never replaces what you wrote. Right-click the button and choose Start from to use one later. The node never runs during a workflow.",
};
