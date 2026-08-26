#!/usr/bin/env python3
"""Build the deployed web/ assets from their readable sources in web-src/.

web-src/ holds the actual editable, commented source for app.js, map.js, and
index.html. web/ holds what actually gets served (via GitHub Pages, see
.github/workflows/deploy-pages.yml) and is checked against the 14KB-per-file
budget by scripts/check_bundle_size.py. This script produces the latter from
the former:

- app.js / map.js: minified via `esbuild --minify` (requires Node/npx;
  esbuild itself is fetched on demand via `npx --yes`, no local install
  needed). Comments, whitespace, and identifiers are all stripped/mangled --
  do not hand-edit web/app.js or web/map.js, edit web-src/ and rebuild.
- index.html: HTML/CSS comments, indentation, and blank lines are stripped.
  Selectors/rules/markup are otherwise untouched (no CSS minification beyond
  whitespace), so this stays easy to diff against web-src/index.html.

senate-shared.js is small enough to ship as-is and has no web-src/ copy --
edit web/senate-shared.js directly.

Usage: scripts/build_web.py [--check]
  --check: build to a temp location and diff against the committed web/
           files instead of overwriting them; exits 1 on any difference
           (useful in CI to catch a forgotten rebuild).
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web-src"
WEB = ROOT / "web"

JS_FILES = ["app.js", "map.js"]
HTML_FILES = ["index.html"]


def minify_js(src_path: Path, out_path: Path):
    result = subprocess.run(
        ["npx", "--yes", "esbuild", str(src_path), "--minify", "--format=esm"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"esbuild failed on {src_path}:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    out_path.write_text(result.stdout)


def minify_html(src_path: Path, out_path: Path):
    src = src_path.read_text()
    no_html_comments = re.sub(r"[ \t]*<!--.*?-->\n?", "", src, flags=re.S)
    no_comments = re.sub(r"[ \t]*/\*.*?\*/\n?", "", no_html_comments, flags=re.S)
    lines = [l.strip() for l in no_comments.split("\n")]
    out = [l for l in lines if l != ""]
    out_path.write_text("\n".join(out) + "\n")


def build(out_dir: Path):
    for name in JS_FILES:
        minify_js(SRC / name, out_dir / name)
    for name in HTML_FILES:
        minify_html(SRC / name, out_dir / name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="Build to a temp dir and diff against web/ instead of writing.",
    )
    args = parser.parse_args()

    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            build(tmp_path)
            stale = []
            for name in JS_FILES + HTML_FILES:
                built = (tmp_path / name).read_bytes()
                committed = (WEB / name).read_bytes()
                if built != committed:
                    stale.append(name)
            if stale:
                print("Stale build output -- run scripts/build_web.py:")
                for name in stale:
                    print(f"  web/{name}")
                return 1
            print("web/ is up to date with web-src/.")
            return 0

    build(WEB)
    for name in JS_FILES + HTML_FILES:
        size = (WEB / name).stat().st_size
        print(f"  web/{name}: {size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
