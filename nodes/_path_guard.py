# nodes/_path_guard.py
"""ONE containment guard, shared by every node and every HTTP route.

WHY THIS FILE EXISTS
--------------------
ComfyUI's /prompt endpoint and our own aiohttp routes are UNAUTHENTICATED, and
nothing distinguishes "the user clicked something in the UI" from "a crafted
request arrived". So every widget value, every hidden state blob and every query
string is attacker-controlled, and any of them that reaches the filesystem needs
a containment check.

The pack already had three CORRECT containment idioms in-tree
(`_resolve_pixaroma_path`, `_load_server_image`'s realpath+startswith, and
`_font_catalog.resolve_custom_file`) - and the 2026-08-03 audit found that every
single vulnerable site was one that skipped them. Copy-paste guards drift; a
shared one cannot. Import from here, do not re-roll.

THE TWO KINDS OF PLACE
----------------------
1. FIXED roots we own (input/pixaroma, output, temp). Use `is_path_under`.
2. The user's OWN folders, for the deliberately "any folder on my machine"
   features (Save Image's any-folder save, Load Images from Folder). Use
   `folder_allowed`. See the trust model below.

THE TRUST MODEL FOR USER FOLDERS
--------------------------------
A folder is allowed when ONE of these is true:

  a) it is inside ComfyUI's own input / output / temp / user directories, or
  b) the user PICKED it in the native OS folder dialog at some point, or
  c) `allow_any` is true in the config file.

(b) is the load-bearing one, and it is what keeps this invisible to users. An
attacker CAN make the native dialog appear, but cannot choose a folder in it and
cannot click OK - that happens in the operating system, outside anything a
request can reach. So a folder that came back from that dialog was demonstrably
chosen by a human at the keyboard, which is exactly the authorisation we lack
everywhere else. `remember_folder` is therefore called ONLY from the native
picker route, never from an ordinary request body.

(c) is a deliberate escape hatch for people who script paths or type them by
hand. It is HAND-EDIT ONLY and must NEVER become settable through a route: a
route that flips it would be a one-call bypass of this whole file, which would
make the guard decorative. If you are about to add such a route, don't.

Config file: <ComfyUI user dir>/pixaroma/allowed_folders.json
    {"folders": ["D:\\\\MyArt", ...], "allow_any": false}
It lives in ComfyUI's user directory, NOT in this plugin's folder, for the same
reasons the Civitai key does: the plugin folder is a git repo (one `git add -A`
from publishing it) and a Manager reinstall would wipe it.
"""
from __future__ import annotations

import json
import os
import threading

_LOCK = threading.Lock()
_CONFIG_NAME = "allowed_folders.json"


# --------------------------------------------------------------------------
# The primitive. Moved VERBATIM from server_routes.py (2026-08-03) so there is
# exactly one copy; server_routes now imports it. Behaviour is unchanged - the
# cross-drive fallback below is load-bearing, read its comment before touching.
# --------------------------------------------------------------------------
def is_path_under(child: str, *parents: str) -> bool:
    """Return True iff `child` is inside ANY of the given parent directories.

    STRICT realpath-on-both-sides is the primary and usually the ONLY test, so
    ordinary paths behave exactly as they always have. A LEXICAL (abspath) test
    runs as a fallback for one narrow case: when the strict comparison could not
    even be made because the two sides resolved onto DIFFERENT DRIVES.

    That case is real and was a live bug (2026-07-25): splitting models across
    disks by junctioning a subfolder (e.g. models\\loras\\sd15 -> another drive)
    makes realpath(child) land on another drive than realpath(parent),
    os.path.commonpath raises ValueError("Paths don't have the same drive"), and
    we failed closed - so every LoRA behind such a junction reported "LoRA not
    found" while the very same file loaded and generated normally.

    Gating the lexical branch behind the cross-drive outcome is deliberate and
    load-bearing: a same-drive symlink that escapes a root is still refused,
    exactly as before, so the accepted surface grows ONLY by "a symlink pointing
    at another disk" - which is precisely the setup we must support. abspath
    collapses "..", so ../../ traversal can never escape either branch, and a
    remote caller only ever supplies the name, never the root.
    """
    if not child or not isinstance(child, str):
        return False
    try:
        child_abs = os.path.abspath(child)
        child_real = os.path.realpath(child)
    except (OSError, ValueError, TypeError):
        return False
    for p in parents:
        if not p or not isinstance(p, str):
            continue
        # 1) STRICT: realpath on both sides. Original behaviour, the only test
        #    for every ordinary path, so nothing is widened.
        cross_drive = False
        try:
            parent_real = os.path.realpath(p)
            if os.path.commonpath([child_real, parent_real]) == parent_real:
                return True
        except ValueError:
            # "Paths don't have the same drive" - either an unrelated root, or
            # the junction case. Only this outcome unlocks the lexical fallback.
            cross_drive = True
        except (OSError, TypeError):
            continue
        if not cross_drive:
            continue
        try:
            parent_abs = os.path.abspath(p)
            c = os.path.normcase(child_abs)
            pa = os.path.normcase(parent_abs)
            if os.path.commonpath([c, pa]) == pa:
                return True
        except (OSError, ValueError, TypeError):
            continue
    return False


