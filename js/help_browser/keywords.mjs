// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - search aliases                       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// The words people TYPE, which are often not the words the help is written in.
// Somebody who wants a bigger image searches "upscale" or "make it bigger", not
// "resize modes", and without this they get nothing and give up.
//
// These live here rather than inside each help def on purpose: a help def is
// about explaining a node to a reader, and stuffing search bait into its prose
// would make it worse to read. Nothing here is ever displayed - it only feeds
// the search index.
//
// A help def may ALSO carry its own `keywords` string; the two are merged, so a
// node that keeps its aliases next to its own code still works.
//
// To add a node: one line, keyed by its exact comfyClass. Missing entries are
// fine - the node is still found by its name, tagline and full help text.

export const KEYWORDS = {
  "canvas:workflows": "workflow manager browse organise organize my workflows folder rename move file explorer thumbnail cover picture star favourite favorite duplicate junk tidy messy find lost which workflow used",
  // ── Resize and crop: the biggest source of missed searches ──
  PixaromaImageResize: "upscale enlarge bigger smaller shrink scale megapixel resolution downscale make it bigger",
  PixaromaResizeCrop: "exact size cover fill stretch squash aspect force size",
  PixaromaCrop: "trim cut region area chop",
  PixaromaUncrop: "paste back restore put back region",
  PixaromaInpaintCrop: "inpaint mask repair fix retouch face hands blemish",
  PixaromaInpaintStitch: "seam blend feather merge join invisible edge",
  PixaromaOutpaint: "extend expand wider taller border pad zoom out uncrop background",
  PixaromaOutpaintStitch: "restore original seam blend outpaint",

  // ── Image ──
  PixaromaLoadImage: "open file input picker photo import",
  PixaromaLoadImageMini: "small compact loader tidy",
  PixaromaImageInfo: "width height mask filename size dimensions",
  PixaromaLoadImagesFolder: "batch folder directory many bulk each one by one",
  PixaromaPreview: "view result thumbnail show display",
  PixaromaSaveImage: "export write disk output filename png folder",
  PixaromaCompare: "before after slider difference ab side by side",
  PixaromaRemoveBackground: "cutout transparent alpha matte birefnet rembg erase background",
  PixaromaLoadVideo: "mp4 movie frames clip import video",
  PixaromaLoadVideoFrame: "still grab frame single picture screenshot",
  PixaromaSaveMp4: "export video render encode movie mp4 h264",
  PixaromaPauseImage: "stop check gate review approve interrupt",

  // ── Prompt and text ──
  PixaromaPrompt: "tag library wildcard random autocomplete snippet phrase",
  PixaromaPromptMulti: "batch queue many list prompts",
  PixaromaPromptPack: "batch paste queue block many prompts",
  PixaromaPromptStack: "assemble parts toggle build pieces chunks",
  PixaromaPromptFromList: "index pick number choose",
  PixaromaFindReplace: "replace swap substitute rules change words",
  PixaromaText: "string write field type note textbox",
  PixaromaShowText: "debug display print inspect see value preview text",
  PixaromaPromptReader: "metadata png extract read recover steal prompt from image exif",
  PixaromaPauseText: "llm edit review gate check interrupt",
  PixaromaTextJoinTwo: "concat combine merge glue join",
  PixaromaTextJoinThree: "concat combine merge glue join",
  PixaromaTextJoinFour: "concat combine merge glue join",

  // ── Notes and overlay ──
  PixaromaNote: "comment sticky documentation annotate",
  PixaromaLabel: "caption title heading name explain",
  PixaromaTextOverlay: "caption title font subtitle words on image",
  PixaromaTextWatermark: "signature logo copyright brand stamp",

  // ── Values ──
  PixaromaResolution: "size width height ratio dimensions aspect",
  PixaromaSizes: "preset list dimensions size resolution",
  PixaromaSliders: "slider knob dashboard remote control panel",
  PixaromaSeed: "random fixed number sampler noise",
  PixaromaNumber: "int float value amount",
  PixaromaWH: "width height size dimensions",
  PixaromaPortraitLandscape: "rotate orientation flip tall wide",

  // ── Logic and flow ──
  PixaromaSwitch: "route select choose pick multiplexer",
  PixaromaSwitchWH: "ab toggle size swap",
  PixaromaSwitchSource: "ab bank preset swap variant",
  PixaromaMuteSwitch: "bypass disable enable branch off skip",
  PixaromaGroupSwitch: "group bypass mute enable disable",
  PixaromaSetNode: "variable wireless reroute link tidy no wires",
  PixaromaGetNode: "variable wireless reroute link tidy no wires",
  PixaromaLoopStart: "repeat iterate for each again loop",
  PixaromaLoopEnd: "repeat iterate finish end loop",
  PixaromaCombine: "merge batch accumulate gather join",
  PixaromaXYPlot: "grid compare matrix sweep test chart contact sheet",
  PixaromaRunTimer: "time clock how long duration speed stopwatch",
  PixaromaRunLog: "history times record log past runs",
  NotifyPixaroma: "sound alert ding beep finished done chime",
  PixaromaVersionCheck: "version diagnostic about update which version",

  // ── Utility and editors ──
  PixaromaLoraLoader: "lora stack weight trigger civitai",
  Pixaroma3D: "mesh glb obj camera light render scene 3d",
  PixaromaPaint: "brush draw sketch layers erase paint",
  PixaromaImageComposition: "collage blend layers grade montage composite",
  PixaromaAudioStudio: "music sound video beat visualizer audio reactive",
};
