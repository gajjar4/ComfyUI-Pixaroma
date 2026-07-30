// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared — Barrel Export                             ║
// ╚═══════════════════════════════════════════════════════════════╝

// ── Pixaroma JS bundle version ────────────────────────────────────────────
// MUST stay in lockstep with `version` in pyproject.toml — bump BOTH together
// on every release. The Version Check node compares this (the version baked
// into the JS the BROWSER actually loaded) against the Python files version;
// a mismatch means the browser is running STALE cached code and the user needs
// a hard refresh (Ctrl+Shift+R). It lives in this existing, widely-imported
// module on purpose: a brand-new file is never in anyone's cache, so it could
// never reveal a stale bundle.
export const PIXAROMA_JS_VERSION = "1.4.66";

export {
  allow_debug,
  PIXAROMA_LOGO,
  BRAND,
  createDummyWidget,
  installFocusTrap,
  hideJsonWidget,
  restorePreview,
  resizeNode,
  getLogo,
  createPlaceholder,
  downloadDataURL,
} from "./utils.mjs";

export {
  createNodePreview,
  showNodePreview,
  restoreNodePreview,
  clearNodePreview,
  activateNodePreview,
} from "./preview.mjs";

export { injectLabelCSS } from "./label_css.mjs";

export { isVueNodes, applyAdaptiveCanvasOnly, canvasBackingScale, installZoomRepaint } from "./nodes2.mjs";

export { installResizeFloor, measureRootContent } from "./resize_floor.mjs";

export { installCanvasZoomPassthrough } from "./canvas_zoom.mjs";

export { onNodeDefsRefresh, runRefreshHandlers, installRefreshHook } from "./refresh.mjs";

export { registerSweepProvider, getSweepProvider, sweepProviderFor, anyProviderOwns } from "./sweep_targets.mjs";

export {
  createPixaromaColorPicker,
  openPixaromaColorPickerPopup,
  PIXAROMA_PALETTE,
} from "./color_picker.mjs";

export {
  createHelpButton,
  openHelpPopup,
  openHelpFor,
  closeHelpPopup,
  injectHelpCSS,
  registerNodeHelp,
  getNodeHelp,
  allNodeHelp,
} from "./help.mjs";

export {
  ACC,
  ACCENT_VAR,
  GLOBAL_ACCENT_SETTING,
  DEFAULT_ACCENT_PROP,
  registerNodeSettings,
  registerNodeAccent,
  getNodeSettings,
  openNodeSettings,
  openAccentPanel,
  createAccentSection,
  createOptionRows,
  nodeSetting,
  setNodeSetting,
  closeNodeSettingsPanel,
  closeNodeSettingsFor,
  accentOf,
  accentRgba,
  setNodeAccent,
  applyAccent,
  installNodeAccent,
  repaintAccent,
  repaintAllAccents,
  globalAccent,
  classAccentSetting,
} from "./node_settings.mjs";
