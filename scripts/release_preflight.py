"""Release preflight: catches invisible junk and version drift before a release ships.

Run from the repo root:

    python scripts/release_preflight.py

Exits 0 when everything is clean, 1 with a report otherwise.

Why this exists: v1.4.72 shipped a pyproject.toml carrying a UTF-8 BOM (EF BB BF).
The BOM is invisible in every editor, in grep and in a diff, but tomllib refuses the
file with "Invalid statement (at line 1, column 1)", so every tool that reads the pack
metadata (ComfyUI core, ComfyUI-Manager, the Comfy Registry, pip) sees a broken pack.
It came from a Windows shell redirect, which defaults to UTF-8-WITH-BOM here.
Same family as the literal-control-character trap recorded in CLAUDE.md convention #25.
"""

import os
import subprocess
import sys

try:
    import tomllib
except ModuleNotFoundError:  # python < 3.11
    tomllib = None

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BOM = b"\xef\xbb\xbf"

# Control bytes that are never legitimate in our source, and that a shell heredoc or a
# mangled escape can inject invisibly. TAB (09), LF (0A) and CR (0D) are excluded.
BAD_CTRL = {
    0x00: "NUL",
    0x08: "BACKSPACE",
    0x0B: "VERTICAL TAB",
    0x0C: "FORM FEED",
    0x1B: "ESC",
}

# Extensions we treat as text. Anything else is assumed binary and skipped.
TEXT_EXT = {
    ".py", ".js", ".mjs", ".json", ".toml", ".md", ".css", ".html", ".svg",
    ".txt", ".yml", ".yaml", ".cfg", ".ini",
}

failures = []
checked = 0


def tracked_files():
    out = subprocess.run(
        ["git", "-C", REPO, "ls-files", "-z"], capture_output=True, check=True
    )
    return [p for p in out.stdout.decode("utf-8").split("\0") if p]


def check_files():
    """No BOM anywhere; no stray control bytes in text files."""
    global checked
    for rel in tracked_files():
        path = os.path.join(REPO, rel)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(rel)[1].lower()
        try:
            with open(path, "rb") as f:
                head = f.read(3)
                if head.startswith(BOM):
                    failures.append(
                        "%s starts with a UTF-8 BOM (EF BB BF). Rewrite it without one."
                        % rel
                    )
                if ext not in TEXT_EXT:
                    continue
                checked += 1
                data = head + f.read()
        except OSError as e:
            failures.append("%s could not be read: %s" % (rel, e))
            continue

        for i, b in enumerate(data):
            if b in BAD_CTRL:
                line = data[:i].count(b"\n") + 1
                failures.append(
                    "%s line %d contains a literal %s byte (0x%02X). "
                    "It is invisible in an editor and in grep." % (rel, line, BAD_CTRL[b], b)
                )
                break  # one report per file is enough


def check_pyproject():
    """It must parse, and its license file must exist."""
    path = os.path.join(REPO, "pyproject.toml")
    if not os.path.isfile(path):
        failures.append("pyproject.toml is missing.")
        return None
    if tomllib is None:
        failures.append("python is older than 3.11, cannot verify pyproject.toml parses.")
        return None
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
    except Exception as e:
        failures.append(
            "pyproject.toml does not parse: %s: %s\n"
            "        Every tool that reads the pack metadata will reject it."
            % (type(e).__name__, e)
        )
        return None

    project = data.get("project", {})
    lic = project.get("license")
    if isinstance(lic, dict) and "file" in lic:
        lic_path = os.path.join(REPO, lic["file"])
        if not os.path.isfile(lic_path):
            failures.append(
                'pyproject.toml points license at "%s", which does not exist in the repo.'
                % lic["file"]
            )

    comfy = data.get("tool", {}).get("comfy", {})
    for key in ("PublisherId", "DisplayName"):
        if not comfy.get(key):
            failures.append("pyproject.toml [tool.comfy] is missing %s." % key)
    if not project.get("name"):
        failures.append("pyproject.toml [project] is missing name.")
    return data


def check_version_lockstep(data):
    """pyproject version and PIXAROMA_JS_VERSION must match (the dual-bump rule)."""
    if not data:
        return
    py_ver = data.get("project", {}).get("version")
    if not py_ver:
        failures.append("pyproject.toml [project] is missing version.")
        return

    shared = os.path.join(REPO, "js", "shared", "index.mjs")
    try:
        with open(shared, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        failures.append("js/shared/index.mjs could not be read: %s" % e)
        return

    marker = "PIXAROMA_JS_VERSION"
    idx = text.find(marker)
    if idx == -1:
        failures.append("js/shared/index.mjs does not define %s." % marker)
        return
    line = text[idx : text.find("\n", idx)]
    js_ver = line.split('"')[1] if '"' in line else None
    if js_ver != py_ver:
        failures.append(
            "version drift: pyproject.toml says %s but PIXAROMA_JS_VERSION says %s.\n"
            "        Users would see a false 'browser cache outdated' warning."
            % (py_ver, js_ver)
        )


def main():
    check_files()
    data = check_pyproject()
    check_version_lockstep(data)

    if failures:
        print("RELEASE PREFLIGHT FAILED (%d problem%s)\n"
              % (len(failures), "" if len(failures) == 1 else "s"))
        for f in failures:
            print("  - %s" % f)
        print("\nDo not release until these are clean.")
        return 1

    ver = (data or {}).get("project", {}).get("version", "?")
    print("Release preflight OK. %d text files checked, version %s in lockstep." % (checked, ver))
    return 0


if __name__ == "__main__":
    sys.exit(main())
