// Video Prompt Pixaroma - state.
//
// Vue Compat #9: everything lives on node.properties.videoPromptState and is
// injected into the hidden VideoPromptState input at graphToPrompt time, so the
// node has no visible widgets and no stray input dots beyond the three real
// ones (first_frame, last_frame, clip).
//
// THE KEYS ARE snake_case ON PURPOSE. Python's parse_state reads them directly,
// so there is no camelCase-to-snake mapping layer to get out of step. The pack
// usually uses camelCase here; the uniformity is worth more than the house
// style on a state blob this wide.
//
// THE MODE IS NOT IN HERE. It is derived from which image inputs are connected,
// every time it is needed. A mode that is never stored can never be restored
// wrongly, and the connection handler writes no serialized state - which is
// what keeps this node clear of the configure-replay bug class (Vue Compat
// #17 / #19) that has hit the Switch family twice.

export const CLASS = "PixaromaVideoPrompt";
export const HIDDEN_INPUT = "VideoPromptState";
export const STATE_PROP = "videoPromptState";

export const MODES = ["text_to_video", "first_frame", "first_last"];
export const MODE_LABELS = {
  text_to_video: "Text to video",
  first_frame: "First frame",
  first_last: "First and last frame",
};
export const MODE_HINTS = {
  text_to_video: "no images wired",
  first_frame: "1 image wired",
  first_last: "2 images wired",
};

export const MIN_W = 330;
export const DEFAULT_W = 390;
export const MIN_H = 380;
export const DEFAULT_H = 470;

export const SEED_FIXED = "fixed";
export const SEED_RANDOM = "random";

export const DEFAULT_STATE = {
  // --- what Python reads --------------------------------------------------
  idea: "",
  tier_index: 1, // 8 seconds: 5s cannot reliably write a talking prompt
  tier_name: "8 seconds",
  seed: 0,
  model: "qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors",
  clip_type: "minimax",
  temperature: 0.3,
  max_length: 512,
  top_k: 64,
  top_p: 0.95,
  min_p: 0.05,
  repetition_penalty: 1.05,
  presence_penalty: 0.0,
  thinking: false,
  use_default_template: true,
  release_model: false,
  fps: 24,
  step: 17,
  plus: 5,
  min_frames: 0,
  // --- face only, never sent (see PROMPT_KEYS) ----------------------------
  seed_mode: SEED_FIXED,
  speech_hint: true,
};

// Exactly the keys Python reads. Anything outside this list is presentation,
// and sending it would change the node's cache signature - so toggling the
// speech hint would silently re-run the model for no reason.
const PROMPT_KEYS = [
  "idea", "tier_index", "tier_name", "seed", "model", "clip_type",
  "temperature", "max_length", "top_k", "top_p", "min_p",
  "repetition_penalty", "presence_penalty", "thinking",
  "use_default_template", "release_model", "fps", "step", "plus", "min_frames",
];

function num(value, fallback, lo, hi) {
  const out = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.max(lo, Math.min(hi, out));
}

export function readState(node) {
  const raw = node?.properties?.[STATE_PROP];
  const st = { ...DEFAULT_STATE, ...(raw && typeof raw === "object" ? raw : {}) };
  st.idea = typeof st.idea === "string" ? st.idea : "";
  st.tier_name = typeof st.tier_name === "string" ? st.tier_name : "";
  st.tier_index = Math.trunc(num(st.tier_index, 1, 0, 999));
  st.seed = Math.trunc(num(st.seed, 0, 0, Number.MAX_SAFE_INTEGER));
  st.seed_mode = st.seed_mode === SEED_RANDOM ? SEED_RANDOM : SEED_FIXED;
  st.model = typeof st.model === "string" && st.model.trim()
    ? st.model : DEFAULT_STATE.model;
  st.clip_type = typeof st.clip_type === "string" && st.clip_type.trim()
    ? st.clip_type : "minimax";
  st.temperature = num(st.temperature, 0.3, 0.01, 2);
  st.max_length = Math.trunc(num(st.max_length, 512, 1, 32768));
  st.top_k = Math.trunc(num(st.top_k, 64, 0, 1000));
  st.top_p = num(st.top_p, 0.95, 0, 1);
  st.min_p = num(st.min_p, 0.05, 0, 1);
  st.repetition_penalty = num(st.repetition_penalty, 1.05, 0, 5);
  st.presence_penalty = num(st.presence_penalty, 0, 0, 5);
  st.fps = num(st.fps, 24, 0.01, 1000);
  st.step = Math.trunc(num(st.step, 17, 0, 100000));
  st.plus = Math.trunc(num(st.plus, 5, 0, 100000));
  st.min_frames = Math.trunc(num(st.min_frames, 0, 0, 1000000));
  st.thinking = st.thinking === true;
  st.use_default_template = st.use_default_template !== false;
  st.release_model = st.release_model === true;
  st.speech_hint = st.speech_hint !== false;
  return st;
}

