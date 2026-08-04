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
  PixaromaPreview: "view result thumbnail show display civitai metadata parameters resources share",
  PixaromaSaveImage: "export write disk output filename png folder civitai metadata parameters resources share lora hash embed",
  PixaromaCompare: "before after slider difference ab side by side",
  PixaromaRemoveBackground: "cutout transparent alpha matte birefnet rembg erase background",
  PixaromaLoadVideo: "mp4 movie frames clip import video",
  PixaromaLoadVideoFrame: "still grab frame single picture screenshot",
  PixaromaSaveMp4: "export video render encode movie mp4 h264",
  PixaromaPauseImage: "stop check gate review approve interrupt",

  // ── Prompt and text ──
  PixaromaPrompt: "tag library wildcard random autocomplete snippet phrase reorder order sort rearrange move category colour color highlight underline resize sidebar rename",
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
  PixaromaTextOverlay: "caption title font subtitle words on image ttf otf typeface custom font own font install font fonts folder",
  PixaromaTextWatermark: "signature logo copyright brand stamp font ttf otf typeface custom font own font install font fonts folder",

  // ── Values ──
  PixaromaResolution: "size width height ratio dimensions aspect",
  PixaromaSizes: "preset list dimensions size resolution star starred recommended favourite favorite mark best supported",
  PixaromaSliders: "slider knob dashboard remote control panel",
  PixaromaSeed: "random fixed number sampler noise",
  PixaromaNumber: "int float value amount",
  PixaromaDuration: "duration seconds length how long video length frames frame count fps frame rate clip length 5 seconds 10 seconds convert seconds to frames how many frames minimax h3 wan hunyuan ltx 4n+1 8n+1 17n+5 multiple of 4 plus 1 length must be math expression formula video too short video too long sampler rejected frame count",
  PixaromaDropdown: "dropdown drop down list options preset choose pick select menu combo trigger word lora trigger shortcut saved values my own list named values swap between",
  PixaromaWH: "width height size dimensions",
  PixaromaPortraitLandscape: "rotate orientation flip tall wide multiple of 8 16 32 64 round size snap size divisible by step size must be multiple resolution not accepted size error round to nearest",

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
  PixaromaXYPlot: "grid compare matrix sweep test chart contact sheet lora strength weight side by side versus vs combination example examples which sampler steps cfg",
  PixaromaRunTimer: "time clock how long duration speed stopwatch",
  PixaromaRunLog: "history times record log past runs hardware gpu graphics card vram ram memory specs rtx system benchmark",
  NotifyPixaroma: "sound alert ding beep finished done chime",
  PixaromaVersionCheck: "version diagnostic about update which version",

  // ── Utility and editors ──
  PixaromaLoraLoader: "lora stack weight trigger civitai xy plot compare grid sweep "
    + "api key token login account not found missing nsfw adult uncensored mature "
    + "civitai.red unrestricted thumbnail preview blocked hidden",
  Pixaroma3D: "mesh glb obj camera light render scene 3d",
  PixaromaPaint: "brush draw sketch layers erase paint",
  PixaromaImageComposition: "collage blend layers grade montage composite text layer font ttf otf custom font",
  PixaromaAudioStudio: "music sound video beat visualizer audio reactive",
};
