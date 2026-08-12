// Video Prompt Pixaroma - help. Convention #16: registering this is what
// makes the orange ? appear in the node selection toolbar and gives the node a
// page in the Help browser. Written for an artist, not a programmer.

export const VIDEO_PROMPT_HELP = {
  title: "Video Prompt Pixaroma",
  tagline: "Write a MiniMax H3 video prompt on your own machine, in one node.",
  sections: [
    {
      heading: "What it does",
      body:
        "MiniMax H3 wants its prompts written in a particular shape, with named " +
        "sections, a soundscape, music, and a strict way of writing anything a " +
        "person says out loud. Getting that right by hand is fiddly, and getting it " +
        "wrong quietly spoils the clip.\n\n" +
        "This node does it for you. You type your idea in plain words, choose how " +
        "long the video should be, and press Generate. It hands back a finished H3 " +
        "prompt, plus the frame count to render it at.\n\n" +
        "It runs entirely on your own machine using a small language model you " +
        "already have, so there is no account, no key and nothing sent anywhere.",
    },
    {
      heading: "It changes what it writes based on what you wire in",
      body:
        "You do not pick a mode. The node works it out from the pictures you give it, " +
        "and the banner at the top always says which one it is using.",
      defs: [
        ["Nothing wired", "Text to video. It invents the whole scene from your idea."],
        ["A first frame wired", "It looks at that picture, describes what is really in it, and animates it."],
        ["A first and a last frame wired", "It writes the journey from one picture to the other. It joins the two pictures together for you, so they can never end up the wrong way round."],
      ],
    },
    {
      heading: "Writing a good idea",
      bullets: [
        "Plain words are enough. \"a blacksmith hammers glowing steel in a dark forge\" is a complete idea.",
        "If someone speaks, put the spoken words at the END of your idea. Anything written after them tends to be delivered instead of the line itself.",
        "Do not describe the camera in words like drone or close-up unless you mean it. The node knows how to turn those into real camera moves.",
        "Longer clips need a fuller idea. One short sentence does not contain fifteen seconds of things happening.",
      ],
    },
    {
      heading: "Length",
      body:
        "The length buttons do far more than set a number. Each one carries its own " +
        "instructions about how much to write and how many things should happen, and " +
        "that is the single setting that changes the result most.\n\n" +
        "One thing worth knowing: at 5 seconds the model reliably drops spoken lines. " +
        "If your idea has someone talking, use 8 seconds or more. The node marks the " +
        "5 second button when it notices speech in your idea, but it still lets you " +
        "pick it.",
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["Generate", "Runs the workflow and writes the prompt."],
        ["Re-roll", "Picks a new seed and generates again. This is what to press when a result comes out flat."],
        ["Copy", "Puts the finished prompt on the clipboard."],
        ["Free VRAM", "A switch, not a button. Off while you are only writing prompts, so generating again is instant. Turn it on when this node sits in the same workflow as your H3 video model: the language model is unloaded as soon as the prompt is written, handing the memory over to the video. Your prompt is already finished by then, so nothing is lost. On one machine this freed about 17 GB."],
        ["The seed chip", "Click the number to type one. Click the F or R beside it to switch between Fixed, which gives the same prompt every time, and Random, which gives a fresh one on every run."],
        ["The gear", "Opens the settings, where the formulas and the length instructions live."],
      ],
    },
    {
      heading: "What comes out",
      defs: [
        ["text", "The finished prompt. Wire it into your H3 node."],
        ["frames", "How long to render, already adjusted to the pattern H3 accepts. Wire this into your H3 node's length input so the video is exactly as long as the prompt was written for. Getting those two out of step is the easiest way to spoil a clip."],
        ["seconds", "The true length in seconds, for anything that has to line up with the video, such as an audio track."],
      ],
    },
    {
      heading: "Settings",
      body:
        "The gear opens a panel with the wording the node follows: one formula for " +
        "each of the three cases, and the length instructions for each duration. You " +
        "can edit any of them and put the original back at any time. Your edits are " +
        "kept outside the plugin folder, so updating Pixaroma never overwrites them.\n\n" +
        "Export saves everything to one file, which is the easy way to share your " +
        "wording with somebody else or move it to another machine.",
    },
    {
      heading: "What you need installed",
      body:
        "One vision language model, in your ComfyUI/models/text_encoders folder. " +
        "It has to be a VISION model, because the first-frame modes need to " +
        "actually see the picture. A text-only model will load and then quietly " +
        "ignore your images.\n\n" +
        "You do not have to choose one. If the model named in the settings is not " +
        "on your machine, the node picks the best vision model it can find and " +
        "tells you in the console which one it used.",
      defs: [
        ["The one everything was measured against",
         "`qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors`, 10 GB. Every formula and every duration in this node was written and tested against it. Best choice for a 12 GB card or better. Take it from the `comfyui` folder of that repo, not the root: the root holds the raw model, which ComfyUI cannot load as a text encoder."],
        ["For an 8 GB card",
         "`qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors`, 4.8 GB, at the root of the 4B repo. It works, and it follows the formulas less closely, so expect to trim its output or re-roll more often."],
        ["If you would rather not use an uncensored build",
         "Comfy-Org publishes plain Qwen3-VL text encoders. They follow the formulas fine; they just refuse more often on anything spicy."],
        ["Where the file goes",
         "`ComfyUI/models/text_encoders`. Then pick it from the gear on the node, or leave it and the node will find it by itself."],
      ],
      links: [
        ["Qwen3-VL 8B Heretic, ComfyUI files (the tested one)", "https://huggingface.co/DreamFast/Qwen3-VL-8B-Heretic-1.3.0/tree/main/comfyui"],
        ["Qwen3-VL 4B Heretic for ComfyUI", "https://huggingface.co/DreamFast/Qwen3-VL-4b-Heretic-ComfyUI/tree/main"],
        ["Qwen3-VL text encoders from Comfy-Org", "https://huggingface.co/Comfy-Org/Qwen3-VL/tree/main/text_encoders"],
      ],
    },
    {
      heading: "Using a Load CLIP node instead",
      body:
        "The clip input is optional. Wire a Load CLIP node into it and that model " +
        "is used instead of the one in the settings, which is handy when several " +
        "of these nodes should share one loaded model.\n\n" +
        "When a wire is present the settings show \"using the wired CLIP\" and the " +
        "picker is greyed out, so the panel can never claim one model while " +
        "another is doing the work. Load CLIP's own type dropdown does not matter " +
        "here; what matters is that the file is a vision model.\n\n" +
        "One thing to know: with a wire in place the Free VRAM switch does nothing. " +
        "That model belongs to your Load CLIP node and may be shared, so it is not " +
        "this node's to unload.",
    },
  ],
};

export const VIDEO_PROMPT_KEYWORDS = [
  "h3", "minimax", "minimax h3", "prompt", "prompt writer", "llm", "qwen",
  "text to video", "first frame", "last frame", "fflf", "video prompt",
  "write prompt", "prompt generator", "local llm", "vision model",
];
