#!/usr/bin/env python3
"""
Transform a raw Kalshi discovery dump ({event_ticker: [raw market objects]})
into the UI-ready live-senate-data.json shape ({ fetchedAt, controlsMarket,
races, failedStates }, per design_handoff_senate_tracker/README.md).

Normally used as a library: script.py imports build() and load_event_map()
directly and calls them in-memory against a fresh Kalshi pull, writing
straight to web/live-senate-data.json -- there's no on-disk raw-dump file in
that path.

This file also runs standalone via its own CLI, for manually rebuilding from
a raw dump saved to disk (e.g. while debugging a specific run's data):

Usage: python3 scripts/build_live_data.py --input path/to/dump.json
       python3 scripts/build_live_data.py --input path/to/dump.json --output path/to/out.json
"""
import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

# These path defaults only matter to the standalone CLI. The Cloudflare worker
# inlines this module into a single generated file (see worker/build.py) where
# there is no __file__ to resolve, so guard rather than blow up at import.
ROOT = (Path(__file__).resolve().parent.parent
        if "__file__" in globals() else Path.cwd())
INPUT_PATH = ROOT / "latest_kalshi_discovery.json"
EVENT_MAP_PATH = ROOT / "scripts" / "event_ticker_map.json"
OUTPUT_PATH = ROOT / "web" / "live-senate-data.json"

CONTROLS_EVENT_TICKER = "CONTROLS-2026"

# Kalshi lists a generic party name as the "candidate" when that party's
# primary hasn't resolved yet (e.g. 'Democratic party', 'Republican Party',
# 'Democratic (DFL) Party' -- casing is inconsistent across events). Checked
# custom_strike's `politician` id as a cleaner structured signal first, but
# it's populated inconsistently even for confirmed real candidates (e.g.
# Ashley Moody in FL), so it isn't reliable. Name matching -- done once here,
# case-insensitively, rather than by the client on every render -- is still
# the most accurate signal available in this payload.
GENERIC_CANDIDATE_RE = re.compile(r"^(democratic|republican)( \(\w+\))? party$", re.IGNORECASE)

# Most events price one market per party, but a state with no party primaries
# (Alaska -- see docs/election-processes.md) is priced per *candidate*
# instead, with every name on the ballot listed. Those events carry a
# "candidateParties" map in event_ticker_map.json assigning the real
# contenders to a party lane; everyone at or below this share is a long shot
# who would otherwise land in the tooltip as a spurious "independent", so
# they're dropped before normalization and their (rounding-scale) probability
# is spread across the remaining candidates.
MINOR_CANDIDATE_THRESHOLD = 0.05


