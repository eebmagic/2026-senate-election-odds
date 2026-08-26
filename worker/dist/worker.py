# ---------------------------------------------------------------------------
# GENERATED FILE -- DO NOT EDIT.
#
# Built by worker/build.py from:
#   worker/entry.py                 (Cloudflare handlers + fetch layer)
#   scripts/build_live_data.py      (the transform, inlined verbatim)
#   scripts/event_ticker_map.json   (inlined as EVENT_MAP)
#
# Edit those and re-run `python3 worker/build.py`.
# ---------------------------------------------------------------------------

"""
Cloudflare Python Worker: the cloud half of the Kalshi -> live-senate-data
pipeline. Same job as script.py, running on a 12-hourly cron trigger and
writing to Workers KV instead of the filesystem.

The transform is NOT reimplemented here. `scripts/build_live_data.py`'s
`build()` is pure (dict in, dict out, no I/O), so worker/build.py inlines that
module verbatim into the deployed artifact and this file only supplies what
has to differ in a Worker: the fetch layer (`js.fetch` instead of `urllib`,
`asyncio.sleep` instead of `time.sleep`) and KV instead of files.

Handlers:
  scheduled()  cron -> fetch Kalshi, build, promote to KV (see PROMOTION)
  fetch()      GET  /api/live-data   public read of the promoted blob
               PUT  /api/live-data   authed; accepts a payload built elsewhere
                                     (script.py --push-to), for local/manual runs
               POST /api/refresh     authed; runs the cron job on demand --
                                     the only sane way to test a deploy without
                                     waiting up to 12 hours
               GET  /health          last run's outcome, promoted or not

PROMOTION mirrors script.py exactly: every run's result is recorded, but the
key the UI reads is only repointed if at most FAILURE_RATE_ALERT_THRESHOLD of
tickers failed. One bad pull can never clobber the live site with mostly-stale
data.

Do not edit the deployed copy (worker/dist/worker.py) -- it is generated.
Edit this file or scripts/build_live_data.py and re-run worker/build.py.
"""
import asyncio
import hmac
import json
import random

from js import fetch as js_fetch, AbortSignal, Object, URL
from pyodide.ffi import to_js
from workers import Response, WorkerEntrypoint

# --- inlined by worker/build.py -------------------------------------------
# --- begin inlined scripts/build_live_data.py ---
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
# --- end inlined scripts/build_live_data.py ---
# --- inlined scripts/event_ticker_map.json (35 events) ---
EVENT_MAP = {
    "KXAKSENATE-26NOV03": {
        "_comment": "Alaska runs a top-four nonpartisan primary + RCV general and has no party primaries at all (docs/election-processes.md), so Kalshi's party-level SENATEAK-26 market labels its two outcomes 'Democratic party' / 'Republican party' permanently -- which the pipeline's generic-name heuristic read as an unresolved primary that can never resolve. This per-candidate market names the actual finalists instead. candidateParties assigns each named candidate to a party lane; anyone at or below MINOR_CANDIDATE_THRESHOLD (see build_live_data.py) is dropped before normalization, which for 2026 leaves Peltola and Sullivan.",
        "candidateParties": {
            "DSUL": "R",
            "MPEL": "D"
        },
        "raceType": "regular",
        "state": "AK"
    },
    "KXSENATELA-26NOV": {
        "raceType": "regular",
        "state": "LA"
    },
    "SENATEAL-26": {
        "raceType": "regular",
        "state": "AL"
    },
    "SENATEAR-26": {
        "raceType": "regular",
        "state": "AR"
    },
    "SENATECO-26": {
        "raceType": "regular",
        "state": "CO"
    },
    "SENATEDE-26": {
        "raceType": "regular",
        "state": "DE"
    },
    "SENATEFLS-26": {
        "raceType": "special",
        "state": "FL"
    },
    "SENATEGA-26": {
        "raceType": "regular",
        "state": "GA"
    },
    "SENATEIA-26": {
        "raceType": "regular",
        "state": "IA"
    },
    "SENATEID-26": {
        "raceType": "regular",
        "state": "ID"
    },
    "SENATEIL-26": {
        "raceType": "regular",
        "state": "IL"
    },
    "SENATEKS-26": {
        "raceType": "regular",
        "state": "KS"
    },
    "SENATELA-26": {
        "raceType": "regular",
        "state": "KY"
    },
    "SENATEMA-26": {
        "raceType": "regular",
        "state": "MA"
    },
    "SENATEME-26": {
        "raceType": "regular",
        "state": "ME"
    },
    "SENATEMI-26": {
        "raceType": "regular",
        "state": "MI"
    },
    "SENATEMN-26": {
        "raceType": "regular",
        "state": "MN"
    },
    "SENATEMS-26": {
        "raceType": "regular",
        "state": "MS"
    },
    "SENATEMT-26": {
        "raceType": "regular",
        "state": "MT"
    },
    "SENATENC-26": {
        "raceType": "regular",
        "state": "NC"
    },
    "SENATENE-26": {
        "raceType": "regular",
        "state": "NE"
    },
    "SENATENH-26": {
        "raceType": "regular",
        "state": "NH"
    },
    "SENATENJ-26": {
        "raceType": "regular",
        "state": "NJ"
    },
    "SENATENM-26": {
        "raceType": "regular",
        "state": "NM"
    },
    "SENATEOHS-26": {
        "raceType": "special",
        "state": "OH"
    },
    "SENATEOK-26": {
        "raceType": "regular",
        "state": "OK"
    },
    "SENATEOR-26": {
        "raceType": "regular",
        "state": "OR"
    },
    "SENATERI-26": {
        "raceType": "regular",
        "state": "RI"
    },
    "SENATESC-26": {
        "raceType": "regular",
        "state": "SC"
    },
    "SENATESD-26": {
        "raceType": "regular",
        "state": "SD"
    },
    "SENATETN-26": {
        "raceType": "regular",
        "state": "TN"
    },
    "SENATETX-26": {
        "raceType": "regular",
        "state": "TX"
    },
    "SENATEVA-26": {
        "raceType": "regular",
        "state": "VA"
    },
    "SENATEWV-26": {
        "raceType": "regular",
        "state": "WV"
    },
    "SENATEWY-26": {
        "raceType": "regular",
        "state": "WY"
    }
}
# --------------------------------------------------------------------------

