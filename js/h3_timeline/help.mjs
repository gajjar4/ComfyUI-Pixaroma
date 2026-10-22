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
        "Scene 1: click `+ picture` and pick the start picture. It is the same picker as Load Image: search, your own folders (`+ Folder`), and `Upload` for a picture from your computer. You can also drop a picture file on a scene. Write what happens, like `sings softly with her hands clasped`.",
        "Click `+ Add scene` for the next part, set its length and write what changes, like `sways and dances, arms open wide`.",
        "For Sing or Talk, wire the song or the voice into `audio`, and the same sound into H3 Audio Sync's `track` so the mouth follows it.",
        "Wire `model` and `latent` into H3 Audio Sync, then to the sampler, and `positive` into the sampler (and through Conditioning Zero Out into its negative). Run.",
      ],
    },
    {
      heading: "Example",
      body: "Open the EP41 workflow `Minimax H3 - Audio Sync - Make a Picture Sing`. Delete MiniMax H3 Reference to Video, and delete the Duration node too: it sets how much of the song Load Audio sends (10 seconds), and now the scenes set the length. In Load Audio pick a song of 30 seconds or more (the workflow's own song is shorter).\n\nPut H3 Timeline where Reference to Video was: `clip`, `vae`, `audio_vae` from the loaders, `model` from ModelAttentionBackend, the song from Load Audio into `audio`. Then H3 Timeline's `model` and `latent` go into H3 Audio Sync, and its `positive` into the sampler. H3 Timeline is taller than the node it replaces, so move the nodes under it down until nothing is covered.\n\nMake three scenes of 10 seconds: hands clasped, then dancing with arms open, then waving at the camera.",
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
        ["New look", "The same shot with one change, like a hat or another dress. It becomes the look from that scene on and fades in over about half a second. Make it from the start picture with an edit model (Flux Klein Image Edit) so the framing stays the same. For a change that looks natural, let her make it first in a scene with no picture, and give the New look to the scene after (see Tips)."],
        ["Add person", "Any photo of someone who joins, kept whole (never cut). Write what they do, like `a man walks in from the right and stands beside her`."],
      ],
    },
    {
      heading: "What the video keeps of a picture",
      body: "The start picture and a New look become the video frame, so they are cut to the video's shape. Under each picture the node says `nothing cut` when the shapes match, or what gets cut. Click that word to open the crop view: drag the orange frame to choose what stays, or pick `Fit inside` to keep the whole picture with black bars. The time bar shows each scene's picture cut the same way.",
    },
    {
      heading: "Length",
      body: "Each scene is 4 seconds or more. The total is the scenes added up, shown under the list, and comes out as `seconds` (for a node after this one, like a filename or a timer). Do not wire it into the Load Audio that feeds this node, that makes a loop: the scenes set the length. With Sing or Talk the node cuts the audio to the video's length; after a run the bar says if the audio was shorter (the rest is silent then).",
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
        "Action first, picture after. A New look on its own makes the change fade in, which looks like magic. To make it natural, write the action in a scene with NO picture (`lifts a black hat and puts it on her head`), then give the next scene the New look picture (her wearing the hat): it only keeps the hat on from there. Tested: she raises her hands, the hat comes into them and she puts it on, with no fade.",
        "A person who joins stays for the scene they join in, but fades out like a ghost at the next scene change. So decide how they leave. To send them away, write it at the end of their own scene (`a man walks in from the right and stands beside her, then near the end of this part he turns and walks back out of the frame to the right`): tested, he walked out with no fade. To keep them, give the next scene a New look picture with both of them in it: tested, he stayed to the end with no fade, and she kept that picture's pose. Use a clean, full-size picture (like one made with an edit model from the start picture and their photo), never a frame taken from a video: the video copies that picture's look, and a video frame made the rest of the video harsher and her face a little different (tested).",
        "Keep the scene a person joins in at about 13 seconds or less: a longer scene is made in two parts and the person can slide between them.",
        "A person who joins can walk in late, halfway through their scene. To bring them in at the start, say so: `a man walks in from the right side of the frame right away, at the very start, and stands beside her`. Tested: he came in 3.5 seconds into a 14 second scene instead of 7.5.",
        "A person who joins fits best when there is room in the frame beside the main person. If their scene ends the video, they can fade out in its last half second: add a short scene after it, or trim the end.",
        "If the first part of the video comes out with a different background or light than the picture (a white background turned dark for 16 seconds), run again with another seed. It depends on the seed: the same scenes on another seed stayed white.",
        "A New look that is a whole different picture (another person, another place) does not cut: it crossfades in about half a second, and things can carry over (a microphone stayed in front of the new person). A New look works best as the same shot with one change.",
        "Talk keeps the picture's pose (hands in pockets stay in pockets) and mostly follows the voice, not gesture words. Sing and Act follow movement words better.",
        "Act can speak: put a short line in quotes in a scene's words (`says \"welcome to the show\"`). The line tends to come late in its scene, so give it a few seconds.",
        "Works only with MiniMax H3. H3 Long Video is the simpler node for one long scene.",
      ],
    },
  ],
};
