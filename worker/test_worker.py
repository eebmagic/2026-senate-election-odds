"""Run worker/worker.py against a stubbed Cloudflare runtime.

The stubs deliberately mirror the REAL workers-py API surface. Two production
bugs got through earlier stubs that were more convenient than accurate -- an
invented Response.new() classmethod, and a response object with no .headers --
so anything stubbed here should match what the runtime actually provides.

Usage: python3 worker/test_worker.py
"""
import asyncio, json, sys, types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---- js -------------------------------------------------------------------
class _URL:
    def __init__(self, u):
        rest = u.split("://", 1)[-1]
        self.pathname = "/" + rest.partition("/")[2].split("?")[0]
    @classmethod
    def new(cls, u): return cls(u)

js = types.ModuleType("js")
js.URL = _URL
sys.modules["js"] = js

# ---- workers (mirrors workers-py) -----------------------------------------
class Response:
    """workers-py's Response: a PYTHON class taking
    (body, status=, status_text=, headers=<dict|list>). No .new()."""
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
    def __init__(self): self.store = {}
    async def get(self, k): return self.store.get(k)
    async def put(self, k, v): self.store[k] = v

class Env:
    INGEST_TOKEN = "test-token"
    def __init__(self, kv): self.SENATE_DATA = kv

class Req:
    def __init__(self, path, method="GET", tok=None, body=None):
        self.url = "https://w.example.dev" + path
        self.method = method
        self.headers = {"authorization": tok} if tok else {}
        self._body = body
    async def text(self): return self._body

mod = types.ModuleType("worker")
mod.__dict__["__name__"] = "worker"
exec(compile((ROOT / "worker/worker.py").read_text(), "worker.py", "exec"), mod.__dict__)

# A real payload, so validation is tested against the actual shape.
LIVE = json.loads((ROOT / "web/live-senate-data.json").read_text())


async def main():
    ok = True
    kv = FakeKV(); env = Env(kv)
    handler = mod.Default(); handler.env = env

    async def call(p, m="GET", tok=None, body=None):
        return await handler.fetch(Req(p, m, tok, body))

    T = "Bearer test-token"

    print("[empty store]")
    for label, resp, want in [
        ("GET /api/live-data", await call("/api/live-data"), 404),
        ("GET /health",        await call("/health"),        404),
    ]:
        good = resp.status == want
        if not good: ok = False
        print(f"  {'ok ' if good else '!! '}{label:24} -> {resp.status} (want {want})")

    print("\n[push]")
    resp = await call("/api/live-data", "PUT", T, json.dumps(LIVE))
    body = json.loads(resp.body)
    print(f"  PUT -> {resp.status} races={body.get('races')} "
          f"fetchedAt={body.get('fetchedAt')}")
    if resp.status != 200 or body.get("races") != len(LIVE["races"]):
        ok = False; print("  !! FAIL: push should store the document")
    stored = json.loads(kv.store[mod.LIVE_KEY])
    if stored != LIVE:
        ok = False; print("  !! FAIL: stored payload must round-trip byte-identically")
    else:
        print(f"  stored payload round-trips ({len(stored['races'])} races)")

    print("\n[read back]")
    resp = await call("/api/live-data")
    if resp.status != 200 or json.loads(resp.body) != LIVE:
        ok = False; print("  !! FAIL: GET should return exactly what was pushed")
    else:
        print(f"  GET returns the pushed document; cache-control="
              f"{resp.headers.get('cache-control')}")
    alias = await call("/live-senate-data.json")
    if alias.status != 200 or alias.body != resp.body:
        ok = False; print("  !! FAIL: /live-senate-data.json alias must match")
    else:
        print("  /live-senate-data.json alias matches")

    print("\n[health]")
    resp = await call("/health")
    h = json.loads(resp.body)
    print(f"  state={h['state']} source={h['source']} races={h['races']} "
          f"age={h['dataAgeSeconds']}s stale={h['staleRaces']}")
    if h["state"] != "done" or h["source"] != "push":
        ok = False; print("  !! FAIL")
    if "dataAgeSeconds" not in h:
        ok = False; print("  !! FAIL: /health must report data age")
    if h["lastRefresh"] != h["pushedAt"]:
        ok = False; print("  !! FAIL: lastRefresh should track the push")

    print("\n[validation]")
    bad = [
        ("not JSON",           "{oops",                                    400),
        ("not an object",      json.dumps([1, 2]),                         400),
        ("no races",           json.dumps({"controlsMarket": {}}),         400),
        ("races not a list",   json.dumps({"races": {}, "controlsMarket": {}}), 400),
        ("races empty",        json.dumps({"races": [], "controlsMarket": {}}), 400),
        ("races not objects",  json.dumps({"races": [1], "controlsMarket": {}}), 400),
        ("no controlsMarket",  json.dumps({"races": [{"state": "AK"}]}),   400),
        ("valid",              json.dumps(LIVE),                           200),
    ]
    for label, payload, want in bad:
        resp = await call("/api/live-data", "PUT", T, payload)
        good = resp.status == want
        if not good: ok = False
        print(f"  {'ok ' if good else '!! '}{label:20} -> {resp.status} (want {want})")

    # A rejected push must not have replaced the good data.
    if json.loads(kv.store[mod.LIVE_KEY]) != LIVE:
        ok = False; print("  !! FAIL: a rejected push clobbered stored data")
    else:
        print("  rejected pushes left the stored document intact")

    print("\n[auth + routing]")
    class NoTok(Env): INGEST_TOKEN = None
    nohandler = mod.Default(); nohandler.env = NoTok(kv)
    checks = [
        ("PUT no auth",     await call("/api/live-data", "PUT"),               401),
        ("PUT bad token",   await call("/api/live-data", "PUT", "Bearer nope"), 401),
        ("PUT not bearer",  await call("/api/live-data", "PUT", "test-token"),  401),
        ("DELETE",          await call("/api/live-data", "DELETE"),            405),
        ("OPTIONS",         await call("/api/live-data", "OPTIONS"),           204),
        ("unknown path",    await call("/nope"),                               404),
        ("PUT, no secret set",
         await nohandler.fetch(Req("/api/live-data", "PUT", T, json.dumps(LIVE))), 401),
    ]
    for label, resp, want in checks:
        good = resp.status == want
        if not good: ok = False
        print(f"  {'ok ' if good else '!! '}{label:22} -> {resp.status} (want {want})")
    if any(r.status == 500 for _, r, _ in checks):
        ok = False; print("  !! FAIL: a route raised into the 500 handler")

    print("\n[stale reporting]")
    doc = json.loads(json.dumps(LIVE))
    doc["races"][0]["stale"] = True
    doc["failedStates"] = [doc["races"][0]["state"]]
    await call("/api/live-data", "PUT", T, json.dumps(doc))
    h = json.loads((await call("/health")).body)
    print(f"  staleRaces={h['staleRaces']} failedStates={h['failedStates']}")
    if h["staleRaces"] != [doc["races"][0]["state"]]:
        ok = False; print("  !! FAIL: /health should surface stale races")

    print("\n" + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
    return 0 if ok else 1

sys.exit(asyncio.run(main()))
