#!/usr/bin/env python3
"""
Generate worker/dist/worker.py -- the single self-contained Python file that
gets deployed as the Cloudflare Worker.

Why this exists: the Terraform provider's `cloudflare_workers_script` takes
ONE `content_file` for a Python worker; there is no multi-module upload. So
the worker can't just `import build_live_data`. Rather than maintain a second
copy of the transform (the exact drift that event_ticker_map.json was
centralized to prevent), this inlines the real module at build time --
scripts/build_live_data.py stays the single source of truth.

Two marker lines in worker/entry.py are substituted:
  # __INLINE_BUILD_LIVE_DATA__   -> scripts/build_live_data.py, CLI block stripped
  # __INLINE_EVENT_MAP__         -> EVENT_MAP = {...} from event_ticker_map.json

The output is tracked in git so `tofu plan` can hash it without having to run
a build step first. Re-run this after touching entry.py, build_live_data.py,
or event_ticker_map.json; CI/pre-commit can assert freshness with --check.

Usage:
    python3 worker/build.py
    python3 worker/build.py --check
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY_PATH = ROOT / "worker" / "entry.py"
TRANSFORM_PATH = ROOT / "scripts" / "build_live_data.py"
EVENT_MAP_PATH = ROOT / "scripts" / "event_ticker_map.json"
DIST_PATH = ROOT / "worker" / "dist" / "worker.py"

TRANSFORM_MARKER = "# __INLINE_BUILD_LIVE_DATA__"
EVENT_MAP_MARKER = "# __INLINE_EVENT_MAP__"

# The worker's entry file runs as __main__, so build_live_data.py's
# `if __name__ == "__main__": main()` block WOULD fire on every cold start and
# blow up on the missing filesystem. Everything from that line down is the
# standalone CLI, which the worker never uses -- cut it.
CLI_SENTINEL = 'if __name__ == "__main__":'

HEADER = '''# ---------------------------------------------------------------------------
# GENERATED FILE -- DO NOT EDIT.
#
# Built by worker/build.py from:
#   worker/entry.py                 (Cloudflare handlers + fetch layer)
#   scripts/build_live_data.py      (the transform, inlined verbatim)
#   scripts/event_ticker_map.json   (inlined as EVENT_MAP)
#
# Edit those and re-run `python3 worker/build.py`.
# ---------------------------------------------------------------------------
'''


def transform_source() -> str:
    src = TRANSFORM_PATH.read_text()
    idx = src.find(CLI_SENTINEL)
    if idx == -1:
        raise SystemExit(
            f"{TRANSFORM_PATH}: expected a {CLI_SENTINEL!r} block to strip and found none. "
            "If the CLI entry point was renamed, update CLI_SENTINEL here."
        )
    body = src[:idx].rstrip()
    return (
        "# --- begin inlined scripts/build_live_data.py ---\n"
        f"{body}\n"
        "# --- end inlined scripts/build_live_data.py ---"
    )


def event_map_source() -> str:
    raw = json.loads(EVENT_MAP_PATH.read_text())
    # Same filter as build_live_data.load_event_map(): `_`-prefixed keys are
    # comments/notes in that file, not real event tickers.
    event_map = {k: v for k, v in raw.items() if not k.startswith("_")}
    literal = json.dumps(event_map, indent=4, sort_keys=True)
    return (
        f"# --- inlined scripts/event_ticker_map.json ({len(event_map)} events) ---\n"
        f"EVENT_MAP = {literal}"
    )


def render() -> str:
    entry = ENTRY_PATH.read_text()
    for marker in (TRANSFORM_MARKER, EVENT_MAP_MARKER):
        if marker not in entry:
            raise SystemExit(f"{ENTRY_PATH}: missing marker line {marker!r}")
    entry = entry.replace(TRANSFORM_MARKER, transform_source())
    entry = entry.replace(EVENT_MAP_MARKER, event_map_source())
    return HEADER + "\n" + entry


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true",
                        help="exit non-zero if the committed dist file is stale, without writing it")
    parser.add_argument("--json", action="store_true",
                        help="with --check, report on stdout as JSON (for tofu's external data source)")
    parser.add_argument("--output", type=Path, default=DIST_PATH,
                        help="where to write the bundle (default: %(default)s)")
    args = parser.parse_args()

    rendered = render()

    if args.check:
        current = args.output.read_text() if args.output.exists() else None
        fresh = current == rendered
        if not fresh:
            print(f"{args.output} is out of date -- run `python3 worker/build.py`", file=sys.stderr)
            return 1
        # data "external" requires a JSON object of strings on stdout.
        print(json.dumps({"fresh": "true", "path": str(args.output)}) if args.json
              else f"{args.output} is up to date.")
        return 0

    # Byte-compile as a cheap syntax check -- a broken bundle should fail here,
    # not on a Cloudflare cold start. Before writing, so a bad render never
    # lands on disk.
    compile(rendered, str(args.output), "exec")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered)
    print(f"Wrote {args.output} ({len(rendered.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
