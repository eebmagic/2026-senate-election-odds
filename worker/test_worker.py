"""Run worker/dist/worker.py against a stubbed Cloudflare runtime + fake Kalshi.

The stubs deliberately mirror the REAL workers-py API surface. An earlier
version invented a Response.new() classmethod, which hid an AttributeError
that only surfaced once deployed -- so Response here is a Python class with
no .new(), exactly like the SDK's.
"""
import asyncio, json, sys, types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---- pyodide.ffi ----------------------------------------------------------
class Opts(dict):
    def __setattr__(self, k, v): self[k] = v
    def __getattr__(self, k): return self[k]

def to_js(obj, dict_converter=None):
    return Opts(obj) if isinstance(obj, dict) else obj

pyodide = types.ModuleType("pyodide"); ffi = types.ModuleType("pyodide.ffi")
ffi.to_js = to_js; pyodide.ffi = ffi
sys.modules["pyodide"] = pyodide; sys.modules["pyodide.ffi"] = ffi

# ---- js -------------------------------------------------------------------
class FakeResp:
    def __init__(self, status, body): self.status = status; self._b = body
    async def text(self): return self._b

FAIL_TICKERS = set()

def make_markets(event, info):
    cp = info.get("candidateParties")
    if cp:
        return [{"ticker": f"{event}-{sfx}", "last_price_dollars": p,
                 "yes_sub_title": f"Cand {sfx}"}
                for sfx, p in zip(cp, ("0.62", "0.38"))]
    return [{"ticker": f"{event}-D", "last_price_dollars": "0.45", "yes_sub_title": "Dem Person"},
            {"ticker": f"{event}-R", "last_price_dollars": "0.57", "yes_sub_title": "Rep Person"}]

async def fake_fetch(url, opts):
    event = url.split("event_ticker=")[1]
    if event in FAIL_TICKERS:
        return FakeResp(500, "boom")
    if event == "CONTROLS-2026":
        m = [{"ticker": "CONTROLS-2026-D", "last_price_dollars": "0.48", "yes_sub_title": "Democrats"},
             {"ticker": "CONTROLS-2026-R", "last_price_dollars": "0.53", "yes_sub_title": "Republicans"}]
    else:
        m = make_markets(event, EVENT_MAP_RAW[event])
    return FakeResp(200, json.dumps({"markets": m}))

class _AbortSignal:
    @staticmethod
    def timeout(ms): return f"signal({ms})"

class _URL:
    def __init__(self, u):
        rest = u.split("://", 1)[-1]
        self.pathname = "/" + rest.partition("/")[2].split("?")[0]
    @classmethod
    def new(cls, u): return cls(u)

class _Object:
    @staticmethod
    def fromEntries(x): return x

js = types.ModuleType("js")
js.fetch = fake_fetch; js.Object = _Object; js.URL = _URL; js.AbortSignal = _AbortSignal
sys.modules["js"] = js

# ---- workers (mirrors workers-py) -----------------------------------------
class Response:
    def __init__(self, body=None, status=None, status_text="", headers=None,
                 web_socket=None):
        if headers is not None and not isinstance(headers, (dict, list)):
            raise TypeError(f"Received unexpected type for headers: {type(headers)}")
        if body is not None and not isinstance(body, (str, bytes)):
            raise TypeError(f"Unsupported type in Response: {type(body).__name__}")
        self.body = body
        self.status = 200 if status is None else status
        self.headers = headers or {}

class WorkerEntrypoint:
    def __init__(self, env=None): self.env = env

workers = types.ModuleType("workers")
workers.Response = Response; workers.WorkerEntrypoint = WorkerEntrypoint
sys.modules["workers"] = workers

# ---- fake KV / env --------------------------------------------------------
class FakeKV:
    def __init__(self): self.store = {}; self.history = []
    async def get(self, k): return self.store.get(k)
    async def put(self, k, v):
        self.store[k] = v
        self.history.append((k, v))
    def writes_to(self, key):
        return [json.loads(v) for k, v in self.history if k == key]

class Env:
    INGEST_TOKEN = "test-token"
    def __init__(self, kv): self.SENATE_DATA = kv; self.FETCH_DELAY_MS = "0"

EVENT_MAP_RAW = {k: v for k, v in
                 json.loads((ROOT / "scripts/event_ticker_map.json").read_text()).items()
                 if not k.startswith("_")}

