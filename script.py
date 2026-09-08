#!/usr/bin/env python3
"""
End-to-end Kalshi -> Cloudflare R2 pipeline. Fetches raw market data for every
2026 Senate race (plus the CONTROLS-2026 chamber-control market), transforms
it in-memory via scripts/build_live_data.py's build() (normalizing outcome
prices, deriving primary-pending flags, computing each race's Kalshi URL,
carrying forward stale races when a fetch failed), and uploads the result to
an R2 bucket:

  latest.json                  what the UI fetches
  snapshots/<fetchedAt>.json   immutable per-run history

Each run uploads its snapshots/<fetchedAt>.json copy FIRST; only if that
succeeds is latest.json replaced. If the history upload fails, latest.json is
left untouched. If too many tickers failed this run (see
FAILURE_RATE_ALERT_THRESHOLD), the snapshot is still uploaded for debugging
but latest.json is left on the previous good run, so one bad pull can never
clobber the live site with mostly stale/empty data. Pass --force-promote to
override that.

The built payload carries two link fields for future diffing:
  snapshotKey        this run's own history key
  previousSnapshot   the key of the run this one supersedes (null on the
                     first run), derived from the fetchedAt in latest.json

R2 config comes from a .env file at the repo root -- see .env.example and
scripts/r2_store.py. Pass --write-local to additionally (or, with no R2
config, solely) write the old on-disk artifacts: web/live-senate-data.json
and a timestamped copy under live_data_snapshots/.

The event ticker list is read from the checked-in
scripts/event_ticker_map.json, not hardcoded here, so the fetch and the
transform step can't silently drift out of sync.

Note: SENATELA-26 genuinely carries Kentucky's markets (a naming leftover on
Kalshi's side, not actually Louisiana); real Louisiana is KXSENATELA-26NOV.
Encoded in event_ticker_map.json, not here.

Usage:
    python3 script.py                      # fetch + upload to R2
    python3 script.py --dry-run            # fetch + print, no writes
    python3 script.py --write-local        # also write the on-disk artifacts
    python3 script.py --bucket other-bkt   # override $R2_BUCKET
"""
import argparse
import json
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

# Above this fraction of tickers failing, treat the run as systemically
# broken (auth change, endpoint moved, outage): don't promote it to the live
# file, and exit non-zero so a cron/CI wrapper notices. A few markets having
# a bad day stays under this and is absorbed by build()'s stale carryforward.
FAILURE_RATE_ALERT_THRESHOLD = 0.25

# scripts/ isn't a package -- import its modules by path.
sys.path.insert(0, str(ROOT / "scripts"))
import build_live_data as bld  # noqa: E402
import r2_store  # noqa: E402


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


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bucket", default=None,
                         help="R2 bucket to write latest.json / snapshots/ into "
                              "(default: $R2_BUCKET, else 'election-map')")
    parser.add_argument("--env-file", type=Path, default=r2_store.DEFAULT_ENV_PATH,
                         help="path to the .env holding R2 credentials (default: %(default)s)")
    parser.add_argument("--force-promote", action="store_true",
                         help="update latest.json with this run even if the failure-rate threshold "
                              "was exceeded (default: leave the previous good run in place)")
    parser.add_argument("--write-local", action="store_true",
                         help="also write the on-disk artifacts (web/live-senate-data.json plus a "
                              "timestamped copy under --snapshot-dir). With no R2 config this is the "
                              "only output. Default: R2 only.")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH,
                         help="--write-local: stable path to promote to (default: %(default)s)")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR,
                         help="--write-local: directory for this run's timestamped copy (default: %(default)s)")
    parser.add_argument("--keep-snapshots", type=int, default=100,
                         help="--write-local: prune --snapshot-dir to the N most recent files after a "
                              "successful run (default: %(default)s; 0 disables pruning)")
    parser.add_argument("--dry-run", action="store_true",
                         help="fetch and print, but don't write or upload anything")
    return parser.parse_args()


