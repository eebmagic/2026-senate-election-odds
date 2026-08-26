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
# __INLINE_BUILD_LIVE_DATA__
# __INLINE_EVENT_MAP__
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
