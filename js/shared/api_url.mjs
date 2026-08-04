// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Build a URL that works on a HOSTED ComfyUI, not just on localhost.  ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// NEVER write a root-relative API URL again. Core routes go through pixApiUrl();
// OUR OWN routes and assets are written with a literal /api prefix (see the note
// at the bottom of this file for why those two differ).
//
// WHY (measured on a cloud platform, 2026-08-04). Save Mp4's in-node player was
// black there and its play button did nothing, while VideoHelperSuite's preview
// worked in the same graph. The console said exactly why:
//
//     GET https://<host>/view?filename=Video_00001_....mp4   401 (Unauthorized)
//
// The filename was correct, so our JS had the data and had built the player. The
// URL was the problem: `/view?...` resolves against the PAGE ORIGIN, and on that
// host the page origin is their web app, not ComfyUI's API.
//
// The trap that makes this invisible, and that cost a wrong diagnosis mid-session:
// the host serves ComfyUI's FRONTEND FILES at the root, so `/scripts/app.js` and
// our own modules load perfectly. "Our JS runs, therefore root paths reach
// ComfyUI" is FALSE. Static files and the API are served by different things.
// Locally they are the same server, which is why nothing shows up in testing.
//
// `api.apiURL(route)` is ComfyUI's own helper and prefixes whatever base the
// deployment is actually using (`api_base + "/api" + route`). VideoHelperSuite
// routes every URL through it, including its OWN custom routes (`/vhs/viewvideo`,
// `/vhs/getpath`), and it works on that host. That is the evidence this is right
// for our routes too, not just for core's.
//
// Locally this changes `/x` to `/api/x`, which is a no-op in practice: ComfyUI
// registers an `/api`-prefixed alias for every non-static route (see
// `server.py`, "Prefix every route with /api"). All 55 of our routes are
// decorator routes, so every one of them has an alias. Verified by fetching each
// route family both ways and diffing the status codes.

import { api } from "/scripts/api.js";

/**
 * Absolute-safe URL for a ComfyUI or Pixaroma route.
 * @param {string} route a BARE route, e.g. "/view?filename=x.png&type=output".
 *        Never pass one that already starts with /api - this adds that itself.
 * @returns {string} the same route, prefixed for this deployment
 */
export function pixApiUrl(route) {
  try {
    if (typeof api?.apiURL === "function") return api.apiURL(route);
  } catch (_e) {
    /* fall through - a broken helper must not take the feature down with it */
  }
  return route; // degrade to the old behaviour rather than produce nothing
}

// ── Why our OWN urls are written "/api/pixaroma/..." literally, not via here ──
//
// 96 of them sit inside CSS `url(...)` rules in injected stylesheets. A CSS rule
// cannot call a function, and `${...}` interpolation only works when the
// surrounding string happens to be a template literal - which varies per file,
// and where it is NOT one you get a syntax-valid stylesheet containing the
// literal text "${PIX_ASSETS}", i.e. a silent breakage. A uniform textual prefix
// is correct in every string type with zero syntax risk, which is what 233 call
// sites needed.
//
// It is equivalent in practice: `api_base` is empty on every deployment our pack
// can run on at all, because we import "/scripts/app.js" from the root in 151
// places - so if a deployment used a non-empty base, none of our JS would load
// and there would be nothing to fix. Should that ever change, this helper is the
// one place to teach about the base, plus a sweep of the literal prefixes.
