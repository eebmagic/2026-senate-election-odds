"""
Cloudflare Python Worker: storage and read API for the Senate live data.

This worker does NOT fetch Kalshi. It used to, on a cron trigger, but Kalshi
rate-limits by IP and Workers egress from addresses shared across many
Cloudflare customers, so essentially every request came back 429 (see the task
item for the diagnosis). The pipeline therefore runs where it has a usable IP
-- script.py, from CI or a laptop -- and pushes the finished payload here.

That makes this file small and, notably, self-contained: nothing is inlined
from scripts/, so there is no build step and no generated bundle. The
Terraform provider uploads this file directly.

Routes:
  GET  /api/live-data       public read of the current payload (also served at
                            /live-senate-data.json so the static UI can point
                            at it without a rewrite)
  PUT  /api/live-data       authed; store a payload built by script.py --push-to
  GET  /health              when data last landed, how old it is, and what the
                            last push contained

Auth is a bearer token (the INGEST_TOKEN secret) on PUT only; reads are public
because the payload is public prediction-market data.
"""
import hmac
import json
import traceback
from datetime import datetime, timezone

from js import URL
from workers import Response, WorkerEntrypoint

# KV keys. LIVE_KEY is the only one the UI reads.
LIVE_KEY = "live-senate-data"
LAST_RUN_KEY = "last-run"

TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# The data only moves every 12 hours, but a long-lived edge copy is confusing
# right after a manual push, so keep it short.
READ_CACHE_SECONDS = 300


def _now_iso():
    return datetime.now(timezone.utc).strftime(TIMESTAMP_FORMAT)


def _parse_iso(value):
    try:
        return datetime.strptime(value, TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


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


def validate_payload(payload):
    """Return an error string, or None if this looks like live-senate-data.

    Checked properly rather than loosely: whatever lands here is what the UI
    renders and what the next run carries stale races forward from, so a
    malformed push would break more than the request that made it.
    """
    if not isinstance(payload, dict):
        return "payload must be a JSON object"
    races = payload.get("races")
    if not isinstance(races, list):
        return "'races' must be a list"
    if not races:
        return "'races' is empty"
    if not all(isinstance(r, dict) and "state" in r for r in races):
        return "every entry in 'races' must be an object with a 'state'"
    if not isinstance(payload.get("controlsMarket"), dict):
        return "'controlsMarket' must be an object"
    return None


def summarize(payload, pushed_at):
    """The /health record. Derived from the payload rather than trusted from the
    client, so it can't disagree with what was actually stored."""
    races = payload.get("races", [])
    return {
        "state": "done",
        "source": "push",
        "pushedAt": pushed_at,
        # When data last landed. Named to match what the pipeline calls it.
        "lastRefresh": pushed_at,
        # When the pusher fetched from Kalshi -- earlier than pushedAt by
        # however long the run took.
        "fetchedAt": payload.get("fetchedAt"),
        "races": len(races),
        "staleRaces": sorted(r["state"] for r in races if r.get("stale")),
        "failedStates": payload.get("failedStates", []),
    }


def _cors_headers(env):
    origin = getattr(env, "ALLOWED_ORIGIN", None) or "*"
    return {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, PUT, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
    }


def _json_response(env, payload, status=200, cache_seconds=0):
    """workers-py's Response is a Python class -- (body, status=, headers=<dict>)
    -- not the JS constructor, so no .new() and no to_js on the headers."""
    headers = {"content-type": "application/json; charset=utf-8"}
    headers.update(_cors_headers(env))
    headers["cache-control"] = (
        f"public, max-age={cache_seconds}" if cache_seconds else "no-store")
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return Response(body, status=status, headers=headers)


def _authorized(request, env):
    """Constant-time bearer check. An unset secret denies rather than allows --
    a misconfigured deploy must not leave a world-writable data endpoint."""
    expected = getattr(env, "INGEST_TOKEN", None)
    if not expected:
        return False
    header = request.headers.get("authorization") or ""
    if not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):], str(expected))


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        try:
            return await self._route(request)
        except Exception as e:
            # The dashboard logs the request and "exception" but not the Python
            # error, so print the traceback and return something actionable.
            print(traceback.format_exc())
            return _json_response(
                self.env, {"error": f"{type(e).__name__}: {e}"}, status=500)

    async def _route(self, request):
        env = self.env
        path = URL.new(request.url).pathname
        method = request.method

        if method == "OPTIONS":
            return Response("", status=204, headers=_cors_headers(env))

        if path in ("/api/live-data", "/live-senate-data.json"):
            if method == "GET":
                raw = await env.SENATE_DATA.get(LIVE_KEY)
                if raw is None:
                    return _json_response(
                        env,
                        {"error": "no data yet -- run script.py --push-to"},
                        status=404)
                return _json_response(env, raw, cache_seconds=READ_CACHE_SECONDS)

            if method == "PUT":
                if not _authorized(request, env):
                    return _json_response(env, {"error": "unauthorized"}, status=401)
                try:
                    payload = json.loads(await request.text())
                except (ValueError, TypeError) as e:
                    return _json_response(env, {"error": f"invalid JSON: {e}"}, status=400)

                problem = validate_payload(payload)
                if problem:
                    return _json_response(
                        env,
                        {"error": f"not a live-senate-data document: {problem}"},
                        status=400)

                pushed_at = _now_iso()
                await kv_put_json(env.SENATE_DATA, LIVE_KEY, payload)
                record = summarize(payload, pushed_at)
                await kv_put_json(env.SENATE_DATA, LAST_RUN_KEY, record)
                print(json.dumps(record))
                return _json_response(env, {"ok": True, **record})

            return _json_response(env, {"error": "method not allowed"}, status=405)

        if path == "/health":
            record = await kv_get_json(env.SENATE_DATA, LAST_RUN_KEY)
            if record is None:
                return _json_response(
                    env, {"error": "nothing pushed yet"}, status=404)
            # Computed at read time: the whole point of /health here is spotting
            # a pusher that has silently stopped running.
            last = _parse_iso(record.get("lastRefresh"))
            if last is not None:
                record = dict(record)
                record["dataAgeSeconds"] = int(
                    (datetime.now(timezone.utc) - last).total_seconds())
            return _json_response(env, record)

        return _json_response(env, {"error": "not found"}, status=404)
