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

Local JSON files are the default output. Pass --push-to to additionally PUT the
built payload at the deployed Cloudflare worker's /api/live-data, which is how
the live site gets its data: .github/workflows/refresh-data.yml runs this script
every 12 hours with --push-to --no-write-local.

The worker itself only stores and serves the payload -- it does not fetch
Kalshi. Workers egress from IPs shared across many Cloudflare customers and
Kalshi rate-limits by IP, so the fetch has to happen somewhere with a usable
IP, which is here.

Usage:
    python3 script.py
    python3 script.py --dry-run
    python3 script.py --output /tmp/live-senate-data.json --keep-snapshots 0
    python3 script.py --push-to https://senate-data.example.workers.dev
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


def _wait_before_retry(delay: float) -> float:
    """Sleep `delay` seconds plus jitter (so many tickers hitting a rate
    limit at once don't all retry in lockstep), and return the doubled delay
    for the next attempt."""
    time.sleep(delay + random.uniform(0, delay * 0.25))
    return delay * 2


def fetch_event_markets(event_ticker: str, max_retries: int = MAX_RETRIES):
    """Fetch one event's markets. Retries with exponential backoff on 429s,
    5xx, and transient network errors. Gives up immediately on other 4xx --
    those won't resolve by retrying.

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
                delay = _wait_before_retry(delay)
                last_error = f"HTTP {e.code}"
                continue
            print(f"    HTTP {e.code} for {event_ticker}")
            return [], f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError) as e:
            reason = getattr(e, "reason", e)
            if attempt < max_retries - 1:
                print(f"    Network error ({reason}) -- backing off ~{delay:.1f}s "
                      f"(attempt {attempt + 1}/{max_retries})")
                delay = _wait_before_retry(delay)
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


def snapshot_path_for(snapshot_dir: Path, now: datetime) -> Path:
    """This run's uniquely named path under `snapshot_dir` (an immutable
    audit trail -- every run's output is kept, not just the newest)."""
    return snapshot_dir / f"{SNAPSHOT_PREFIX}{now.strftime('%Y%m%dT%H%M%SZ')}.json"


def prune_snapshots(snapshot_dir: Path, keep: int) -> None:
    """Delete all but the `keep` most recent snapshot files (by filename,
    which sorts chronologically since the timestamp is zero-padded/UTC).
    keep <= 0 disables pruning."""
    if keep <= 0 or not snapshot_dir.is_dir():
        return
    snapshots = sorted(snapshot_dir.glob(f"{SNAPSHOT_PREFIX}*.json"))
    for old in snapshots[:-keep]:
        old.unlink()


PUSH_TOKEN_ENV_VAR = "SENATE_INGEST_TOKEN"
PUSH_PATH = "/api/live-data"


def fetch_previous_from_worker(base_url: str):
    """The worker's currently-live payload, for build()'s stale-carryforward.

    Only used with --no-write-local, where there is no local file to carry
    forward from: the destination's current contents are the right baseline.
    Returns None if the worker has no data yet or is unreachable -- build()
    treats that the same as a missing previous file.
    """
    url = base_url.rstrip("/") + PUSH_PATH
    try:
        with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            return json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        reason = getattr(e, "reason", e)
        print(f"Could not read current worker data for carry-forward ({reason}); "
              "treating this run as having no previous data.", file=sys.stderr)
        return None


def push_to_worker(base_url: str, token: str, payload) -> bool:
    """PUT the built payload at the deployed worker's ingest endpoint.

    Returns True on success. Never raises -- a failed push must not lose the
    run's local output, which has already been written by the time this is
    called.
    """
    url = base_url.rstrip("/") + PUSH_PATH
    body = (json.dumps(payload, indent=2) + "\n").encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            print(f"Pushed to {url} (HTTP {resp.status}): {resp.read().decode().strip()}")
            return True
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace").strip()
        print(f"Push to {url} failed: HTTP {e.code} {detail}", file=sys.stderr)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"Push to {url} failed: {getattr(e, 'reason', e)}", file=sys.stderr)
    return False


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
    parser.add_argument("--push-to", metavar="WORKER_URL", default=None,
                         help="also PUT the built payload to this deployed worker's "
                              f"{PUSH_PATH} (e.g. https://senate-data.example.workers.dev). "
                              "Local JSON files are still written unless --no-write-local.")
    parser.add_argument("--push-token", default=os.environ.get(PUSH_TOKEN_ENV_VAR),
                         help=f"bearer token for --push-to (default: ${PUSH_TOKEN_ENV_VAR})")
    parser.add_argument("--no-write-local", action="store_true",
                         help="with --push-to, skip the local snapshot/output files entirely")
    args = parser.parse_args()
    if args.push_to and not args.push_token:
        parser.error(f"--push-to needs a token: pass --push-token or set ${PUSH_TOKEN_ENV_VAR}")
    if args.no_write_local and not args.push_to:
        parser.error("--no-write-local only makes sense together with --push-to")
    return args


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
    # promoted. With --no-write-local there is no local file to read, so the
    # baseline comes from whatever the worker is currently serving.
    if args.no_write_local:
        previous = fetch_previous_from_worker(args.push_to)
    else:
        previous = bld.load_previous_output(args.output)
    output = bld.build(discovery, event_map, previous)
    print(f"\nBuilt {len(output['races'])} races "
          f"({len(output['failedStates'])} failed: {output['failedStates']})")

    if args.dry_run:
        print("\n--dry-run: not writing any files.")
        return 1 if failure_rate > FAILURE_RATE_ALERT_THRESHOLD else 0

    now = datetime.now(timezone.utc)
    healthy = failure_rate <= FAILURE_RATE_ALERT_THRESHOLD
    promote = healthy or args.force_promote

    if not args.no_write_local:
        # Every run's output is kept as a snapshot regardless of health; only a
        # healthy run (or an explicit override) also gets promoted to the stable
        # `--output` path web/app.js actually reads.
        snapshot_path = snapshot_path_for(args.snapshot_dir, now)
        bld.write_json_atomic(snapshot_path, output)
        print(f"Wrote {snapshot_path}")

        if promote:
            bld.write_json_atomic(args.output, output)
            print(f"Promoted it to {args.output}"
                  + ("" if healthy else " (--force-promote overrode the failure-rate threshold)"))
        else:
            # Too many tickers failed to trust this run as the new live data --
            # keep the previous good web/live-senate-data.json in place.
            print(f"\n{len(failures)}/{len(event_tickers)} tickers failed "
                  f"(> {FAILURE_RATE_ALERT_THRESHOLD:.0%} threshold). Did NOT promote to {args.output} "
                  f"-- leaving the previous good file in place. Pass --force-promote to override.")

        prune_snapshots(args.snapshot_dir, args.keep_snapshots)

    if args.push_to:
        # Same promotion gate as the local file and as the worker's own cron:
        # a mostly-failed run must not become the live blob.
        if promote:
            if not push_to_worker(args.push_to, args.push_token, output):
                return 1
        else:
            print(f"Did NOT push to {args.push_to} -- same failure-rate threshold as above. "
                  "Pass --force-promote to override.", file=sys.stderr)

    # Non-zero exit lets a cron/CI wrapper alert on a systemic failure
    # (auth change, endpoint moved, outage) rather than a few markets having
    # a bad day -- those are expected to be absorbed via build()'s
    # stale-carryforward logic.
    if not healthy:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