def safe_join(root: str, rel) -> str:
    """Join `rel` under `root`, returning the absolute path ONLY if it stayed
    inside. Returns None on any escape, so callers read as:

        p = safe_join(input_dir, meta.get("composite_path", ""))
        if p and os.path.exists(p): ...

    THIS IS THE ONE TO REACH FOR when a node reads a path out of its hidden
    state blob. Both `os.path.join` and pathlib's `/` silently DISCARD the root
    when `rel` is absolute, and `..` walks out of it, so the join alone is never
    containment - the realpath test afterwards is. The 2026-08-03 audit found
    five sites that had the join and not the test (AudioReact, plus the
    IS_CHANGED of 3D Builder / Composer / Crop / Paint, each of which sat
    directly above a correctly-guarded loader in the same file).
    """
    if not root or not isinstance(root, str):
        return None
    try:
        candidate = os.path.realpath(os.path.join(root, str(rel or "")))
    except (OSError, ValueError, TypeError):
        return None
    return candidate if is_path_under(candidate, root) else None


# --------------------------------------------------------------------------
# ComfyUI's own roots
# --------------------------------------------------------------------------
def comfy_roots() -> list:
    """ComfyUI's input / output / temp / user directories, whichever resolve.

    folder_paths is imported lazily so this module stays importable in a unit
    test with no ComfyUI on the path (the harness relies on that).
    """
    roots = []
    try:
        import folder_paths
    except Exception:
        return roots
    for getter in (
        "get_input_directory",
        "get_output_directory",
        "get_temp_directory",
        "get_user_directory",
    ):
        try:
            d = getattr(folder_paths, getter, None)
            if callable(d):
                v = d()
                if v:
                    roots.append(v)
        except Exception:
            continue
    return roots


def _config_path() -> str:
    """<ComfyUI user dir>/pixaroma/allowed_folders.json.

    The fallback (very old ComfyUI with no get_user_directory) goes to the
    user's HOME, deliberately NOT to a `user/` folder inside this plugin.
    The plugin folder is a git working tree, and this file lists the user's
    personal folder paths - one `git add -A` from being published. Caught
    2026-08-03 when a harness with no ComfyUI on the path silently created
    `ComfyUI-Pixaroma/user/pixaroma/` inside the repo, where nothing was
    ignoring it. (`user/` is now in .gitignore as a second line of defence,
    which also covers the Civitai key's older same-shaped fallback.)
    """
    base = None
    try:
        import folder_paths
        base = folder_paths.get_user_directory()
    except Exception:
        base = None
    if not base:
        base = os.path.join(os.path.expanduser("~"), ".pixaroma")
    d = os.path.join(base, "pixaroma")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return os.path.join(d, _CONFIG_NAME)


def _read_config() -> dict:
    """Never raises. A missing or damaged file must mean 'nothing extra is
    allowed', never an exception in the middle of someone's render."""
    out = {"folders": [], "allow_any": False}
    try:
        with open(_config_path(), "r", encoding="utf-8") as f:
            obj = json.load(f)
    except Exception:
        return out
    if not isinstance(obj, dict):
        return out
    folders = obj.get("folders")
    if isinstance(folders, list):
        out["folders"] = [x for x in folders if isinstance(x, str) and x.strip()]
    out["allow_any"] = obj.get("allow_any") is True
    return out


def allow_any() -> bool:
    """True when the user hand-edited allow_any into the config. Read live (no
    cache) so an edit takes effect without restarting ComfyUI."""
    return _read_config()["allow_any"]


def remembered_folders() -> list:
    return _read_config()["folders"]


def remember_folder(path: str) -> bool:
    """Add a folder the user picked IN THE NATIVE OS DIALOG to the allowlist.

    CALL THIS FROM THE NATIVE PICKER ROUTE ONLY. The dialog is the one signal we
    have that a real person chose this, because the choice and the OK click
    happen in the operating system, not in a request we received. Calling it
    from anywhere a request body can reach would hand an attacker the ability to
    approve their own target, which is the whole thing this file prevents.
    """
    if not path or not isinstance(path, str):
        return False
    try:
        real = os.path.realpath(path)
    except (OSError, ValueError, TypeError):
        return False
    if not os.path.isdir(real):
        return False
    with _LOCK:
        cfg = _read_config()
        # Already covered (exact, or a child of something remembered)? Do
        # nothing, so the list stays short instead of growing per subfolder.
        if is_path_under(real, *cfg["folders"]):
            return True
        # Drop entries that are now children of the new, broader pick.
        kept = [f for f in cfg["folders"] if not is_path_under(f, real)]
        kept.append(real)
        cfg["folders"] = kept
        try:
            tmp = _config_path() + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2)
            os.replace(tmp, _config_path())
        except Exception:
            return False
    return True


