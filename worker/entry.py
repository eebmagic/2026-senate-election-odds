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
               GET  /health          run state: running / done / error, plus
                                     lastRefresh and the previous run's outcome

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
import traceback
from datetime import datetime, timedelta, timezone

from js import fetch as js_fetch, AbortSignal, Object, URL
from pyodide.ffi import to_js
from workers import Response, WorkerEntrypoint

# --- inlined by worker/build.py -------------------------------------------
# __INLINE_BUILD_LIVE_DATA__
# __INLINE_EVENT_MAP__
# --------------------------------------------------------------------------

BASE = "https://external-api.kalshi.com/trade-api/v2/markets"

USER_AGENT = ("senate-election-map/1.0 "
              "(+https://github.com/eebmagic/2026-senate-election-odds)")

CONTROLS_EVENT_TICKER = "CONTROLS-2026"

# KV keys. LIVE_KEY is the only one the UI reads.
LIVE_KEY = "live-senate-data"
LAST_RUN_KEY = "last-run"
DIAG_KEY = "diag"

# LAST_RUN_KEY's "state" field, served by /health. Written once when a run
# starts and again when it settles, so a refresh is observable while it is
# still going rather than only after it finishes (~40-60s).
#
# Advisory only, NOT a lock: KV is eventually consistent, so two overlapping
# runs can both read "done" and both proceed. It also cannot self-clear if the
# isolate is killed outright (rather than raising), so a "running" record whose
# startedAt is far in the past means an abandoned run, not a live one.
STATE_RUNNING = "running"
STATE_DONE = "done"
STATE_ERROR = "error"

TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# How often the in-flight run republishes its progress to LAST_RUN_KEY. The
# dashboard's log only appears once a request finishes, so during a 40-60s run
# polling /health is the only way to see whether it is advancing or wedged --
# a bare "running" flag can't distinguish those.
#
# Kept coarse on purpose: KV allows 1 write/sec to a single key, and at the
# default 1s inter-ticker delay this lands a write roughly every 5s.
PROGRESS_EVERY_N_TICKERS = 5

# Tighter than script.py's 5/3s. Worst case per ticker here is
# MAX_RETRIES * REQUEST_TIMEOUT_SECONDS + backoff ~= 36s; at the old values a
# fully-failing run would have retried for the better part of an hour.
MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 2

# Hard ceiling on the fetch phase. Whatever hasn't been fetched when this
# expires is abandoned and counted as failed, which lets the failure-rate gate
# settle the run as unhealthy instead of the request hanging indefinitely.
RUN_DEADLINE_SECONDS = 240

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
        opts = _js_opts({"headers": {"accept": "application/json",
                                     "user-agent": USER_AGENT}})
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

        detail = ""
        try:
            detail = (await resp.text())[:200].strip()
        except Exception:
            pass

        if (status == 429 or status >= 500) and attempt < max_retries - 1:
            last_error = f"HTTP {status} {detail}".strip()
            # Honour Retry-After when the server sends one -- guessing with
            # exponential backoff against a real limiter just wastes the budget.
            retry_after = resp.headers.get("retry-after")
            if retry_after:
                try:
                    await asyncio.sleep(min(float(retry_after), 30))
                    delay *= 2
                except (TypeError, ValueError):
                    delay = await _sleep_with_jitter(delay)
            else:
                delay = await _sleep_with_jitter(delay)
            continue
        return [], f"HTTP {status} {detail}".strip()

    return [], last_error or "unknown error"


async def fetch_all(event_tickers, delay_seconds, on_progress=None):
    """Returns (discovery, failures). discovery has an entry for EVERY ticker
    (empty list on failure) -- build() depends on that shape.

    on_progress, if given, is awaited every PROGRESS_EVERY_N_TICKERS tickers
    (and once at the end) as on_progress(done, total, failures).
    """
    discovery = {}
    failures = {}
    total = len(event_tickers)
    deadline = datetime.now(timezone.utc) + timedelta(seconds=RUN_DEADLINE_SECONDS)
    for i, event_ticker in enumerate(event_tickers, 1):
        if datetime.now(timezone.utc) >= deadline:
            # Abandon the rest rather than hang. build() still gets an entry for
            # every ticker (empty list), so stale-carryforward covers them and
            # the failure-rate gate decides whether to promote.
            for remaining in event_tickers[i - 1:]:
                failures[remaining] = f"abandoned: run exceeded {RUN_DEADLINE_SECONDS}s"
                discovery[remaining] = []
            print(f"deadline hit after {i - 1}/{total} tickers; abandoning the rest")
            break
        # Printed per ticker so `wrangler tail` shows exactly which one a stalled
        # run is sitting on. The dashboard withholds logs until the request ends,
        # which is useless for diagnosing a hang.
        print(f"[{i}/{total}] fetching {event_ticker}")
        markets, error = await fetch_event_markets(event_ticker)
        print(f"[{i}/{total}] {event_ticker} -> "
              + (f"ERROR {error}" if error else f"{len(markets)} markets"))
        if error:
            failures[event_ticker] = error
        discovery[event_ticker] = markets
        if on_progress and (i % PROGRESS_EVERY_N_TICKERS == 0 or i == total):
            await on_progress(i, total, failures)
        if i < total and delay_seconds > 0:
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


