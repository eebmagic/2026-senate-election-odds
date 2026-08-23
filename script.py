#!/usr/bin/env python3
"""
Kalshi discovery fetch: pulls raw market data for every 2026 Senate race
(plus the CONTROLS-2026 chamber-control market). Each run writes its own
timestamped copy under discovery_snapshots/ (an append-only audit trail --
nothing is ever overwritten there) and then, run health permitting, atomically
repoints latest_kalshi_discovery.json -- the stable path
scripts/build_live_data.py reads as its input contract -- at that new
snapshot. See README.md's "Rebuild logic".

If too many tickers failed this run (see FAILURE_RATE_ALERT_THRESHOLD), the
snapshot is still written for debugging but "latest" is left pointing at the
previous good run instead, so a bad pull never becomes the new source of
truth. Pass --force-promote to override that.

The event ticker list is NOT hardcoded here; it's read from the checked-in
scripts/event_ticker_map.json so this script and the transform step can never
silently drift out of sync (a state present in one but not the other used to
be a real, undetected failure mode of the old retry-pass version of this
script -- see git history).

Note: SENATELA-26 genuinely carries Kentucky's markets (a naming leftover on
Kalshi's side, not actually Louisiana); real Louisiana is
KXSENATELA-26NOV. This is encoded in event_ticker_map.json, not here.

Usage:
    python3 script.py
    python3 script.py --preview-output live-senate-data.preview.json
    python3 script.py --skip-preview
    python3 script.py --discovery-output /tmp/discovery.json --dry-run
"""
import argparse
import json
import os
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://external-api.kalshi.com/trade-api/v2/markets"

ROOT = Path(__file__).resolve().parent
EVENT_MAP_PATH = ROOT / "scripts" / "event_ticker_map.json"
BUILD_SCRIPT_PATH = ROOT / "scripts" / "build_live_data.py"
DISCOVERY_OUTPUT_PATH = ROOT / "latest_kalshi_discovery.json"
PREVIEW_OUTPUT_PATH = ROOT / "live-senate-data.preview.json"
SNAPSHOT_DIR = ROOT / "discovery_snapshots"
SNAPSHOT_PREFIX = "kalshi_discovery_"

CONTROLS_EVENT_TICKER = "CONTROLS-2026"

REQUEST_TIMEOUT_SECONDS = 10
DELAY_BETWEEN_REQUESTS_SECONDS = 2.5
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 3

# Above this fraction of tickers failing, something is systemically wrong
# (auth change, endpoint moved, network outage) rather than a few markets
# having a bad day -- worth a non-zero exit so a cron/CI wrapper notices.
FAILURE_RATE_ALERT_THRESHOLD = 0.25


def load_event_tickers() -> list[str]:
    """Source of truth for what to fetch: every event ticker in
    scripts/event_ticker_map.json, plus CONTROLS-2026 (handled separately
    there since it's chamber control, not a state race)."""
    raw = json.loads(EVENT_MAP_PATH.read_text())
    tickers = sorted(k for k in raw if not k.startswith("_"))
    tickers.append(CONTROLS_EVENT_TICKER)
    return tickers


def fetch_event_markets(event_ticker: str, max_retries: int = MAX_RETRIES):
    """Fetch one event's markets. Retries with exponential backoff (plus
    jitter, so many tickers hitting a rate limit at once don't all retry in
    lockstep) on 429s, 5xx, and transient network errors. Gives up
    immediately on other 4xx -- those won't resolve by retrying.

    Returns (markets, error) -- error is None on success, else a short
    description of what went wrong (markets is [] in that case).
    """
    url = f"{BASE}?event_ticker={event_ticker}"
    req = urllib.request.Request(url, headers={"accept": "application/json"})
    delay = INITIAL_BACKOFF_SECONDS
    last_error = None
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                data = json.load(resp)
                return data.get("markets", []), None
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and attempt < max_retries - 1:
                print(f"    HTTP {e.code} -- backing off ~{delay:.1f}s "
                      f"(attempt {attempt + 1}/{max_retries})")
                time.sleep(delay + random.uniform(0, delay * 0.25))
                delay *= 2
                last_error = f"HTTP {e.code}"
                continue
            print(f"    HTTP {e.code} for {event_ticker}")
            return [], f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError) as e:
            reason = getattr(e, "reason", e)
            if attempt < max_retries - 1:
                print(f"    Network error ({reason}) -- backing off ~{delay:.1f}s "
                      f"(attempt {attempt + 1}/{max_retries})")
                time.sleep(delay + random.uniform(0, delay * 0.25))
                delay *= 2
                last_error = f"network error: {reason}"
                continue
            print(f"    Network error for {event_ticker}: {reason}")
            return [], f"network error: {reason}"
        except json.JSONDecodeError as e:
            # Not retryable in any useful sense -- a malformed body will be
            # malformed again immediately.
            print(f"    Bad JSON for {event_ticker}: {e}")
            return [], f"invalid JSON: {e}"
    return [], last_error or "unknown error"