def main():
    args = parse_args()

    # Wire up R2 unless we're doing an offline --write-local run.
    r2 = None
    r2_config_error = None
    try:
        r2 = r2_store.R2Store.from_env(env_path=args.env_file, bucket=args.bucket)
    except r2_store.R2ConfigError as e:
        r2_config_error = e

    if r2 is None and not args.write_local and not args.dry_run:
        print(f"ERROR: R2 is not configured: {r2_config_error}\n"
              f"Fix {args.env_file} (see .env.example), or pass --write-local to "
              f"write only the on-disk artifacts.", file=sys.stderr)
        return 2

    event_map = bld.load_event_map()
    event_tickers = sorted(event_map.keys()) + [CONTROLS_EVENT_TICKER]
    print(f"Fetching {len(event_tickers)} event tickers "
          f"({len(event_tickers) - 1} races + {CONTROLS_EVENT_TICKER})...")

    discovery, failures = fetch_all(event_tickers)

    failure_rate = len(failures) / len(event_tickers)
    print(f"\nFetched {len(event_tickers) - len(failures)}/{len(event_tickers)} tickers successfully.")
    if failures:
        print(f"  Failed: {failures}")

    # `previous` feeds build()'s stale-carryforward AND the previousSnapshot
    # link. It comes from R2's latest.json; the local file is only consulted
    # in the offline --write-local path.
    previous = None
    if r2 is not None:
        try:
            previous = r2.get_json(r2_store.LATEST_KEY)
        except Exception as e:  # noqa: BLE001 -- botocore raises a wide range
            if args.dry_run:
                print(f"\nwarning: couldn't read {r2_store.LATEST_KEY} from R2 ({e}); "
                      f"continuing without stale carryforward.")
            else:
                print(f"\nERROR: couldn't read {r2_store.LATEST_KEY} from R2: {e}\n"
                      f"Aborting before any write so a transient read failure can't drop "
                      f"stale-race carryforward.", file=sys.stderr)
                return 2
    elif args.write_local:
        previous = bld.load_previous_output(args.output)
    elif args.dry_run:
        print(f"\nnote: R2 not configured ({r2_config_error}); "
              f"skipping the {r2_store.LATEST_KEY} read.")

    output = bld.build(discovery, event_map, previous)

    # Link this run to the one it supersedes, keyed the same way this run's
    # own history entry will be. previousSnapshot is null on the first run.
    output["snapshotKey"] = r2_store.snapshot_key(output["fetchedAt"])
    prev_fetched_at = previous.get("fetchedAt") if previous else None
    output["previousSnapshot"] = (
        previous.get("snapshotKey") or r2_store.snapshot_key(prev_fetched_at)
        if prev_fetched_at else None
    )

    print(f"\nBuilt {len(output['races'])} races "
          f"({len(output['failedStates'])} failed: {output['failedStates']})")
    print(f"  snapshotKey:      {output['snapshotKey']}")
    print(f"  previousSnapshot: {output['previousSnapshot']}")

    if args.dry_run:
        print("\n--dry-run: not writing or uploading anything.")
        return 1 if failure_rate > FAILURE_RATE_ALERT_THRESHOLD else 0

    healthy = failure_rate <= FAILURE_RATE_ALERT_THRESHOLD

    # --- R2: the store ---
    # Upload the immutable history entry first; only promote latest.json to it
    # if that succeeded and the run was healthy (or --force-promote).
    if r2 is not None:
        snap_key = output["snapshotKey"]
        try:
            r2.put_json(snap_key, output)
        except Exception as e:  # noqa: BLE001
            print(f"\nERROR: failed to upload {snap_key} to R2: {e}\n"
                  f"{r2_store.LATEST_KEY} left unchanged.", file=sys.stderr)
            return 3
        print(f"Uploaded s3://{r2.bucket}/{snap_key}")

        if healthy or args.force_promote:
            r2.put_json(r2_store.LATEST_KEY, output)
            print(f"Updated s3://{r2.bucket}/{r2_store.LATEST_KEY}"
                  + ("" if healthy else " (--force-promote overrode the failure-rate threshold)"))
            url = r2.public_url(r2_store.LATEST_KEY)
            if url:
                print(f"  public URL: {url}")
        else:
            print(f"\n{len(failures)}/{len(event_tickers)} tickers failed "
                  f"(> {FAILURE_RATE_ALERT_THRESHOLD:.0%} threshold). Did NOT update "
                  f"{r2_store.LATEST_KEY} -- it still points at the previous good run. "
                  f"Pass --force-promote to override.")

    # --- Local artifacts: opt-in ---
    if args.write_local:
        now = datetime.now(timezone.utc)
        snapshot_path = snapshot_path_for(args.snapshot_dir, now)
        bld.write_json_atomic(snapshot_path, output)
        print(f"Wrote {snapshot_path}")

        if healthy or args.force_promote:
            bld.write_json_atomic(args.output, output)
            print(f"Promoted it to {args.output}"
                  + ("" if healthy else " (--force-promote overrode the failure-rate threshold)"))
        else:
            print(f"Did NOT promote to {args.output} -- previous good file left in place.")

        prune_snapshots(args.snapshot_dir, args.keep_snapshots)

    return 1 if not healthy else 0


if __name__ == "__main__":
    sys.exit(main())
