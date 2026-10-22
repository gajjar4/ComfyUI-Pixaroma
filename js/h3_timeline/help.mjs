// H3 Timeline Pixaroma - the written help (the toolbar ? and the Help browser).
// Plain words for artists, no em dashes (house rule).

export const H3_TIMELINE_HELP = {
  title: "H3 Timeline Pixaroma",
  tagline: "Tell one long MiniMax H3 video as scenes: each scene its own length, its own words and, if it needs one, its own picture. Made in one run, with no cuts.",
  sections: [
    {
      heading: "How to use it",
      bullets: [
        "Wire your MiniMax H3 `model` (after its LoRAs), `clip`, `vae` and `audio_vae` in. It replaces MiniMax H3 Reference to Video and H3 Long Video.",
        "Scene 1: click `+ picture` and pick or upload the start picture. Write what happens, like `sings softly with her hands clasped`.",
        "Click `+ Add scene` for the next part, set its length and write what changes, like `sways and dances, arms open wide`.",
        "For Sing or Talk, wire the song or the voice into `audio`, and the same sound into H3 Audio Sync's `track` so the mouth follows it.",
        "Wire `model` and `latent` into H3 Audio Sync, then to the sampler, and `positive` into the sampler (and through Conditioning Zero Out into its negative). Run.",
      ],
    },
    {
      heading: "Example",
      body: "Open the EP41 workflow `Minimax H3 - Audio Sync - Make a Picture Sing`. Delete MiniMax H3 Reference to Video and put H3 Timeline in its place: `clip`, `vae`, `audio_vae` from the loaders, `model` from ModelAttentionBackend, the song from Load Audio into `audio`. Then H3 Timeline's `model` and `latent` go into H3 Audio Sync, and its `positive` into the sampler. Make three scenes of 10 seconds: hands clasped, then dancing with arms open, then waving at the camera. The song must be at least 30 seconds long.",
    },
    {
      heading: "Writing a scene",
      body: "Write what she does, like `smiles and waves at the camera with her right hand`. You do not need the long prompt or tags like `<Subject 1>`: the node puts your words into the tested Sing, Talk or Act prompt for you.\n\nStart with what she does (`sings`, `dances`) or with `She`, and the node knows it is the person in the picture. Start with someone else (`A man walks in`) and it is kept as you wrote it.",
    },
    {
      heading: "Pictures in a scene",
      defs: [
        ["Start picture", "Scene 1's picture is the first frame and the look of the whole video. It is needed: without a picture H3 cannot keep a long video together."],
        ["No picture", "The scene keeps the look of the scene before it. Most scenes need no picture: the words change what happens."],
        ["New look", "The same shot with one change, like a hat or another dress. It becomes the look from that scene on and fades in over about half a second. Make it from the start picture with an edit model (Flux Klein Image Edit) so the framing stays the same."],
        ["Add person", "Any photo of someone who joins, kept whole (never cut). Write what they do, like `a man walks in from the right and stands beside her`."],
      ],
    },
    {
      heading: "What the video keeps of a picture",
      body: "The start picture and a New look become the video frame, so they are cut to the video's shape. Under each picture the node says `nothing cut` when the shapes match, or what gets cut. Click that word to open the crop view: drag the orange frame to choose what stays, or pick `Fit inside` to keep the whole picture with black bars. The time bar shows each scene's picture cut the same way.",
    },
    {
      heading: "Length",
      body: "Each scene is 4 seconds or more. The total is the scenes added up, shown under the list, and comes out as `seconds` (handy for a Load Audio length). With Sing or Talk the node cuts the audio to the video's length; after a run the bar says if the audio was shorter (the rest is silent then).",
    },
    {
      heading: "Mode",
      defs: [
        ["Sing", "The picture sings the audio (a song)."],
        ["Talk", "The picture speaks the audio (a voice recording)."],
        ["Act", "No audio. H3 makes the sound itself: mostly a quiet room, but a scene with a lot of movement (dancing) can get louder. Add your own music later in your editor."],
      ],
    },
    {
      heading: "Tips",
      bullets: [
        "A scene change blends over a couple of seconds, so it reads as one continuous shot.",
        "At the start of a new scene she can drift back toward the picture's pose for a moment. A relaxed pose in the start picture looks most natural.",
        "Something new cannot appear from nowhere: a New look fades in. For a real action (she puts a hat on) the hat must be in the picture or her hand first.",
        "A person who joins stays for the scene they join in, but can drift out at the next scene change. Write their arrival and what they do next in ONE scene (`a man walks in from the right and stands beside her, smiling`), as long as you want them there.",
        "A person who joins fits best when there is room in the frame beside the main person.",
        "Works only with MiniMax H3. H3 Long Video is the simpler node for one long scene.",
      ],
    },
  ],
};