BASE = "https://external-api.kalshi.com/trade-api/v2/markets"

CONTROLS_EVENT_TICKER = "CONTROLS-2026"

# KV keys. LIVE_KEY is the only one the UI reads.
LIVE_KEY = "live-senate-data"
LAST_RUN_KEY = "last-run"

MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 3

# See script.py: above this fraction of tickers failing, something is
# systemically wrong rather than a few markets having a bad day.
FAILURE_RATE_ALERT_THRESHOLD = 0.25

# Lower than script.py's 2.5s -- a Worker has no local rate-limit budget to
# protect and pays for wall-clock politeness in cron duration. Overridable via
# the FETCH_DELAY_MS var so it can be tuned without a redeploy.
DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS = 1.0

# Cloudflare's fetch has no built-in deadline; without this a hung upstream
# connection would stall the whole cron run.
REQUEST_TIMEOUT_SECONDS = 10


def _js_opts(obj):
    """Pyodide dict -> plain JS object (fetch/Response options)."""
    return to_js(obj, dict_converter=Object.fromEntries)


def _env_float(env, name, default):
    raw = getattr(env, name, None)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


async def _sleep_with_jitter(delay):
    """Sleep `delay` seconds plus jitter, and return the doubled delay for the
    next attempt -- script.py's _wait_before_retry, on the event loop."""
    await asyncio.sleep(delay + random.uniform(0, delay * 0.25))
    return delay * 2


async def fetch_event_markets(event_ticker, max_retries=MAX_RETRIES):
    """Fetch one event's markets. Retries with exponential backoff on 429s,
    5xx and transient network errors; gives up immediately on other 4xx.

    Returns (markets, error) -- error is None on success, else a short
    description (markets is [] in that case). Mirrors script.py's function of
    the same name.
    """
    url = f"{BASE}?event_ticker={event_ticker}"
    delay = INITIAL_BACKOFF_SECONDS
    last_error = None

    for attempt in range(max_retries):
        # Rebuilt per attempt: an AbortSignal that has already fired stays
        # aborted, so a reused one would fail every retry instantly.
        opts = _js_opts({"headers": {"accept": "application/json"}})
        opts.signal = AbortSignal.timeout(int(REQUEST_TIMEOUT_SECONDS * 1000))
        try:
            resp = await js_fetch(url, opts)
        except Exception as e:  # network-level failure surfaces as a JS error
            last_error = f"network error: {e}"
            if attempt < max_retries - 1:
                delay = await _sleep_with_jitter(delay)
                continue
            return [], last_error

        status = int(resp.status)
        if status == 200:
            try:
                return json.loads(await resp.text()).get("markets", []), None
            except (ValueError, TypeError) as e:
                # A malformed body will be malformed again immediately.
                return [], f"invalid JSON: {e}"

        if (status == 429 or status >= 500) and attempt < max_retries - 1:
            last_error = f"HTTP {status}"
            delay = await _sleep_with_jitter(delay)
            continue
        return [], f"HTTP {status}"

    return [], last_error or "unknown error"


async def fetch_all(event_tickers, delay_seconds):
    """Returns (discovery, failures). discovery has an entry for EVERY ticker
    (empty list on failure) -- build() depends on that shape."""
    discovery = {}
    failures = {}
    for i, event_ticker in enumerate(event_tickers, 1):
        markets, error = await fetch_event_markets(event_ticker)
        if error:
            failures[event_ticker] = error
        discovery[event_ticker] = markets
        if i < len(event_tickers) and delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
    return discovery, failures