mod = types.ModuleType("worker")
mod.__dict__["__name__"] = "worker"
exec(compile((ROOT / "worker/dist/worker.py").read_text(), "worker.py", "exec"), mod.__dict__)


class Req:
    def __init__(self, path, method="GET", tok=None, body=None):
        self.url = "https://w.example.dev" + path
        self.method = method
        self.headers = {"authorization": tok} if tok else {}
        self._body = body
    async def text(self): return self._body


async def main():
    ok = True
    kv = FakeKV(); env = Env(kv)
    mod.INITIAL_BACKOFF_SECONDS = 0   # real backoff is 3s doubling x5 per ticker

    print(f"EVENT_MAP inlined: {len(mod.EVENT_MAP)} events")
    assert len(mod.EVENT_MAP) == len(EVENT_MAP_RAW)

    rec = await mod.run_refresh(env)
    data = json.loads(kv.store[mod.LIVE_KEY])
    print(f"\n[healthy run] races={len(data['races'])} promoted={rec['promoted']} "
          f"failed={rec['tickersFailed']}")
    if len(data["races"]) != 35 or not rec["promoted"]:
        ok = False; print("  !! FAIL")
    ak = [r for r in data["races"] if r["state"] == "AK"][0]
    print(f"  AK per-candidate: dem={ak['demProbability']:.3f} cand={ak['demCandidate']!r}")
    c = data["controlsMarket"]
    if abs(c["demProbability"] + c["repProbability"] - 1.0) > 1e-9:
        ok = False; print("  !! FAIL: controls not normalized")

    # Run-state marker: /health must show progress DURING the run, not just after.
    runs = kv.writes_to(mod.LAST_RUN_KEY)
    states = [r["state"] for r in runs]
    fetched = [r["progress"]["tickersFetched"] for r in runs if r["state"] == "running"]
    print(f"\n[run state] {len(runs)} writes: {states[0]} -> ... -> {states[-1]}")
    print(f"  progress ticks: {fetched}")
    if states[0] != "running" or states[-1] != "done":
        ok = False; print("  !! FAIL: expected running -> done")
    if fetched != sorted(fetched) or fetched[-1] != 36:
        ok = False; print("  !! FAIL: progress should climb monotonically to 36")
    if runs[0]["progress"]["tickersTotal"] != 36:
        ok = False; print("  !! FAIL: total should be known from the first write")
    done = runs[-1]
    print(f"  done: lastRefresh={done['lastRefresh']} duration={done['durationSeconds']}s "
          f"trigger={done['trigger']}")
    if not done.get("lastRefresh") or done["trigger"] != "cron":
        ok = False; print("  !! FAIL: done record missing lastRefresh/trigger")

    good = kv.store[mod.LIVE_KEY]
    FAIL_TICKERS.update(sorted(EVENT_MAP_RAW)[:20])
    r2 = await mod.run_refresh(env)
    print(f"\n[unhealthy] failed={r2['tickersFailed']}/{r2['tickersTotal']} promoted={r2['promoted']}")
    if r2["promoted"] or kv.store[mod.LIVE_KEY] != good:
        ok = False; print("  !! FAIL: bad run must not clobber live data")
    else:
        print("  live key preserved")
    if r2["lastRefresh"] != done["lastRefresh"]:
        ok = False; print("  !! FAIL: unpromoted run must not advance lastRefresh")
    else:
        print(f"  lastRefresh held at {r2['lastRefresh']} (data really is that old)")
    if r2["state"] != "done":
        ok = False; print("  !! FAIL: an unpromoted run still settles to done")

    FAIL_TICKERS.clear(); FAIL_TICKERS.update(sorted(EVENT_MAP_RAW)[:3])
    r3 = await mod.run_refresh(env)
    stale = [r["state"] for r in json.loads(kv.store[mod.LIVE_KEY])["races"] if r.get("stale")]
    print(f"\n[partial failure] promoted={r3['promoted']} stale={stale}")
    if not r3["promoted"] or len(stale) != 3:
        ok = False; print("  !! FAIL")
    FAIL_TICKERS.clear()

    print("\n[auth]")
    if not mod._authorized(Req("/", tok="Bearer test-token"), env) or \
       mod._authorized(Req("/", tok="Bearer nope"), env) or \
       mod._authorized(Req("/"), env):
        ok = False; print("  !! FAIL: auth logic")
    class NoTok(Env): INGEST_TOKEN = None
    if mod._authorized(Req("/", tok="Bearer x"), NoTok(kv)):
        ok = False; print("  !! FAIL: unset token must deny")
    else:
        print("  valid/bad/missing correct; unset INGEST_TOKEN fails closed")

    # HTTP routes through the real handler -- this layer was previously untested,
    # which is how the Response.new() bug reached production.
    print("\n[routes]")
    handler = mod.Default(); handler.env = env
    async def call(p, m="GET", tok=None, body=None):
        return await handler.fetch(Req(p, m, tok, body))

    T = "Bearer test-token"
    good_doc = json.loads(good)   # a real document from the healthy run above
    checks = [
        ("GET /health",                await call("/health"),                    200),
        ("GET /api/live-data",         await call("/api/live-data"),             200),
        ("GET /live-senate-data.json", await call("/live-senate-data.json"),     200),
        ("OPTIONS /api/live-data",     await call("/api/live-data", "OPTIONS"),  204),
        ("GET /nope",                  await call("/nope"),                      404),
        ("POST /api/refresh no auth",  await call("/api/refresh", "POST"),       401),
        ("GET /api/refresh",           await call("/api/refresh"),               405),
        ("DELETE /api/live-data",      await call("/api/live-data", "DELETE"),   405),
        ("PUT no auth",                await call("/api/live-data", "PUT"),      401),
        ("PUT bad json",               await call("/api/live-data", "PUT", T, "{oops"), 400),
        ("PUT not a document",         await call("/api/live-data", "PUT", T, "{}"),    400),
        ("PUT malformed races",        await call("/api/live-data", "PUT", T,
                                                  json.dumps({"races": [1, 2]})),       400),
        ("PUT valid",                  await call("/api/live-data", "PUT", T,
                                                  json.dumps(good_doc)),                200),
    ]
    for label, resp, want in checks:
        good_status = resp.status == want
        if not good_status: ok = False
        print(f"  {'ok ' if good_status else '!! '}{label:28} -> {resp.status} (want {want})")
    if any(r.status == 500 for _, r, _ in checks):
        ok = False; print("  !! FAIL: a route raised into the 500 handler")

    # POST /api/refresh with auth actually runs the pipeline through the handler
    resp = await call("/api/refresh", "POST", T)
    print(f"  {'ok ' if resp.status == 200 else '!! '}POST /api/refresh authed  -> {resp.status}")
    if resp.status != 200: ok = False

    # Deadline: a run that can't finish must settle, not hang.
    print("\n[deadline]")
    kv2 = FakeKV(); env2 = Env(kv2)
    mod.RUN_DEADLINE_SECONDS = 0          # every ticker is past the deadline
    rec_d = await mod.run_refresh(env2, trigger="manual")
    mod.RUN_DEADLINE_SECONDS = 240
    print(f"  settled state={rec_d['state']} promoted={rec_d['promoted']} "
          f"failed={rec_d['tickersFailed']}/{rec_d['tickersTotal']}")
    if rec_d["state"] != "done" or rec_d["promoted"]:
        ok = False; print("  !! FAIL: expected a settled, unpromoted run")
    if rec_d["tickersFailed"] != rec_d["tickersTotal"]:
        ok = False; print("  !! FAIL: abandoned tickers should all count as failed")
    if mod.LIVE_KEY in kv2.store:
        ok = False; print("  !! FAIL: nothing should have been promoted")

    # Diagnostics endpoint records every step durably.
    print("\n[diag]")
    diag = await mod.run_diagnostics(env)
    names = [st["name"] for st in diag["steps"]]
    print(f"  steps: {names}")
    persisted = json.loads(kv.store[mod.DIAG_KEY])["steps"]
    if names[0] != "start" or names[-1] != "done":
        ok = False; print("  !! FAIL: diag should run start..done")
    if len(persisted) != len(names):
        ok = False; print("  !! FAIL: every step must be durable in KV")
    else:
        print(f"  all {len(persisted)} steps persisted to KV as they completed")

    print("\n" + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
    return 0 if ok else 1

sys.exit(asyncio.run(main()))