def load_event_map():
    raw = json.loads(EVENT_MAP_PATH.read_text())
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def load_previous_output(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def write_json_atomic(path: Path, payload) -> None:
    """Write via a temp file + rename so a crash mid-write never leaves
    `path` (a downstream consumer's input, or the site's live data file)
    truncated or corrupt."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    tmp_path.write_text(json.dumps(payload, indent=2) + "\n")
    os.replace(tmp_path, path)


def outcome_suffix(ticker: str, event_ticker: str) -> str:
    # e.g. "SENATENE-26-DOSB" with event_ticker "SENATENE-26" -> "DOSB"
    return ticker[len(event_ticker) + 1:]


def kalshi_url(event_ticker: str) -> str:
    """Kalshi market page URL. Verified live: https://kalshi.com/markets/{series}/{event}
    (both lowercased) redirects to the canonical page with its human slug filled
    in -- the middle slug segment isn't required. `series` is the event ticker
    with its trailing -XX segment (year/suffix) stripped, e.g.
    'SENATENE-26' -> series 'senatene'. Confirmed this also holds for the
    KX-prefixed and CONTROLS-2026 tickers."""
    series = event_ticker.rsplit("-", 1)[0].lower()
    return f"https://kalshi.com/markets/{series}/{event_ticker.lower()}"


def is_primary_pending(market) -> bool:
    name = (market.get("yes_sub_title") or "").strip()
    return bool(GENERIC_CANDIDATE_RE.match(name))


def market_price(market) -> float:
    try:
        return float(market["last_price_dollars"])
    except (KeyError, TypeError, ValueError):
        return 0.0


def market_side(ticker: str, event_ticker: str, candidate_parties):
    """Which lane a market belongs to: "D", "R", or None for anything else
    (an independent, or an unmapped candidate in a per-candidate event).

    Party-level events encode the lane in the ticker suffix itself; a
    per-candidate event's suffix is an abbreviated name, so the lane comes
    from that event's checked-in candidateParties map instead."""
    suffix = outcome_suffix(ticker, event_ticker)
    if candidate_parties is not None:
        return candidate_parties.get(suffix)
    return suffix if suffix in ("D", "R") else None


def normalize_outcomes(markets):
    """Return {ticker: normalized_probability} so a race's outcomes sum to 1.0,
    per the README: last_price_dollars values don't sum exactly due to
    bid/ask spread."""
    prices = {m["ticker"]: market_price(m) for m in markets}
    total = sum(prices.values())
    if total <= 0:
        return None
    return {t: p / total for t, p in prices.items()}


def build_race(state, race_type, event_ticker, markets, candidate_parties=None):
    if candidate_parties is not None:
        markets = [m for m in markets if market_price(m) > MINOR_CANDIDATE_THRESHOLD]

    normalized = normalize_outcomes(markets)
    if normalized is None:
        return None

    dem_market = rep_market = None
    other_tickers = []
    for m in markets:
        side = market_side(m["ticker"], event_ticker, candidate_parties)
        prob = normalized[m["ticker"]]
        if side == "D":
            dem_market = m
            dem_probability = prob
        elif side == "R":
            rep_market = m
            rep_probability = prob
        else:
            other_tickers.append({
                "candidate": m.get("yes_sub_title") or outcome_suffix(m["ticker"], event_ticker),
                "affiliation": "independent",
                "probability": prob,
            })

    if dem_market is None or rep_market is None:
        return None

    race = {
        "state": state,
        "raceType": race_type,
        "demProbability": dem_probability,
        "repProbability": rep_probability,
        "demCandidate": dem_market.get("yes_sub_title", "Democratic Party"),
        "repCandidate": rep_market.get("yes_sub_title", "Republican Party"),
        "demPrimaryPending": is_primary_pending(dem_market),
        "repPrimaryPending": is_primary_pending(rep_market),
        "kalshiUrl": kalshi_url(event_ticker),
    }
    if other_tickers:
        race["otherTickers"] = other_tickers
    return race


def stale_race(state, previous_races_by_state, previous_fetched_at, event_ticker):
    prev = previous_races_by_state.get(state)
    if prev is None:
        return None
    stale = dict(prev)
    stale["stale"] = True
    # Keep the original staleSince if this race was already stale last run
    # (so it reflects when it last had good data, not the most recent retry).
    stale["staleSince"] = prev.get("staleSince") or previous_fetched_at or "unknown"
    # Recompute rather than trust the carried-forward value, in case this
    # field didn't exist yet in the previous snapshot.
    stale["kalshiUrl"] = kalshi_url(event_ticker)
    return stale


def build_controls_market(discovery, previous):
    markets = discovery.get(CONTROLS_EVENT_TICKER)
    normalized = normalize_outcomes(markets) if markets else None
    if normalized is None:
        if previous and previous.get("controlsMarket"):
            fallback = dict(previous["controlsMarket"])
            fallback["fetchError"] = "CONTROLS-2026 fetch failed; carrying forward last-known values"
            fallback["kalshiUrl"] = kalshi_url(CONTROLS_EVENT_TICKER)
            return fallback
        return {
            "eventTicker": CONTROLS_EVENT_TICKER,
            "demProbability": 0.5,
            "repProbability": 0.5,
            "fetchError": "CONTROLS-2026 fetch failed and no previous snapshot was available",
            "kalshiUrl": kalshi_url(CONTROLS_EVENT_TICKER),
        }

    dem_probability = rep_probability = None
    for m in markets:
        suffix = outcome_suffix(m["ticker"], CONTROLS_EVENT_TICKER)
        if suffix == "D":
            dem_probability = normalized[m["ticker"]]
        elif suffix == "R":
            rep_probability = normalized[m["ticker"]]

    return {
        "eventTicker": CONTROLS_EVENT_TICKER,
        "demProbability": dem_probability,
        "repProbability": rep_probability,
        "fetchError": None,
        "kalshiUrl": kalshi_url(CONTROLS_EVENT_TICKER),
    }


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=INPUT_PATH,
                         help="raw Kalshi discovery dump (default: %(default)s)")
    parser.add_argument("--previous", type=Path, default=None,
                         help="previous live-senate-data.json to carry stale "
                              "races forward from (default: same as --output)")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH,
                         help="where to write the built file (default: %(default)s)")
    return parser.parse_args()


def build(discovery, event_map, previous):
    """Pure transform: raw discovery dump + event map + previous output ->
    the live-senate-data.json-shaped dict. No I/O."""
    previous_races_by_state = {}
    if previous:
        previous_races_by_state = {r["state"]: r for r in previous.get("races", [])}

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    previous_fetched_at = previous.get("fetchedAt") if previous else None

    races = []
    failed_states = []
    for event_ticker, info in sorted(event_map.items()):
        state = info["state"]
        race_type = info["raceType"]
        markets = discovery.get(event_ticker)

        race = build_race(state, race_type, event_ticker, markets,
                          info.get("candidateParties")) if markets else None
        if race is None:
            fallback = stale_race(state, previous_races_by_state, previous_fetched_at, event_ticker)
            failed_states.append(state)
            if fallback is not None:
                races.append(fallback)
            # else: no previous snapshot to fall back to either -- state is
            # flagged in failedStates and simply absent from races, rather
            # than ever being rendered as a 0% race.
            continue

        races.append(race)

    races.sort(key=lambda r: r["state"])

    return {
        "fetchedAt": now_iso,
        "controlsMarket": build_controls_market(discovery, previous),
        "races": races,
        "failedStates": failed_states,
    }


def main():
    args = parse_args()
    event_map = load_event_map()
    discovery = json.loads(args.input.read_text())
    previous = load_previous_output(args.previous or args.output)

    output = build(discovery, event_map, previous)
    write_json_atomic(args.output, output)

    print(f"Wrote {args.output} ({len(output['races'])} races, {len(output['failedStates'])} failed states)")
    if output["failedStates"]:
        print(f"  failedStates: {output['failedStates']}")


if __name__ == "__main__":
    main()