async def kv_get_json(kv, key):
    raw = await kv.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


async def kv_put_json(kv, key, payload):
    await kv.put(key, json.dumps(payload, indent=2) + "\n")


async def run_refresh(env):
    """One full pipeline run. Returns the last-run record (also persisted to
    LAST_RUN_KEY), so the cron path and the manual /api/refresh path can't
    drift apart."""
    kv = env.SENATE_DATA
    delay = _env_float(env, "FETCH_DELAY_MS", DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS * 1000) / 1000.0

    event_tickers = sorted(EVENT_MAP.keys()) + [CONTROLS_EVENT_TICKER]
    discovery, failures = await fetch_all(event_tickers, delay)

    failure_rate = len(failures) / len(event_tickers)
    healthy = failure_rate <= FAILURE_RATE_ALERT_THRESHOLD

    # The currently-promoted blob feeds build()'s stale-carryforward logic.
    previous = await kv_get_json(kv, LIVE_KEY)
    output = build(discovery, EVENT_MAP, previous)

    if healthy:
        await kv_put_json(kv, LIVE_KEY, output)

    record = {
        "ranAt": output["fetchedAt"],
        "promoted": healthy,
        "tickersTotal": len(event_tickers),
        "tickersFailed": len(failures),
        "failureRate": round(failure_rate, 4),
        "failures": failures,
        "races": len(output["races"]),
        "failedStates": output["failedStates"],
    }
    if not healthy:
        record["note"] = (
            f"{len(failures)}/{len(event_tickers)} tickers failed "
            f"(> {FAILURE_RATE_ALERT_THRESHOLD:.0%} threshold). Left "
            f"'{LIVE_KEY}' on the previous good run."
        )
    await kv_put_json(kv, LAST_RUN_KEY, record)
    return record


def _cors_headers(env):
    origin = getattr(env, "ALLOWED_ORIGIN", None) or "*"
    return {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
    }


def _json_response(env, payload, status=200, cache_seconds=0):
    headers = {"content-type": "application/json; charset=utf-8"}
    headers.update(_cors_headers(env))
    if cache_seconds:
        headers["cache-control"] = f"public, max-age={cache_seconds}"
    else:
        headers["cache-control"] = "no-store"
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return Response.new(body, _js_opts({"status": status, "headers": headers}))


def _authorized(request, env):
    """Constant-time bearer check against the INGEST_TOKEN secret. An unset
    secret denies rather than allows -- a misconfigured deploy must not end up
    with a world-writable data endpoint."""
    expected = getattr(env, "INGEST_TOKEN", None)
    if not expected:
        return False
    header = request.headers.get("authorization") or ""
    if not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):], str(expected))


class Default(WorkerEntrypoint):
    async def scheduled(self, controller, env, ctx):
        record = await run_refresh(env)
        # Surfaces in `wrangler tail` / the dashboard's cron invocation log.
        print(json.dumps(record))

    async def fetch(self, request):
        env = self.env
        url = URL.new(request.url)
        path = url.pathname
        method = request.method

        if method == "OPTIONS":
            return Response.new("", _js_opts({"status": 204, "headers": _cors_headers(env)}))

        if path in ("/api/live-data", "/live-senate-data.json"):
            if method == "GET":
                raw = await env.SENATE_DATA.get(LIVE_KEY)
                if raw is None:
                    return _json_response(
                        env, {"error": "no data yet -- the cron has not run"}, status=404)
                # Short max-age: the data only moves every 12h, but a stale
                # edge copy after a manual refresh is confusing while testing.
                return _json_response(env, raw, cache_seconds=300)

            if method == "PUT":
                if not _authorized(request, env):
                    return _json_response(env, {"error": "unauthorized"}, status=401)
                try:
                    payload = json.loads(await request.text())
                except (ValueError, TypeError) as e:
                    return _json_response(env, {"error": f"invalid JSON: {e}"}, status=400)
                if not isinstance(payload, dict) or "races" not in payload:
                    return _json_response(
                        env, {"error": "payload is not a live-senate-data document"}, status=400)
                await kv_put_json(env.SENATE_DATA, LIVE_KEY, payload)
                return _json_response(
                    env, {"ok": True, "races": len(payload.get("races", []))})

            return _json_response(env, {"error": "method not allowed"}, status=405)

        if path == "/api/refresh":
            if method != "POST":
                return _json_response(env, {"error": "method not allowed"}, status=405)
            if not _authorized(request, env):
                return _json_response(env, {"error": "unauthorized"}, status=401)
            return _json_response(env, await run_refresh(env))

        if path == "/health":
            record = await kv_get_json(env.SENATE_DATA, LAST_RUN_KEY)
            return _json_response(env, record or {"error": "no run recorded yet"},
                                  status=200 if record else 404)

        return _json_response(env, {"error": "not found"}, status=404)