def fetch_all(event_tickers: list[str]):
    """Returns (discovery, failures) -- discovery is {event_ticker: markets}
    for every ticker (empty list on failure, so the dict's key set always
    matches event_ticker_map.json's + CONTROLS-2026 -- downstream code
    depends on that shape), failures is {event_ticker: error_description}
    for the ones that came back empty."""
    discovery = {}
    failures = {}
    for i, event_ticker in enumerate(event_tickers, 1):
        print(f"--- [{i}/{len(event_tickers)}] {event_ticker} ---")
        markets, error = fetch_event_markets(event_ticker)
        if error:
            failures[event_ticker] = error
        if not markets:
            print("    (no markets returned)")
        else:
            for m in markets:
                print(f"    {m.get('ticker')}  {m.get('last_price_dollars')}  "
                      f"({m.get('yes_sub_title', '')})")
        discovery[event_ticker] = markets
        if i < len(event_tickers):
            time.sleep(DELAY_BETWEEN_REQUESTS_SECONDS)
    return discovery, failures


def write_json_atomic(path: Path, payload) -> None:
    """Write via a temp file + rename so a crash mid-write never leaves
    `path` -- the file build_live_data.py reads as its input contract --
    truncated or corrupt."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    tmp_path.write_text(json.dumps(payload, indent=2) + "\n")
    os.replace(tmp_path, path)


def write_snapshot_and_promote(snapshot_dir: Path, latest_path: Path, payload, now: datetime) -> Path:
    """Write this run's result to its own uniquely named file under
    `snapshot_dir` (an immutable audit trail -- every run's raw pull is kept,
    not just the newest), then atomically point `latest_path` at the same
    content. Each write is independently atomic (temp + rename), so a crash
    between the two never corrupts either file -- worst case `latest_path`
    is one run behind its newest snapshot."""
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    snapshot_path = snapshot_dir / f"{SNAPSHOT_PREFIX}{ts}.json"
    write_json_atomic(snapshot_path, payload)
    write_json_atomic(latest_path, payload)
    return snapshot_path


def prune_snapshots(snapshot_dir: Path, keep: int) -> None:
    """Delete all but the `keep` most recent snapshot files (by filename,
    which sorts chronologically since the timestamp is zero-padded/UTC).
    keep <= 0 disables pruning."""
    if keep <= 0 or not snapshot_dir.is_dir():
        return
    snapshots = sorted(snapshot_dir.glob(f"{SNAPSHOT_PREFIX}*.json"))
    for old in snapshots[:-keep]:
        old.unlink()


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--discovery-output", type=Path, default=DISCOVERY_OUTPUT_PATH,
                         help="stable 'latest' path build_live_data.py reads (default: %(default)s). "
                              "Each run also writes a timestamped, never-overwritten copy under "
                              "--snapshot-dir and then atomically repoints this path at it.")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR,
                         help="directory for this run's timestamped raw-dump copy (default: %(default)s)")
    parser.add_argument("--keep-snapshots", type=int, default=100,
                         help="prune snapshot dir to the N most recent files after a successful run "
                              "(default: %(default)s; 0 disables pruning)")
    parser.add_argument("--force-promote", action="store_true",
                         help="repoint --discovery-output at this run's snapshot even if the failure-rate "
                              "threshold was exceeded (default: leave the previous good 'latest' in place)")
    parser.add_argument("--preview-output", type=Path, default=PREVIEW_OUTPUT_PATH,
                         help="where to write the live-senate-data.json-shaped preview "
                              "(default: %(default)s -- deliberately NOT web/live-senate-data.json)")
    parser.add_argument("--skip-preview", action="store_true",
                         help="only fetch + write the raw discovery dump; don't build the preview")
    parser.add_argument("--dry-run", action="store_true",
                         help="fetch and print, but don't write any files")
    return parser.parse_args()


def main():
    args = parse_args()

    event_tickers = load_event_tickers()
    print(f"Fetching {len(event_tickers)} event tickers "
          f"({len(event_tickers) - 1} races + {CONTROLS_EVENT_TICKER})...")

    discovery, failures = fetch_all(event_tickers)

    failure_rate = len(failures) / len(event_tickers)
    print(f"\nFetched {len(event_tickers) - len(failures)}/{len(event_tickers)} tickers successfully.")
    if failures:
        print(f"  Failed: {failures}")

    if args.dry_run:
        print("\n--dry-run: not writing any files.")
        return 1 if failure_rate > FAILURE_RATE_ALERT_THRESHOLD else 0

    now = datetime.now(timezone.utc)
    healthy = failure_rate <= FAILURE_RATE_ALERT_THRESHOLD

    if healthy or args.force_promote:
        snapshot_path = write_snapshot_and_promote(args.snapshot_dir, args.discovery_output, discovery, now)
        prune_snapshots(args.snapshot_dir, args.keep_snapshots)
        print(f"Wrote {snapshot_path}")
        print(f"Promoted it to {args.discovery_output}"
              + ("" if healthy else " (--force-promote overrode the failure-rate threshold)"))
        build_input = args.discovery_output
    else:
        # Too many tickers failed to trust this run as the new "latest" --
        # keep the previous good latest_kalshi_discovery.json in place
        # (downstream build_live_data.py keeps working off it) but still
        # record what actually came back, for debugging.
        snapshot_path = args.snapshot_dir / f"{SNAPSHOT_PREFIX}{now.strftime('%Y%m%dT%H%M%SZ')}.json"
        write_json_atomic(snapshot_path, discovery)
        prune_snapshots(args.snapshot_dir, args.keep_snapshots)
        print(f"\n{len(failures)}/{len(event_tickers)} tickers failed "
              f"(> {FAILURE_RATE_ALERT_THRESHOLD:.0%} threshold).")
        print(f"Wrote {snapshot_path} but did NOT promote it to {args.discovery_output} "
              f"-- leaving the previous good snapshot in place. Pass --force-promote to override.")
        build_input = args.discovery_output if args.discovery_output.exists() else snapshot_path

    if not args.skip_preview:
        # Build the live-senate-data.json-shaped preview via the existing,
        # unmodified transform script -- kept as a subprocess call (rather
        # than importing it) so this script has no import-time dependency on
        # build_live_data.py's internals, and so a bug in one doesn't import
        # its way into the other's process. --output points at a preview
        # path, never web/live-senate-data.json, so this never touches the
        # file the live site serves.
        result = subprocess.run(
            [sys.executable, str(BUILD_SCRIPT_PATH),
             "--input", str(build_input),
             "--previous", str(ROOT / "web" / "live-senate-data.json"),
             "--output", str(args.preview_output)],
            check=False,
        )
        if result.returncode != 0:
            print(f"build_live_data.py exited {result.returncode}", file=sys.stderr)
            return 1
        print(f"\nPreview build matches the web/live-senate-data.json shape: {args.preview_output}")
        print("(web/live-senate-data.json itself was not touched.)")

    # Non-zero exit lets a cron/CI wrapper alert on a systemic failure
    # (auth change, endpoint moved, outage) rather than a few markets having
    # a bad day -- those are expected to be absorbed downstream via
    # build_live_data.py's stale-carryforward logic.
    if not healthy:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
