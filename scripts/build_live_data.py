#!/usr/bin/env python3
"""
Transform the raw Kalshi discovery dump into the UI-ready live-senate-data.json
artifact that web/app.js fetches at runtime.

Input:  latest_kalshi_discovery.json (repo root) -- dict of event_ticker -> list
        of raw Kalshi market objects, in the same shape the discovery/fetch
        script has always produced.
Output: web/live-senate-data.json -- { fetchedAt, controlsMarket, races, failedStates }
        per design_handoff_senate_tracker/README.md.

Usage: python3 scripts/build_live_data.py
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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


def load_event_map():
    raw = json.loads(EVENT_MAP_PATH.read_text())
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def load_previous_output():
    if not OUTPUT_PATH.exists():
        return None
    try:
        return json.loads(OUTPUT_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def outcome_suffix(ticker: str, event_ticker: str) -> str:
    # e.g. "SENATENE-26-DOSB" with event_ticker "SENATENE-26" -> "DOSB"
    return ticker[len(event_ticker) + 1:]


def is_primary_pending(market) -> bool:
    name = (market.get("yes_sub_title") or "").strip()
    return bool(GENERIC_CANDIDATE_RE.match(name))


def normalize_outcomes(markets):
    """Return {ticker: normalized_probability} so a race's outcomes sum to 1.0,
    per the README: last_price_dollars values don't sum exactly due to
    bid/ask spread."""
    prices = {}
    for m in markets:
        try:
            prices[m["ticker"]] = float(m["last_price_dollars"])
        except (KeyError, TypeError, ValueError):
            prices[m["ticker"]] = 0.0
    total = sum(prices.values())
    if total <= 0:
        return None
    return {t: p / total for t, p in prices.items()}


def build_race(state, race_type, event_ticker, markets):
    normalized = normalize_outcomes(markets)
    if normalized is None:
        return None

    dem_market = rep_market = None
    other_tickers = []
    for m in markets:
        suffix = outcome_suffix(m["ticker"], event_ticker)
        prob = normalized[m["ticker"]]
        if suffix == "D":
            dem_market = m
            dem_probability = prob
        elif suffix == "R":
            rep_market = m
            rep_probability = prob
        else:
            other_tickers.append({
                "candidate": m.get("yes_sub_title", suffix),
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
    }
    if other_tickers:
        race["otherTickers"] = other_tickers
    return race


def stale_race(state, previous_races_by_state, previous_fetched_at):
    prev = previous_races_by_state.get(state)
    if prev is None:
        return None
    stale = dict(prev)
    stale["stale"] = True
    # Keep the original staleSince if this race was already stale last run
    # (so it reflects when it last had good data, not the most recent retry).
    stale["staleSince"] = prev.get("staleSince") or previous_fetched_at or "unknown"
    return stale


def build_controls_market(discovery, previous):
    markets = discovery.get(CONTROLS_EVENT_TICKER)
    normalized = normalize_outcomes(markets) if markets else None
    if normalized is None:
        if previous and previous.get("controlsMarket"):
            fallback = dict(previous["controlsMarket"])
            fallback["fetchError"] = "CONTROLS-2026 fetch failed; carrying forward last-known values"
            return fallback
        return {
            "eventTicker": CONTROLS_EVENT_TICKER,
            "demProbability": 0.5,
            "repProbability": 0.5,
            "fetchError": "CONTROLS-2026 fetch failed and no previous snapshot was available",
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
    }


def main():
    event_map = load_event_map()
    discovery = json.loads(INPUT_PATH.read_text())
    previous = load_previous_output()
    previous_races_by_state = {}
    if previous:
        previous_races_by_state = {r["state"]: r for r in previous.get("races", [])}

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    races = []
    failed_states = []
    for event_ticker, info in sorted(event_map.items()):
        state = info["state"]
        race_type = info["raceType"]
        markets = discovery.get(event_ticker)

        race = build_race(state, race_type, event_ticker, markets) if markets else None
        if race is None:
            fallback = stale_race(state, previous_races_by_state, previous.get("fetchedAt") if previous else None)
            failed_states.append(state)
            if fallback is not None:
                races.append(fallback)
            # else: no previous snapshot to fall back to either -- state is
            # flagged in failedStates and simply absent from races, rather
            # than ever being rendered as a 0% race.
            continue

        races.append(race)

    races.sort(key=lambda r: r["state"])

    output = {
        "fetchedAt": now_iso,
        "controlsMarket": build_controls_market(discovery, previous),
        "races": races,
        "failedStates": failed_states,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n")

    print(f"Wrote {OUTPUT_PATH} ({len(races)} races, {len(failed_states)} failed states)")
    if failed_states:
        print(f"  failedStates: {failed_states}")


if __name__ == "__main__":
    main()
