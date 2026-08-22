#!/usr/bin/env python3
"""
Second retry pass: corrected LA ticker, KY confirmed (uses the SENATELA-26
ticker -- a naming leftover on Kalshi's side, not actually Louisiana), plus
the remaining races that were rate-limited last time.

Usage: python3 discover_tickers_retry2.py
"""
import json
import time
import urllib.request
import urllib.error

BASE = "https://external-api.kalshi.com/trade-api/v2/markets"

# Confirmed via browser: KY genuinely lives under SENATELA-26 (Kalshi's
# labeling bug), and real Louisiana is KXSENATELA-26NOV.
RETRY_EVENTS = {
    "KY": "SENATELA-26",
    "LA": "KXSENATELA-26NOV",
    "ME": "SENATEME-26",
    "MN": "SENATEMN-26",
    "MT": "SENATEMT-26",
    "NC": "SENATENC-26",
    "NH": "SENATENH-26",
    "NM": "SENATENM-26",
    "OHS": "SENATEOHS-26",
    "OR": "SENATEOR-26",
    "SC": "SENATESC-26",
    "SD": "SENATESD-26",
    "TX": "SENATETX-26",
    "WV": "SENATEWV-26",
    "CONTROLS": "CONTROLS-2026",
}


def fetch_event_markets(event_ticker: str, max_retries: int = 5):
    url = f"{BASE}?event_ticker={event_ticker}"
    req = urllib.request.Request(url, headers={"accept": "application/json"})
    delay = 3
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.load(resp)
                return data.get("markets", [])
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                print(f"    429 -- backing off {delay}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(delay)
                delay *= 2
                continue
            print(f"    HTTP {e.code} for {event_ticker}")
            return []
        except urllib.error.URLError as e:
            print(f"    Network error for {event_ticker}: {e.reason}")
            return []
    return []


def main():
    results = {}
    for label, event_ticker in RETRY_EVENTS.items():
        print(f"--- {label} ({event_ticker}) ---")
        markets = fetch_event_markets(event_ticker)
        if not markets:
            print("    (still no markets -- needs manual DevTools check)")
        for m in markets:
            print(f"    {m['ticker']}  {m['last_price_dollars']}  ({m.get('yes_sub_title', '')})")
        results[label] = {"event_ticker": event_ticker, "markets": markets}
        time.sleep(2.5)  # slower this time -- 429s suggest we're close to a rate limit

    with open("kalshi_discovery_retry2_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nSaved to kalshi_discovery_retry2_results.json")


if __name__ == "__main__":
    main()