export function writeState(node, patch) {
  if (!node) return { ...DEFAULT_STATE };
  const next = { ...readState(node), ...(patch || {}) };
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = next;
  return next;
}

// ---------------------------------------------------------------------------
// Mode, derived from the wires
// ---------------------------------------------------------------------------
function slotConnected(node, name) {
  const inputs = node?.inputs || [];
  for (const inp of inputs) {
    if (inp && inp.name === name) return inp.link != null;
  }
  return false;
}

/** Mirrors nodes/_video_prompt_helpers.py::mode_for. Both must agree or the face
 *  announces a different formula than the one that runs. */
export function modeOf(node) {
  const first = slotConnected(node, "first_frame");
  const last = slotConnected(node, "last_frame");
  if (first && last) return "first_last";
  if (first || last) return "first_frame";
  return "text_to_video";
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
export function rollSeed() {
  // Number.MAX_SAFE_INTEGER, not the full 64-bit range: anything above it stops
  // round-tripping through JSON as the same integer, and a seed that changes on
  // the way to Python would break Fixed mode's whole promise.
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/**
 * The seed this run will actually use.
 *
 * Random rolls a fresh one per run so the state - and therefore the node's
 * cache signature - differs and the model runs again. Fixed reuses the stored
 * number, so an unchanged node is cached and Run is instant. That is the Seed
 * Pixaroma model, and it is why there is no nonce here (issue #11).
 *
 * The rolled number is remembered on a RUNTIME field, never in node.properties,
 * so a run can never mark a clean workflow as modified (Vue Compat #18).
 */
export function seedForRun(node) {
  const st = readState(node);
  if (st.seed_mode !== SEED_RANDOM) return st.seed;
  const rolled = rollSeed();
  node._pixVpLastSeed = rolled;
  return rolled;
}

/** Only the keys Python reads, with the run's seed baked in. */
export function injectedState(node) {
  const st = readState(node);
  const out = {};
  for (const key of PROMPT_KEYS) out[key] = st[key];
  out.seed = seedForRun(node);
  return out;
}

/** What the face should show as the seed: the last rolled one in Random, the
 *  stored one in Fixed. */
export function displaySeed(node) {
  const st = readState(node);
  if (st.seed_mode === SEED_RANDOM && Number.isFinite(node?._pixVpLastSeed)) {
    return node._pixVpLastSeed;
  }
  return st.seed;
}

// Speech VERBS only. The first version also counted a bare colon, which made
// the 5-second chip turn yellow for "wide shot: a foggy forest", "close-up: her
// hands" and even "a clock reads 5:30" - so the warning looked like it fired at
// random, which is exactly how a hint gets ignored. It also MISSED "she mutters
// under her breath" and "two friends talking at a cafe".
//
// Scored against a fixed case table (6 speaking, 6 not): the colon rule got 6
// of 12 wrong, this gets 0. Keep that table in mind before adding a pattern -
// a false positive costs more than a miss here, because the hint is advisory
// and a user who learns to ignore it gains nothing from it being right later.
const SPEECH_RE = /\b(say|says|said|saying|speak|speaks|speaking|spoke|tell|tells|telling|told|shout|shouts|shouting|whisper|whispers|whispering|mutter|mutters|muttering|ask|asks|asking|reply|replies|replied|answer|answers|call|calls|yell|yells|scream|screams|sing|sings|singing|talk|talks|talking)\b/i;

/** True when the idea looks like it asks for someone to speak. Used ONLY for
 *  the 5-second hint, which marks that tier without ever blocking it. */
export function looksSpoken(idea) {
  if (typeof idea !== "string" || !idea.trim()) return false;
  return SPEECH_RE.test(idea);
}
