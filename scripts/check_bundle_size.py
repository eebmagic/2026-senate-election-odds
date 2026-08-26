#!/usr/bin/env python3
"""Enforce a per-file size budget on the page's own assets.

Inspired by https://endtimes.dev/why-your-website-should-be-under-14kb-in-size/
Starts at web/index.html, follows local references (script/link/img tags,
JS `import`/`from`/dynamic import, and `fetch()` calls) to build the actual
dependency graph, and fails if any non-vendor file exceeds the budget.

Anything under web/vendor/ (third-party libraries, map topology data) is
intentionally excluded — this checks the site's own code/markup/data, not
bundled dependencies.

Usage: scripts/check_bundle_size.py [--budget-kb N]
Exit code: 0 if all files are within budget, 1 otherwise.
"""
import argparse
import re
import sys
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"

HTML_REF_RE = re.compile(r'(?:src|href)="([^"]+)"')
# Only match actual import statements/expressions (line starts with `import`),
# not arbitrary strings elsewhere that happen to contain "from '...'" or
# "import" as a word (e.g. comments, prose in string literals).
JS_IMPORT_RE = re.compile(r'''^\s*import\b.*?['"]([^'"]+)['"]''', re.MULTILINE)
JS_DYNAMIC_IMPORT_RE = re.compile(r'''\bimport\(\s*['"]([^'"]+)['"]''')
JS_FETCH_RE = re.compile(r'''\bfetch\(\s*['"]([^'"]+)['"]''')


def is_local(ref: str) -> bool:
    if ref.startswith(("http://", "https://", "//", "mailto:", "data:")):
        return False
    if "vendor/" in ref:
        return False
    return True


def resolve(ref: str) -> Path:
    # All refs in this app are relative to web/ root (./foo.js, favicon/x.png).
    return (WEB_ROOT / ref.lstrip("./")).resolve()


def collect_dependencies() -> set[Path]:
    seen: set[Path] = set()
    entry = WEB_ROOT / "index.html"
    to_scan = [entry]
    seen.add(entry)

    while to_scan:
        path = to_scan.pop()
        if not path.exists():
            continue
        text = path.read_text(errors="replace")

        refs = []
        if path.suffix == ".html":
            refs = HTML_REF_RE.findall(text)
        elif path.suffix == ".js":
            refs = (
                JS_IMPORT_RE.findall(text)
                + JS_DYNAMIC_IMPORT_RE.findall(text)
                + JS_FETCH_RE.findall(text)
            )

        for ref in refs:
            if not is_local(ref):
                continue
            dep = resolve(ref)
            if dep not in seen:
                seen.add(dep)
                to_scan.append(dep)

    return seen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--budget-kb", type=float, default=14,
        help="Per-file size budget in KiB (default: 14)",
    )
    args = parser.parse_args()
    budget_bytes = args.budget_kb * 1024

    files = sorted(collect_dependencies(), key=lambda p: p.name)
    missing = [f for f in files if not f.exists()]
    for f in missing:
        print(f"WARNING: referenced file not found: {f}", file=sys.stderr)
    files = [f for f in files if f.exists()]

    rel = lambda p: p.relative_to(WEB_ROOT)
    max_name_len = max((len(str(rel(f))) for f in files), default=0)

    over_budget = []
    total = 0
    print(f"Budget: {args.budget_kb:g} KB ({budget_bytes:.0f} bytes) per file\n")
    for f in files:
        size = f.stat().st_size
        total += size
        flag = ""
        if size > budget_bytes:
            over = size - budget_bytes
            over_budget.append((f, size, over))
            flag = f"  OVER BUDGET by {over:.0f} bytes ({over / 1024:.1f} KB)"
        print(f"  {str(rel(f)):<{max_name_len}}  {size:>8} bytes{flag}")

    print(f"\nTotal (non-vendor): {total} bytes (~{total / 1024:.1f} KB) across {len(files)} files")

    if over_budget:
        print(f"\nFAIL: {len(over_budget)} file(s) exceed the {args.budget_kb:g}KB budget:")
        for f, size, over in over_budget:
            print(f"  {rel(f)}: {size} bytes, {over:.0f} bytes over ({over / 1024:.1f} KB over)")
        return 1

    print("\nOK: all files within budget.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
