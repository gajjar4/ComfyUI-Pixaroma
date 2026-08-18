// Music Prompt Pixaroma - the help page.
//
// Registered here rather than centrally because it is long enough to want to
// live beside the node it describes (Image Compare, Text, XY Plot and Find and
// Replace do the same). The comfyClass key MUST match NODE_CLASS_MAPPINGS.

import { registerNodeHelp } from "../shared/help.mjs";
import { CLASS } from "./core.mjs";

registerNodeHelp(CLASS, {
  title: "Music Prompt Pixaroma",
  tagline: "One idea in, a caption and lyrics out for MiniMax Music 3.",
  sections: [
    {
      heading: "What it does",
      body:
        "A music model needs two different pieces of writing. The caption "
        + "describes how the song should SOUND: the genre, the tempo, the key, "
        + "what the voice is like and which instruments play. The lyrics are the "
        + "words that actually get sung.\n\n"
        + "This node writes both from one idea. It runs a language model you "
        + "already have, on your own machine, twice on a single load: once for "
        + "the caption and once for the lyrics. Nothing is sent anywhere.\n\n"
        + "Wire `caption` and `lyrics` straight into MiniMax Music 3 Text Encode, and "
        + "`duration` into its `max_duration`. That last wire means you set the length "
        + "ONCE, here, where the words are written for it.",
    },
    {
      heading: "Getting started",
      bullets: [
        "Put a language model in your ComfyUI/models/text_encoders folder. This "
        + "node only reads and writes words, so it does NOT need a vision model.",
        "Press the gear on the node and pick it. Both formulas were measured on "
        + "qwen3.5_4b_int8_convrot.",
        "Type your idea in plain words, like a slow acoustic song about coming "
        + "home in the rain.",
        "Set the length, then press Generate.",
      ],
    },
    {
      heading: "Length, and the duration wire",
      body:
        "The music model treats length as a CEILING. It can end a song early, "
        + "but anything past the limit is simply cut off part way through. So a "
        + "lyric written for three minutes against a thirty second setting gets "
        + "chopped.\n\n"
        + "Wire the `duration` output into the music node's `max_duration` and the two "
        + "can never disagree. The highest it accepts is 360 seconds.\n\n"
        + "A song can still come out shorter than you asked. That is the music model "
        + "stopping when the words run out, not a fault: it only sings what it was "
        + "given. Measured over ten songs, nine used the whole length and one stopped "
        + "at three quarters, because that seed happened to write half as many lines.\n\n"
        + "If a song comes out short, press Re-roll. How many lines get written varies "
        + "from one seed to the next, and a fresh seed usually fills the time.",
    },
    {
      heading: "Verses are a request, not a promise",
      body:
        "Left on Auto, the length alone decides the shape, and that is the most "
        + "reliable way to run it. Under forty seconds you get a verse and a "
        + "chorus. Around a minute adds a second verse. Around two minutes adds "
        + "a bridge and a final chorus.\n\n"
        + "Up to about a minute and a half, Auto states that shape outright "
        + "rather than leaving the model to work it out, because that is where it "
        + "was measured to get it wrong in both directions: minute-long songs kept "
        + "coming back with the single verse of a thirty second one, and thirty "
        + "second songs kept opening with an instrumental section they had no room "
        + "for. Saying it plainly took the first from three runs in five to five "
        + "in five, and the second from one in four to four in four.\n\n"
        + "Longer than that, Auto says nothing, because there it already gets it "
        + "right and naming a number made it worse.\n\n"
        + "Ask for a number instead and the model usually obeys, but not always. "
        + "One and two come back exactly as asked. Three sometimes comes back as "
        + "two. That is why the chips stop at three: asking for more does not "
        + "get you more.\n\n"
        + "Asking for verses also OVERRIDES the length shape, so three verses at "
        + "three minutes gives a shorter song than three minutes on Auto would.",
      defs: [
        ["Auto", "The length decides everything. The most dependable setting."],
        ["1 to 3", "Ask for that many verses, each with a chorus."],
        ["Bridge", "Ask for a bridge: one different section, usually near the end."],
        ["Instr.", "Ask for a section where the band plays and nobody sings. It "
          + "still uses up time."],
      ],
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["Caption / Lyrics", "Which of the two you are looking at. Both are "
          + "written every run, this only picks what the box shows."],
        ["Expand", "Write the idea in a full screen box."],
        ["The bar between the boxes", "Drag it to give the idea more or less "
          + "room. Double click puts it back."],
        ["The seed", "Click the number to type one. F keeps the same seed, so an "
          + "unchanged node is cached and Run is instant. R rolls a new one every "
          + "run, so every run is a different song."],
        ["Re-roll", "A new seed, then run again. The quickest way to try another "
          + "version of the same idea."],
        ["Copy", "Copies whichever of the two you are looking at."],
        ["Free VRAM", "Unloads the model when this node finishes. Turn it on when "
          + "a music model has to fit in the same card afterwards."],
        ["Generate", "Queues the whole workflow, the same as pressing Run."],
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "With no model chosen it passes your text straight through to both "
        + "outputs, so you can drop it into a working graph and set it up "
        + "afterwards without breaking anything. The banner always says which it "
        + "is about to do.",
        "Two runs on one load is why it takes about twice as long as a single "
        + "prompt node. The model is only loaded once.",
        "The lyrics are written knowing the caption, so the words match the mood "
        + "the caption just described.",
        "Wire a model into the clip input and it is used instead of the one in "
        + "the settings. Free VRAM is skipped then, because that model belongs to "
        + "the loader you placed.",
        "The wording of both instructions is built in and was measured rather "
        + "than guessed, so there is no formula to write. If you want to write "
        + "your own, AI Prompt Pixaroma is the node for that.",
      ],
    },
  ],
});
