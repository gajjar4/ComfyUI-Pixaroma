"""Pure maths for H3 Timeline Pixaroma: scene lengths -> the clip length, and the windows that follow the scenes.

No torch, no ComfyUI (harness: D:\\Claude Tests\\_h3_timeline_test.py). The grid is H3 Long Video's
(_h3_long_video_helpers.py): windows start on 17-frame chunks and are 17n + 5 frames (5n + 2 tokens) long.

H3 Long Video uses one window length everywhere. Here every SCENE gets its own window(s), so a prompt change lands
exactly on the border between two scenes: a scene's window reaches up to EDGE_CHUNKS into each neighbour, so the
two windows share up to 2 * EDGE_CHUNKS chunks + 2 tokens around the border. A scene a little too long for one
window (H3 was trained on 4 to 15 s) first reaches less, down to MIN_REACH_CHUNKS; only a scene too long even then
is split into several windows that read the same prompt (scene_windows).
"""
from __future__ import annotations

from ._h3_long_video_helpers import CHUNK_FRAMES, FPS, _num, audio_at, frames_of

SCENE_MIN_S = 4.0
SCENE_MAX_S = 120.0
SCENE_DEFAULT_S = 10.0
MAX_SCENES = 12
MIN_SCENE_CHUNKS = 5          # a first / last window is then >= 6 chunks (4.46 s), the shortest clip H3 makes
# How far a scene's window reaches into each neighbour. 1 chunk (a 1.6 s overlap) changed actions fine but LOST a
# person who had just walked in (node_person, 10-22): the next scene's window starts again from the start picture.
# 2 chunks = 4 chunks + 2 tokens of overlap = 73 frames, about 3 s.
EDGE_CHUNKS = 2
MAX_WINDOW_CHUNKS = 21        # 362 frames = 15.08 s


def clean_lengths(lengths):
    """Scene lengths in seconds from the node's state, each clamped to [SCENE_MIN_S, SCENE_MAX_S], at most
    MAX_SCENES; anything unreadable becomes the default."""
    out = []
    for v in list(lengths or [])[:MAX_SCENES]:
        out.append(min(SCENE_MAX_S, max(SCENE_MIN_S, _num(v, SCENE_DEFAULT_S))))
    return out or [SCENE_DEFAULT_S]


def clip_frames(lengths) -> int:
    """The clip's frame count: the scenes added up, on H3's 17n + 5 grid (nearest)."""
    total = sum(clean_lengths(lengths))
    return CHUNK_FRAMES * max(6, int(round((total * FPS - 5) / CHUNK_FRAMES))) + 5


def scene_bounds(lengths, chunks):
    """Scene borders on the chunk grid: [0, b1, ..., chunks]. Each border is the nearest chunk to the scene's start
    in seconds, then pushed so every scene keeps at least MIN_SCENE_CHUNKS (from the end backwards too)."""
    ls = clean_lengths(lengths)
    chunks = int(chunks)
    k = len(ls)
    if k == 1 or chunks < MIN_SCENE_CHUNKS * k:
        return [0, chunks] if chunks > 0 else [0]
    b, t = [0], 0.0
    for v in ls[:-1]:
        t += v
        b.append(int(round(t * FPS / CHUNK_FRAMES)))
    b.append(chunks)
    for i in range(1, k):                       # forwards: room for the scene before
        b[i] = max(b[i], b[i - 1] + MIN_SCENE_CHUNKS)
    for i in range(k - 1, 0, -1):               # backwards: room for the scene after
        b[i] = min(b[i], b[i + 1] - MIN_SCENE_CHUNKS)
    return b


SPLIT_OVERLAP_CHUNKS = 10      # ~7 s: inside ONE scene, the overlap that kept a person who walked in (test C)
MIN_REACH_CHUNKS = 1           # a scene may reach this little into a neighbour to stay in ONE window (scene_windows)


