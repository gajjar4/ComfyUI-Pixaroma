// Shared: a read-only line-number gutter for a WRAPPING textarea.
//
// For any Pixaroma box whose contract is "one value per line" (XY Plot's Full
// list, and the same shape in the prompt nodes). Two things it fixes together,
// which is why it is one helper:
//   - the box wraps, so a long prompt is readable without a horizontal scroll;
//   - each LOGICAL line is numbered, so you can see where each value starts
//     once wrapping means one value spans several visual rows.
// The numbers live outside the textarea's value, so they can never be typed
// over, copied, or saved into the workflow.
//
// ⚠ THE ALIGNMENT RULE (node UI convention #26, learned from the Prompt caret
// drift): a number can only sit beside its line if the layout that produced
// the wrapping is the SAME layout we measured. So the mirror's content width is
// MEASURED off the live textarea (clientWidth minus its real padding) every
// relayout - never assumed from CSS, never hard-coded. Where the two disagree
// the wrap points differ and the error ACCUMULATES down the box, which is
// exactly the bug that shipped once already and was invisible on the dev
// machine. A ResizeObserver re-runs it, because the width changes whenever the
// node is resized, the renderer switches, or a scrollbar appears.

const CSS_ID = "pix-ln-css";

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = `
.pix-ln-wrap{position:relative;display:block;}
/* pointer-events:none so a drag-select that crosses the gutter still selects
   text in the textarea underneath instead of stalling on the numbers. */
.pix-ln-gutter{position:absolute;left:0;top:0;bottom:0;overflow:hidden;pointer-events:none;user-select:none;
  border-right:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22);border-radius:5px 0 0 5px;}
.pix-ln-inner{position:absolute;left:0;top:0;right:0;will-change:transform;}
.pix-ln-num{position:absolute;right:5px;color:#6f6f6f;font-variant-numeric:tabular-nums;}
/* The measuring twin. Never shown; must never affect layout. */
.pix-ln-mirror{position:absolute;visibility:hidden;pointer-events:none;top:0;left:-99999px;
  padding:0;border:0;margin:0;box-sizing:content-box;}
`;
  document.head.appendChild(s);
}

// Wrap `ta` in a gutter. Returns a detach() that puts the DOM back as it was.
// opts.minDigits - reserve room for at least this many digits (default 2).
export function attachLineNumbers(ta, opts = {}) {
  if (!ta || ta._pixLnDetach) return ta && ta._pixLnDetach;
  injectCSS();
  const minDigits = opts.minDigits || 2;

  const parent = ta.parentNode;
  if (!parent) return () => {};
  const wrap = document.createElement("div");
  wrap.className = "pix-ln-wrap";
  parent.insertBefore(wrap, ta);
  wrap.appendChild(ta);

  const gutter = document.createElement("div");
  gutter.className = "pix-ln-gutter";
  const inner = document.createElement("div");
  inner.className = "pix-ln-inner";
  gutter.appendChild(inner);
  wrap.appendChild(gutter);

  const mirror = document.createElement("div");
  mirror.className = "pix-ln-mirror";
  wrap.appendChild(mirror);

  const basePadLeft = parseFloat(getComputedStyle(ta).paddingLeft) || 8;
  let lastSig = "";

  const relayout = (force) => {
    if (!ta.isConnected) return;
    const cs = getComputedStyle(ta);
    const lines = ta.value.split("\n");
    const digits = Math.max(minDigits, String(lines.length).length);

    // Gutter width from the REAL glyph metrics, not a guessed px-per-digit:
    // the box is monospace today but a theme could change that.
    mirror.style.font = cs.font;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.whiteSpace = "pre";
    mirror.style.width = "auto";
    mirror.textContent = "0".repeat(digits);
    const gw = Math.ceil(mirror.offsetWidth) + 10;   // 5px breathing room each side
    gutter.style.width = gw + "px";
    // Text starts clear of the gutter. Written before the content width is
    // measured below, because it CHANGES that width.
    const padLeft = gw + basePadLeft;
    if (Math.abs((parseFloat(ta.style.paddingLeft) || 0) - padLeft) > 0.5) {
      ta.style.paddingLeft = padLeft + "px";
    }

    // MEASURED content width (convention #26) - clientWidth already excludes a
    // scrollbar, so this is the exact box the textarea wraps text in.
    const padR = parseFloat(cs.paddingRight) || 0;
    const contentW = Math.max(0, ta.clientWidth - padLeft - padR);

    // Skip the rebuild when nothing that affects wrapping changed.
    const sig = contentW + "|" + cs.font + "|" + cs.letterSpacing + "|" + ta.value;
    if (!force && sig === lastSig) return;
    lastSig = sig;

    // Build the twin: same text, same box, same wrapping rules.
    mirror.style.whiteSpace = cs.whiteSpace;
    mirror.style.overflowWrap = cs.overflowWrap;
    mirror.style.wordBreak = cs.wordBreak;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.tabSize = cs.tabSize;
    mirror.style.width = contentW + "px";
    mirror.textContent = "";
    const frag = document.createDocumentFragment();
    for (const ln of lines) {
      const d = document.createElement("div");
      // A zero-width space keeps an EMPTY line one line-box tall instead of
      // collapsing to zero, so later numbers do not creep upward. Written as an
      // ESCAPE, never the literal character: an invisible byte in source is the
      // convention #25 bug class - nobody can see it in a diff or a review.
      d.textContent = ln.length ? ln : "\u200b";
      frag.appendChild(d);
    }
    mirror.appendChild(frag);

    // One number per logical line, parked at that line's own top.
    const padTop = parseFloat(cs.paddingTop) || 0;
    const kids = mirror.children;
    const nf = document.createDocumentFragment();
    for (let i = 0; i < kids.length; i++) {
      const nEl = document.createElement("div");
      nEl.className = "pix-ln-num";
      nEl.textContent = String(i + 1);
      nEl.style.top = (kids[i].offsetTop + padTop) + "px";
      nEl.style.font = cs.font;
      nEl.style.lineHeight = cs.lineHeight;
      nf.appendChild(nEl);
    }
    inner.textContent = "";
    inner.appendChild(nf);
    syncScroll();
  };

  const syncScroll = () => { inner.style.transform = `translateY(${-ta.scrollTop}px)`; };

  const onInput = () => relayout(false);
  ta.addEventListener("input", onInput);
  ta.addEventListener("scroll", syncScroll);

  // Width changes on node resize, renderer switch, and when the textarea's own
  // scrollbar appears - none of which fire `input`.
  let ro = null;
  try {
    ro = new ResizeObserver(() => relayout(false));
    ro.observe(ta);
  } catch (_e) {}

  relayout(true);

  const detach = () => {
    try { ro && ro.disconnect(); } catch (_e) {}
    ta.removeEventListener("input", onInput);
    ta.removeEventListener("scroll", syncScroll);
    ta.style.paddingLeft = "";
    try {
      if (wrap.parentNode) { wrap.parentNode.insertBefore(ta, wrap); wrap.remove(); }
    } catch (_e) {}
    delete ta._pixLnDetach;
  };
  ta._pixLnDetach = detach;
  return detach;
}