def unc_like(p) -> bool:
    r"""True for a Windows UNC path (\\server\share, //server/share).

    Purely lexical on purpose - it must not touch the filesystem, because the
    whole point is to decide BEFORE anything does.
    """
    if not p or not isinstance(p, str):
        return False
    q = p.strip().strip('"').strip("'").replace("/", "\\")
    return q.startswith("\\\\")


def is_unc_root(p) -> bool:
    r"""True when `p` is exactly a UNC share root (\\server\share, no subpath).

    Needed because os.path.commonpath CANNOT compare such a root with a path
    inside it: splitdrive(r"\\nas\renders") == ("\\\\nas\\renders", ""), the
    empty remainder reads as a RELATIVE path, and commonpath raises
    ValueError("Can't mix absolute and relative paths"). Verified on this box
    2026-08-03. So a share root has to be matched by prefix instead.
    """
    try:
        drive, rest = os.path.splitdrive(os.path.abspath(p))
    except (OSError, ValueError, TypeError):
        return False
    return drive.replace("/", "\\").startswith("\\\\") and rest.strip("\\/") == ""


def _lexically_under_any(child: str, parents) -> bool:
    """Prefix test on abspath only - NO realpath, so no filesystem access.

    Uses startswith(parent + sep) rather than commonpath, both because
    commonpath dies on UNC share roots (see is_unc_root) and because the
    separator makes it immune to prefix confusion (D:\\Art vs D:\\Artwork).
    abspath collapses '..', so traversal cannot escape.

    Weaker than is_path_under (a symlink could fool it), which is why it is used
    only to REFUSE early, and to accept ONLY under a UNC share root the user
    themselves approved.
    """
    try:
        c = os.path.normcase(os.path.abspath(child))
    except (OSError, ValueError, TypeError):
        return False
    for p in parents or ():
        if not p or not isinstance(p, str):
            continue
        try:
            pa = os.path.normcase(os.path.abspath(p)).rstrip("\\/")
        except (OSError, ValueError, TypeError):
            continue
        if not pa:
            continue
        if c == pa or c.startswith(pa + os.sep) or c.startswith(pa + "/"):
            return True
    return False


def prescreen(raw) -> bool:
    """Cheap NO-FILESYSTEM screen to run on an untrusted folder string BEFORE
    anything calls realpath / isdir / listdir on it. False = refuse outright.

    WHY THIS EXISTS, and why the ordinary folder_allowed check is too late for
    it: on Windows, merely calling os.path.realpath or os.path.isdir on
    \\\\attacker\\share makes the machine open an SMB connection and hand over an
    NTLM hash - a classic forced-authentication leak. That damage is done during
    the resolve, i.e. before folder_allowed ever sees a resolved path. So a UNC
    value has to be judged lexically, up front.

    A UNC path is NOT banned outright, because saving to a NAS is a legitimate
    thing artists do: it is allowed once it sits under a folder the user picked
    in the native dialog. It just cannot be introduced by a request.
    """
    if allow_any():
        return True
    if unc_like(raw):
        return _lexically_under_any(raw, remembered_folders())
    return True


def folder_allowed(path: str) -> bool:
    """True when `path` is somewhere this pack may read or write.

    Order matters only for speed: ComfyUI's own roots are the common case.
    """
    if not path or not isinstance(path, str):
        return False
    if allow_any():
        return True
    roots = comfy_roots()
    if roots and is_path_under(path, *roots):
        return True
    folders = remembered_folders()
    if not folders:
        return False
    if is_path_under(path, *folders):
        return True
    # ONE narrow extra case: the approved folder is a UNC SHARE ROOT, which
    # is_path_under structurally cannot match (commonpath raises on it - see
    # is_unc_root). Fall back to the lexical prefix test for those parents only.
    # Deliberately narrow, mirroring how is_path_under gates its own cross-drive
    # fallback: the accepted surface grows by exactly "a NAS share the user
    # picked in the OS dialog", and by nothing else.
    unc_roots = [f for f in folders if is_unc_root(f)]
    return bool(unc_roots) and _lexically_under_any(path, unc_roots)


# The message every refusal shows. One string so the node, the route and the
# help all say the same thing, and so it names the fix rather than just saying
# no - a bare "denied" would read as a bug to someone whose workflow just broke.
DENIED_MESSAGE = (
    "[Pixaroma] That folder is not approved, so it was not used.\n"
    "  Folder: {path}\n"
    "  To approve it: click Browse on the node and pick this folder once - "
    "choosing it in the system dialog approves it permanently.\n"
    "  ComfyUI's own input, output and temp folders always work.\n"
    "  Power users: set \"allow_any\": true in {config}"
)


def denied_message(path: str) -> str:
    return DENIED_MESSAGE.format(path=path, config=_config_path())