def _split(a, b, max_chunks):
    """Chunk range [a, b) -> sub-windows of at most max_chunks. As few windows as with a 2 * EDGE overlap, but
    then overlapping by up to SPLIT_OVERLAP_CHUNKS: a short overlap let the next window start again from the start
    picture, so a man who had walked in faded out and walked in a second time (measured 10-22, t4_room, 2.8 s).
    Each later window still starts 2 * EDGE past [a] (never reaching the previous scene's window) and each earlier
    one ends 2 * EDGE before [b] (never reaching the next scene's)."""
    n = b - a
    if n <= max_chunks:
        return [(a, b)]
    edge2 = 2 * EDGE_CHUNKS
    k = -(-(n - edge2) // (max_chunks - edge2))

    def plan(over):
        w = -(-(n + over * (k - 1)) // k)
        return [(s, s + w) for s in [a + j * (w - over) for j in range(k - 1)] + [b - w]]

    def fits(p):        # strict: a window's 2 tail tokens reach into the next chunk, so touching chunks overlap
        return (all(t - s <= max_chunks for s, t in p)
                and p[1][0] > a + edge2                        # clear of the previous scene's window
                and p[-2][1] < b - edge2                       # clear of the next scene's window
                and all(p[j - 2][1] < p[j][0] for j in range(2, len(p))))   # only neighbours overlap

    over = max(edge2, min(SPLIT_OVERLAP_CHUNKS, (k * max_chunks - n) // (k - 1)))
    while over > edge2 and not fits(plan(over)):
        over -= 1
    return plan(over)


def scene_windows(latent_t, audio_t, lengths, max_chunks=MAX_WINDOW_CHUNKS):
    """-> [(l0, l1, a0, a1, scene)] token / audio-frame ranges and the scene each window reads, or None when the
    latent is not on H3's grid, has no audio, or one scene fills it in a single window (nothing to do)."""
    latent_t, audio_t = int(latent_t), int(audio_t)
    chunks = (latent_t - 2) // 5
    if latent_t != 5 * chunks + 2 or audio_t <= 0 or chunks < 1:
        return None
    b = scene_bounds(lengths, chunks)
    if len(b) < 2:
        return None
    k = len(b) - 1
    out = []
    for i in range(k):
        back = EDGE_CHUNKS if i > 0 else 0
        ahead = EDGE_CHUNKS if i < k - 1 else 0
        # A scene a little too long for one window keeps ONE window by reaching less into its neighbours (the
        # previous one first), never below 1 chunk (each border must stay inside an overlap). MEASURED 10-22
        # (t4_room, 10 s + 14 s, Add person): split in two, the windows put the man in different places and he
        # slid across their overlap. Too long even then: split as before, with the full reach.
        nb, na = back, ahead
        while b[i + 1] + na - (b[i] - nb) > max_chunks and (nb > MIN_REACH_CHUNKS or na > MIN_REACH_CHUNKS):
            if nb > MIN_REACH_CHUNKS:
                nb -= 1
            else:
                na -= 1
        if b[i + 1] + na - (b[i] - nb) <= max_chunks:
            back, ahead = nb, na
        for s, t in _split(b[i] - back, b[i + 1] + ahead, max_chunks):
            out.append((s, t, i))
    if len(out) == 1:
        return None
    wins = []
    for s, t, i in out:
        l0, l1 = 5 * s, min(5 * t + 2, latent_t)
        a0 = min(audio_at(frames_of(l0)), audio_t - 1)
        a1 = audio_t if l1 == latent_t else min(audio_t, audio_at(frames_of(l1)))
        wins.append((l0, l1, a0, max(a0 + 1, a1), i))
    return wins


def split_scenes(lengths) -> set:
    """The scenes made in MORE than one window, on the latent the node makes for these lengths (clip_frames:
    17n + 5 frames = 5n + 2 tokens), by the same scene_windows the wrapper calls at sample time. Only their later
    windows read the node's `later_conds`, so the node builds that extra prompt only for them: each build is one more
    text + picture + audio encode (review 10-22: it was built for every scene a person joins in)."""
    count = {}
    for w in scene_windows(5 * ((clip_frames(lengths) - 5) // CHUNK_FRAMES) + 2, 1, lengths) or []:
        count[w[4]] = count.get(w[4], 0) + 1
    return {s for s, n in count.items() if n > 1}


MAX_WORDS = 2000
MAX_NAME = 512
FITS = ("cut", "fit")


def _unit(v, fallback=0.5):
    return min(1.0, max(0.0, _num(v, fallback)))


def parse_state(raw):
    """The node's TimelineState JSON (untrusted) -> {"scenes": [...]} with every field clean:
    length (s), words, picture (an input-folder filename or None), role ("look" / "person"), x, y (where the cut
    sits, 0..1) and fit ("cut" / "fit"). Always at least one scene."""
    import json
    try:
        data = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw if isinstance(raw, dict) else {})
    except (ValueError, TypeError):
        data = {}
    scenes = data.get("scenes") if isinstance(data, dict) else None
    out = []
    for sc in (scenes if isinstance(scenes, list) else [])[:MAX_SCENES]:
        if not isinstance(sc, dict):
            continue
        pic = sc.get("picture")
        pic = pic.strip()[:MAX_NAME] if isinstance(pic, str) and pic.strip() else None
        out.append({
            "length": clean_lengths([sc.get("length")])[0],
            "words": str(sc.get("words") or "")[:MAX_WORDS],
            "picture": pic,
            "role": "person" if sc.get("role") == "person" else "look",
            "x": _unit(sc.get("x")),
            "y": _unit(sc.get("y")),
            "fit": sc.get("fit") if sc.get("fit") in FITS else "cut",
        })
    if not out:
        out = [{"length": SCENE_DEFAULT_S, "words": "", "picture": None, "role": "look", "x": 0.5, "y": 0.5, "fit": "cut"}]
    return {"scenes": out}


def cut_box(src_w, src_h, w, h, x=0.5, y=0.5):
    """Cut to fill: scale a src_w x src_h picture to COVER w x h, then the w x h window at (x, y) (0 = left / top,
    1 = right / bottom of the room there is). -> (scaled_w, scaled_h, left, top)."""
    s = max(w / float(src_w), h / float(src_h))
    sw, sh = max(w, int(round(src_w * s))), max(h, int(round(src_h * s)))
    return sw, sh, int(round((sw - w) * _unit(x))), int(round((sh - h) * _unit(y)))


def fit_box(src_w, src_h, w, h):
    """Fit inside: scale to fit w x h whole; -> (scaled_w, scaled_h, left, top) of the picture on a w x h canvas."""
    s = min(w / float(src_w), h / float(src_h))
    sw, sh = max(1, min(w, int(round(src_w * s)))), max(1, min(h, int(round(src_h * s))))
    return sw, sh, (w - sw) // 2, (h - sh) // 2


def describe_scenes(lengths, frames):
    """Human numbers: [(start s, end s)] per scene as the borders really land, for the node's readout."""
    chunks = (int(frames) - 5) // CHUNK_FRAMES
    b = scene_bounds(lengths, chunks)
    end = int(frames) / FPS
    return [(round(b[i] * CHUNK_FRAMES / FPS, 2), round(end if i == len(b) - 2 else b[i + 1] * CHUNK_FRAMES / FPS, 2))
            for i in range(len(b) - 1)]