def _now_iso():
    return datetime.now(timezone.utc).strftime(TIMESTAMP_FORMAT)


def _elapsed_seconds(started_iso, finished_iso):
    try:
        started = datetime.strptime(started_iso, TIMESTAMP_FORMAT)
        finished = datetime.strptime(finished_iso, TIMESTAMP_FORMAT)
    except (TypeError, ValueError):
        return None
    return round((finished - started).total_seconds(), 1)


async def run_refresh(env, trigger="cron"):
    """One full pipeline run. Returns the last-run record (also persisted to
    LAST_RUN_KEY), so the cron path and the manual /api/refresh path can't
    drift apart.

    LAST_RUN_KEY is written twice: STATE_RUNNING before the ~40-60s of Kalshi
    fetching begins, then STATE_DONE (or STATE_ERROR) once it settles. Both
    carry lastRefresh -- the last time a run actually completed -- so polling
    /health mid-run still tells you how current the data is.
    """
    kv = env.SENATE_DATA
    delay = _env_float(env, "FETCH_DELAY_MS", DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS * 1000) / 1000.0

    started_at = _now_iso()
    # Carried through every state below, so a running or failed run never
    # erases when the data was last actually refreshed.
    previous_record = await kv_get_json(kv, LAST_RUN_KEY) or {}
    last_refresh = previous_record.get("lastRefresh")

    def running_record(fetched=0, total=None, failed=0):
        return {
            "state": STATE_RUNNING,
            "trigger": trigger,
            "startedAt": started_at,
            "lastRefresh": last_refresh,
            "progress": {
                "tickersFetched": fetched,
                "tickersTotal": total,
                "tickersFailed": failed,
                "updatedAt": _now_iso(),
            },
        }

    event_tickers = sorted(EVENT_MAP.keys()) + [CONTROLS_EVENT_TICKER]
    await kv_put_json(kv, LAST_RUN_KEY, running_record(total=len(event_tickers)))

    async def report_progress(done, total, failures_so_far):
        await kv_put_json(
            kv, LAST_RUN_KEY, running_record(done, total, len(failures_so_far)))

    try:
        discovery, failures = await fetch_all(event_tickers, delay, report_progress)

        failure_rate = len(failures) / len(event_tickers)
        healthy = failure_rate <= FAILURE_RATE_ALERT_THRESHOLD

        # The currently-promoted blob feeds build()'s stale-carryforward logic.
        previous = await kv_get_json(kv, LIVE_KEY)
        output = build(discovery, EVENT_MAP, previous)

        if healthy:
            await kv_put_json(kv, LIVE_KEY, output)
    except Exception as e:
        finished_at = _now_iso()
        await kv_put_json(kv, LAST_RUN_KEY, {
            "state": STATE_ERROR,
            "trigger": trigger,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "durationSeconds": _elapsed_seconds(started_at, finished_at),
            "error": f"{type(e).__name__}: {e}",
            # Still the last time data actually landed -- this run changed nothing.
            "lastRefresh": last_refresh,
        })
        raise

    finished_at = _now_iso()
    record = {
        "state": STATE_DONE,
        "trigger": trigger,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "durationSeconds": _elapsed_seconds(started_at, finished_at),
        # Only advances when this run actually replaced the live blob; an
        # unpromoted run leaves it pointing at the last good refresh.
        "lastRefresh": finished_at if healthy else last_refresh,
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


async def run_diagnostics(env):
    """Isolate the pieces a refresh depends on, one at a time.

    Each step is written to DIAG_KEY the moment it finishes, so if a later step
    hangs forever the request never returns but `GET /diag` still shows exactly
    how far it got -- which is the whole problem with debugging a stalled run.

    Ordered cheapest-and-most-suspect first: a single fetch before any sleep,
    so a hang in one doesn't mask the result of the other.
    """
    kv = env.SENATE_DATA
    steps = []

    async def record(name, **fields):
        steps.append(dict(name=name, at=_now_iso(), **fields))
        await kv_put_json(kv, DIAG_KEY, {"startedAt": steps[0]["at"], "steps": steps})

    await record("start")

    # 1. Is AbortSignal.timeout even present in this runtime?
    try:
        AbortSignal.timeout(5000)
        await record("abort_signal_timeout", ok=True)
    except Exception as e:
        await record("abort_signal_timeout", ok=False, error=f"{type(e).__name__}: {e}")

    # 2. Real Kalshi requests. The interesting question with a 429 is what the
    #    server actually says, whether identifying ourselves changes anything,
    #    and whether it's every request or only bursts.
    async def probe(label, headers, spacing=0):
        started = _now_iso()
        try:
            if spacing:
                await asyncio.sleep(spacing)
            opts = _js_opts({"headers": headers})
            opts.signal = AbortSignal.timeout(int(REQUEST_TIMEOUT_SECONDS * 1000))
            resp = await js_fetch(f"{BASE}?event_ticker={CONTROLS_EVENT_TICKER}", opts)
            body = await resp.text()
            status = int(resp.status)
            fields = {
                "ok": True,
                "status": status,
                "startedAt": started,
                "body": body[:300].strip(),
            }
            for h in ("retry-after", "cf-ray", "x-kalshi-cache-hits",
                      "cache-control", "server", "x-ratelimit-remaining"):
                v = resp.headers.get(h)
                if v:
                    fields[h] = v
            if status == 200:
                fields["markets"] = len(json.loads(body).get("markets", []))
                fields.pop("body", None)
            await record(label, **fields)
            return status
        except Exception as e:
            await record(label, ok=False, startedAt=started,
                         error=f"{type(e).__name__}: {e}")
            return None

    plain = {"accept": "application/json"}
    identified = {"accept": "application/json", "user-agent": USER_AGENT}

    await probe("kalshi_plain", plain)
    await probe("kalshi_with_user_agent", identified)
    # Spaced retries: if these recover, it's burst throttling and a longer
    # FETCH_DELAY_MS fixes it. If all three 429, the egress IP is the problem.
    for n, gap in enumerate((3, 5, 10), start=1):
        await probe(f"kalshi_after_{gap}s", identified, spacing=gap)

    # 3. Does asyncio.sleep actually resolve here? If the event loop has no
    #    timer source this never returns and the request hangs -- but steps 1
    #    and 2 are already durable in KV by then.
    started = _now_iso()
    try:
        await asyncio.sleep(1)
        await record("asyncio_sleep_1s", ok=True, startedAt=started)
    except Exception as e:
        await record("asyncio_sleep_1s", ok=False, startedAt=started,
                     error=f"{type(e).__name__}: {e}")

    await record("done")
    return {"startedAt": steps[0]["at"], "steps": steps}


def _cors_headers(env):
    origin = getattr(env, "ALLOWED_ORIGIN", None) or "*"
    return {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
    }


def _json_response(env, payload, status=200, cache_seconds=0):
    """Build a response via the SDK's Response, which is a *Python* class taking
    (body, status=..., headers=<dict>) -- not the JS constructor, so no .new()
    and no to_js on the headers."""
    headers = {"content-type": "application/json; charset=utf-8"}
    headers.update(_cors_headers(env))
    if cache_seconds:
        headers["cache-control"] = f"public, max-age={cache_seconds}"
    else:
        headers["cache-control"] = "no-store"
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return Response(body, status=status, headers=headers)


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
        try:
            record = await run_refresh(env, trigger="cron")
        except Exception:
            # Without this the dashboard shows only "exception", not what broke.
            print(traceback.format_exc())
            raise
        # Surfaces in `wrangler tail` / the dashboard's cron invocation log.
        print(json.dumps(record))

    async def fetch(self, request):
        try:
            return await self._route(request)
        except Exception as e:
            print(traceback.format_exc())
            return _json_response(
                self.env, {"error": f"{type(e).__name__}: {e}"}, status=500)

    async def _route(self, request):
        env = self.env
        url = URL.new(request.url)
        path = url.pathname
        method = request.method

        if method == "OPTIONS":
            return Response("", status=204, headers=_cors_headers(env))

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
                # Validate the shape, not just the key: whatever lands here
                # becomes the next run's stale-carryforward baseline, so a
                # malformed races list would break every later refresh rather
                # than just this request.
                races = payload.get("races") if isinstance(payload, dict) else None
                if not isinstance(races, list) or not all(
                        isinstance(r, dict) and "state" in r for r in races):
                    return _json_response(
                        env,
                        {"error": "payload is not a live-senate-data document: "
                                  "'races' must be a list of objects with a 'state'"},
                        status=400)
                await kv_put_json(env.SENATE_DATA, LIVE_KEY, payload)
                return _json_response(
                    env, {"ok": True, "races": len(payload.get("races", []))})

            return _json_response(env, {"error": "method not allowed"}, status=405)

        if path == "/api/refresh":
            if method != "POST":
                return _json_response(env, {"error": "method not allowed"}, status=405)
            if not _authorized(request, env):
                return _json_response(env, {"error": "unauthorized"}, status=401)
            return _json_response(env, await run_refresh(env, trigger="manual"))

        if path == "/api/diag":
            if method != "POST":
                return _json_response(env, {"error": "method not allowed"}, status=405)
            if not _authorized(request, env):
                return _json_response(env, {"error": "unauthorized"}, status=401)
            return _json_response(env, await run_diagnostics(env))

        if path == "/diag":
            record = await kv_get_json(env.SENATE_DATA, DIAG_KEY)
            return _json_response(env, record or {"error": "no diagnostics recorded yet"},
                                  status=200 if record else 404)

        if path == "/health":
            record = await kv_get_json(env.SENATE_DATA, LAST_RUN_KEY)
            return _json_response(env, record or {"error": "no run recorded yet"},
                                  status=200 if record else 404)

        return _json_response(env, {"error": "not found"}, status=404)
