#!/usr/bin/env python3
"""
End-to-end Kalshi -> web/live-senate-data.json pipeline. Fetches raw market
data for every 2026 Senate race (plus the CONTROLS-2026 chamber-control
market), transforms it in-memory via scripts/build_live_data.py's build()
(normalizing outcome prices, deriving primary-pending flags, computing each
race's Kalshi URL, carrying forward stale races when a fetch failed), and
writes the result straight to web/live-senate-data.json -- the file
web/app.js fetches at runtime.

Each run also writes its own timestamped copy under live_data_snapshots/ (an
append-only audit trail -- nothing is ever overwritten there) before
atomically repointing web/live-senate-data.json at it. If too many tickers
failed this run (see FAILURE_RATE_ALERT_THRESHOLD), the snapshot is still
written for debugging but web/live-senate-data.json is left on the previous
good run instead, so one bad pull can never clobber the live site with mostly
stale/empty data. Pass --force-promote to override that.

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
    python3 script.py --dry-run
    python3 script.py --output /tmp/live-senate-data.json --keep-snapshots 0
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://external-api.kalshi.com/trade-api/v2/markets"

ROOT = Path(__file__).resolve().parent
EVENT_MAP_PATH = ROOT / "scripts" / "event_ticker_map.json"
OUTPUT_PATH = ROOT / "web" / "live-senate-data.json"
SNAPSHOT_DIR = ROOT / "live_data_snapshots"
SNAPSHOT_PREFIX = "live-senate-data_"

CONTROLS_EVENT_TICKER = "CONTROLS-2026"

REQUEST_TIMEOUT_SECONDS = 10
DELAY_BETWEEN_REQUESTS_SECONDS = 2.5
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 3

# Above this fraction of tickers failing, something is systemically wrong
# (auth change, endpoint moved, network outage) rather than a few markets
# having a bad day -- worth a non-zero exit so a cron/CI wrapper notices.
FAILURE_RATE_ALERT_THRESHOLD = 0.25

# scripts/build_live_data.py isn't a package -- import it directly by path
# rather than shelling out, now that there's no intermediate file to hand it
# via CLI.
sys.path.insert(0, str(ROOT / "scripts"))
import build_live_data as bld  # noqa: E402


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
    matches event_ticker_map.json's + CONTROLS-2026 -- build_live_data.build()
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


def write_snapshot_and_promote(snapshot_dir: Path, latest_path: Path, payload, now: datetime) -> Path:
    """Write this run's result to its own uniquely named file under
    `snapshot_dir` (an immutable audit trail -- every run's output is kept,
    not just the newest), then atomically point `latest_path` at the same
    content. Each write is independently atomic (temp + rename, via
    build_live_data.write_json_atomic), so a crash between the two never
    corrupts either file -- worst case `latest_path` is one run behind its
    newest snapshot."""
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    snapshot_path = snapshot_dir / f"{SNAPSHOT_PREFIX}{ts}.json"
    bld.write_json_atomic(snapshot_path, payload)
    bld.write_json_atomic(latest_path, payload)
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
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH,
                         help="stable 'latest' path web/app.js fetches (default: %(default)s). "
                              "Each run also writes a timestamped, never-overwritten copy under "
                              "--snapshot-dir and then atomically repoints this path at it.")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR,
                         help="directory for this run's timestamped output copy (default: %(default)s)")
    parser.add_argument("--keep-snapshots", type=int, default=100,
                         help="prune snapshot dir to the N most recent files after a successful run "
                              "(default: %(default)s; 0 disables pruning)")
    parser.add_argument("--force-promote", action="store_true",
                         help="repoint --output at this run's snapshot even if the failure-rate threshold "
                              "was exceeded (default: leave the previous good output in place)")
    parser.add_argument("--dry-run", action="store_true",
                         help="fetch and print, but don't write any files")
    return parser.parse_args()


def main():
    args = parse_args()

    event_map = bld.load_event_map()
    event_tickers = sorted(event_map.keys()) + [CONTROLS_EVENT_TICKER]
    print(f"Fetching {len(event_tickers)} event tickers "
          f"({len(event_tickers) - 1} races + {CONTROLS_EVENT_TICKER})...")

    discovery, failures = fetch_all(event_tickers)

    failure_rate = len(failures) / len(event_tickers)
    print(f"\nFetched {len(event_tickers) - len(failures)}/{len(event_tickers)} tickers successfully.")
    if failures:
        print(f"  Failed: {failures}")

    # Previous good output feeds build()'s stale-carryforward logic --
    # captured before any write this run, whether or not this run ends up
    # promoted.
    previous = bld.load_previous_output(args.output)
    output = bld.build(discovery, event_map, previous)
    print(f"\nBuilt {len(output['races'])} races "
          f"({len(output['failedStates'])} failed: {output['failedStates']})")

    if args.dry_run:
        print("\n--dry-run: not writing any files.")
        return 1 if failure_rate > FAILURE_RATE_ALERT_THRESHOLD else 0

    now = datetime.now(timezone.utc)
    healthy = failure_rate <= FAILURE_RATE_ALERT_THRESHOLD

    if healthy or args.force_promote:
        snapshot_path = write_snapshot_and_promote(args.snapshot_dir, args.output, output, now)
        prune_snapshots(args.snapshot_dir, args.keep_snapshots)
        print(f"Wrote {snapshot_path}")
        print(f"Promoted it to {args.output}"
              + ("" if healthy else " (--force-promote overrode the failure-rate threshold)"))
    else:
        # Too many tickers failed to trust this run as the new live data --
        # keep the previous good web/live-senate-data.json in place but
        # still record what actually came back, for debugging.
        snapshot_path = args.snapshot_dir / f"{SNAPSHOT_PREFIX}{now.strftime('%Y%m%dT%H%M%SZ')}.json"
        bld.write_json_atomic(snapshot_path, output)
        prune_snapshots(args.snapshot_dir, args.keep_snapshots)
        print(f"\n{len(failures)}/{len(event_tickers)} tickers failed "
              f"(> {FAILURE_RATE_ALERT_THRESHOLD:.0%} threshold).")
        print(f"Wrote {snapshot_path} but did NOT promote it to {args.output} "
              f"-- leaving the previous good file in place. Pass --force-promote to override.")

    # Non-zero exit lets a cron/CI wrapper alert on a systemic failure
    # (auth change, endpoint moved, outage) rather than a few markets having
    # a bad day -- those are expected to be absorbed via build()'s
    # stale-carryforward logic.
    if not healthy:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
