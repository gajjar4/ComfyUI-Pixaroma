// AI Prompt Pixaroma - help. Convention #16: registering this is what makes
// the orange ? appear in the node selection toolbar and gives the node a page
// in the Help browser. Written for an artist, not a programmer.
//
// It deliberately covers the two questions that are impossible to answer by
// looking at the node - what a duplicate carries, and whether two nodes load
// the model twice - because getting either wrong wastes real time and memory.

export const AI_PROMPT_HELP = {
  title: "AI Prompt Pixaroma",
  tagline: "Run a language model on your own machine with an instruction you save on the node.",
  sections: [
    {
      heading: "What it does",
      body:
        "You give this node a model and an instruction, wire in whatever you have, "
        + "and it hands back text.\n\n"
        + "The instruction is called the formula. You write it once in the settings "
        + "and it stays on the node, so the node becomes a step that always does the "
        + "same job: describe a photo, rewrite a prompt in another style, turn a rough "
        + "note into a finished one.\n\n"
        + "Everything runs on your own machine using a model in your ComfyUI "
        + "models/text_encoders folder. No account, no key, nothing sent anywhere.\n\n"
        + "It is the general-purpose sister of Video Prompt Pixaroma. That one knows "
        + "about MiniMax H3 and gives you durations and a frame count. This one knows "
        + "about nothing in particular, which is what lets you point it at any job.",
    },
    {
      heading: "The one rule worth learning",
      body:
        "Everything the model is asked is one piece of text: the formula, then your "
        + "idea, then anything wired into the text input.\n\n"
        + "A node with no model chosen does not fail. It passes its text straight "
        + "through, unchanged, and the banner says so. That is deliberate: you can "
        + "drop one into a graph that is already working and set it up afterwards "
        + "without breaking anything downstream.\n\n"
        + "A node with no formula still runs. The model just gets your idea by "
        + "itself, which is exactly what you want for a quick \"make this more "
        + "cinematic\".",
      table: {
        headers: ["Model", "Formula", "Idea or wired text", "What happens"],
        rows: [
          ["none", "anything", "anything", "Passes the text through unchanged"],
          ["chosen", "empty", "empty", "Passes it through: there is nothing to ask"],
          ["chosen", "empty", "present", "Runs, with your idea alone"],
          ["chosen", "written", "empty", "Runs on the formula alone, useful with a picture"],
          ["chosen", "written", "present", "Runs. The normal case"],
        ],
      },
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["The gear", "Opens the settings: the model, the formula, and how wired text is joined. It sits in the empty space beside the input dots so it costs the node no height."],
        ["The seed, and F or R", "F is Fixed: the same seed every Run, so an unchanged node is cached and Run is instant. R is Random: a new seed each Run, so it writes something different every time. Click the number to type one."],
        ["Idea first, Wired first", "Only appears when something is wired into the text input. It decides which of the two comes first. The starting choice is in the settings."],
        ["Expand", "Opens your idea in a full-screen box, for when it is long."],
        ["The bar between the two boxes", "Drag it to give more room to whichever box you are using. Double-click resets it."],
        ["Re-roll", "Rolls a new seed and runs again, so you get a different answer without changing anything you wrote."],
        ["Copy", "Copies the text it wrote."],
        ["Free VRAM", "Unloads the model as soon as the text is written, so a video model later in the workflow gets the memory back. Read the memory section below before turning it on in a chain."],
        ["Generate", "Runs the workflow."],
      ],
    },
    {
      heading: "Chaining several of them",
      body:
        "The output is plain text and the text input takes plain text, so these "
        + "stack with no glue in between. Each one does a different job because each "
        + "one carries its own formula.\n\n"
        + "A worked example: a Load Image goes into one node whose formula is "
        + "\"describe this photo as a short video prompt\". Its text goes into a "
        + "second node whose formula is \"rewrite this in the style of a 90s anime "
        + "cel\". Meanwhile a Load Audio goes into a third whose formula is \"name "
        + "the mood of this music in five words\", and that text also joins the "
        + "second node. Four wires, no other nodes.\n\n"
        + "Rename each node to what its formula does and the graph reads as a "
        + "sentence. Double-click the title to rename it.",
    },
    {
      heading: "What happens when you duplicate one",
      body:
        "A duplicate carries everything: the model, all the sampling settings, the "
        + "seed and its mode, and the formula. They all live on the node, so a copy "
        + "is a complete independent one.\n\n"
        + "That matters most for the formula. Editing it on the copy afterwards does "
        + "NOT change the original, which is what makes a chain of three possible. "
        + "It also means a workflow you share carries its instructions with it, so "
        + "whoever opens it sees the same wording you used.\n\n"
        + "This is the one real difference from Video Prompt Pixaroma, whose "
        + "formulas are shared files: change one there and every copy changes.",
    },
    {
      heading: "Two nodes, one model: does it load twice?",
      body:
        "No. The model is shared by every AI Prompt node in the workflow.\n\n"
        + "Two nodes naming the same file means one load and one copy in memory. "
        + "The second node finds it already there and starts writing straight away.\n\n"
        + "Two nodes naming DIFFERENT models take turns. Only one is kept, so the "
        + "second unloads the first and puts itself there instead, and they swap back "
        + "and forth on each run. That is deliberate: holding two ten-gigabyte models "
        + "at once is worse than loading one twice, especially on a 12 GB card. If "
        + "you are mixing models in a chain, expect the first run to be slow.\n\n"
        + "The best trick for a chain is Fixed seeds. With the seed on F and nothing "
        + "changed, ComfyUI serves the whole node from its cache on the second Run, "
        + "so nothing loads at all and the run goes straight to your image or video.",
    },
    {
      heading: "Free VRAM in a chain: the one trap",
      body:
        "Free VRAM unloads the model the moment THAT node finishes. So if an early "
        + "node in a chain has it on and a later node wants the same model, the "
        + "later one has to load it all over again in the same run.\n\n"
        + "The rule is simple: turn Free VRAM on only for the LAST node that uses "
        + "that model, usually the one feeding your image or video. Leave it off on "
        + "the ones before it.\n\n"
        + "It is skipped entirely when a model comes in on the clip wire, because "
        + "that model belongs to the node feeding it and may be shared with the rest "
        + "of your workflow. The button dims to show it is doing nothing.",
    },
    {
      heading: "Writing a good formula",
      bullets: [
        "Say what you want back, not what you want it to think about. \"Write one paragraph describing this photo as a video prompt\" beats \"analyse this photo\".",
        "Say how long. Models write far more than you expect unless you tell them a length.",
        "Say what NOT to include. \"Do not write a title, a preamble, or any explanation, only the prompt itself\" saves a lot of tidying up.",
        "Give it one example of a good answer if the shape matters. A small model copies the example far more reliably than it follows the rules.",
        "Leave the changeable part out of the formula and type it into Your idea instead. That way one node handles every picture you throw at it.",
      ],
    },
    // NO "what you can wire in" section here on purpose. The Help browser
    // GENERATES that reference from this node's own Python tooltips
    // (help-browser.md #7), so writing one as well prints the same thing
    // twice and the two copies drift apart the first time an input changes.
    {
      heading: "What you need installed",
      body:
        "One language model in ComfyUI/models/text_encoders. For anything that has "
        + "to look at a picture it must be a vision model.\n\n"
        + "The one the Pixaroma formulas were measured against is "
        + "`qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors`, about 10 GB, for cards "
        + "with 12 GB or more. Take it from the comfyui folder of that repository, "
        + "not the root: the root holds the raw model, which ComfyUI cannot load as a "
        + "text encoder. For an 8 GB card use the 4B build instead.\n\n"
        + "The picker marks any file that does not look like a vision model. It does "
        + "not block them, because a text-only model is the right choice for a step "
        + "that only rewrites text, and it is a lot smaller and quicker.",
    },
    {
      heading: "If something looks wrong",
      defs: [
        ["It hands back my own words unchanged", "No model is chosen, or there is nothing to send. The banner says which."],
        ["It describes a picture it cannot have seen", "The model is text-only. It accepts the picture and ignores it, silently. Pick one the list marks as a vision model."],
        ["Run does nothing and the text never changes", "The seed is Fixed and nothing else changed, so ComfyUI is serving the cached answer. That is the point of Fixed. Press Re-roll, or switch the seed to R."],
        ["It writes far too much", "Say a length in the formula, and lower Max len in the settings so it cannot run on."],
        ["Every run reloads the model", "Two nodes in the workflow are using different models. Give them the same one if you can."],
        ["The settings panel will not close", "Click the gear again, press Escape, or click the canvas."],
      ],
    },
  ],
};
