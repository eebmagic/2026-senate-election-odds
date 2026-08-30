# Cloudflare infrastructure (OpenTofu)

Provisions where the Senate data *lives*: a **Workers KV** namespace, and a
small **Python Worker** that stores and serves it.

The worker does not fetch Kalshi. It did, on a Cloudflare cron trigger, but
Workers egress from IPs shared across many Cloudflare customers and Kalshi
rate-limits by IP — nearly every request came back `429`. The pipeline now runs
where it has a usable IP (`script.py`, from GitHub Actions or a laptop) and
pushes the finished payload here. See "Why the pipeline isn't in Cloudflare".

Scope is deliberately the worker + its storage. The static UI is a later
addition to this plan.

## What gets created

| Resource | Purpose |
|---|---|
| `cloudflare_workers_kv_namespace.senate_data` | Holds `live-senate-data` (what the UI reads) and `last-run` (what the last push contained) |
| `cloudflare_workers_script.senate_data` | The worker, uploaded straight from `worker/worker.py` |
| `cloudflare_workers_script_subdomain.senate_data` | Serves it at `<worker>.<subdomain>.workers.dev` |
| `random_password.ingest_token` | Bearer token for `PUT`, unless you supply your own |

There is **no cron trigger here** — the schedule lives in
`.github/workflows/refresh-data.yml`.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/live-data` | public | The current payload; also served at `/live-senate-data.json` |
| `PUT /api/live-data` | bearer | Store a payload from `script.py --push-to` |
| `GET /health` | public | When data last landed, `dataAgeSeconds`, race/stale counts |

## Why KV and not Durable Objects

The data is one ~14 KB document, written twice a day by a single writer and
read on every page load. KV is globally replicated and edge-cached; a Durable
Object lives in one colo, so every read would be a round trip there, and it
bills compute on each. Full reasoning is in the task item.

## First-time setup

**1. Create an API token** at
<https://dash.cloudflare.com/profile/api-tokens> → Create Custom Token, with
three rows under the **Account** group:

| Group | Permission | Level |
|---|---|---|
| Account | `Workers Scripts` | **Edit** |
| Account | `Workers KV Storage` | **Edit** |
| Account | `Workers Tail` | **Read** |

Under **Account Resources**, Include → your account. No Zone permissions are
needed; the worker is served from workers.dev, not a custom domain.

Export it rather than putting it in tfvars, so it stays out of the file and the
state:

```bash
export CLOUDFLARE_API_TOKEN=...
```

**2. Fill in your account ID:**

```bash
cp terraform.tfvars.example terraform.tfvars   # set account_id
```

**3. Apply:**

```bash
cd infra
tofu init
tofu apply
```

**4. Wire up the pusher.** In the GitHub repo settings, add:

- Secret `SENATE_INGEST_TOKEN` = `tofu output -raw ingest_token`
- Variable `SENATE_WORKER_URL` = the worker's base URL

Then run the `Refresh Senate data` workflow manually once to seed KV, rather
than waiting for the first scheduled run.

## Verifying

```bash
export TOKEN=$(tofu output -raw ingest_token)
export BASE=https://<worker>.<your-subdomain>.workers.dev

# Push from your machine (also the fastest way to seed an empty store)
SENATE_INGEST_TOKEN=$TOKEN python3 script.py --push-to "$BASE"

curl -s "$BASE/api/live-data" | head -20
curl -s "$BASE/health"
```

A healthy `/health` shows `"state": "done"`, `"races": 35`, an empty
`failedStates`, and a small `dataAgeSeconds`. A **large `dataAgeSeconds` is the
signal that the pusher has silently stopped** — the worker itself will keep
happily serving stale data forever, since nothing on the Cloudflare side knows
the schedule exists.

For live logs use `npx wrangler tail senate-election-data`; the dashboard's
observability view withholds output until a request finishes.

## Why the pipeline isn't in Cloudflare

Diagnosed against the deployed worker: `AbortSignal.timeout` and `asyncio.sleep`
both work fine, and the Kalshi request returned `HTTP 429` while the same URL
returned `200` from a laptop seconds later. Kalshi is not behind Cloudflare, so
this is their own limiter keyed on the Worker's shared egress IP.

If you ever want to move the fetch back into Cloudflare, the blocker is that IP
— the fix would be Kalshi API credentials (authenticated requests get their own
limit budget instead of sharing an IP pool), which means adding their RSA
request-signing to the worker.

## Things to know

- **`disable_python_external_sdk` is load-bearing.** From workerd's flag table,
  `pythonExternalSDK` defaults on for any `compatibility_date` on or after
  **2026-04-21**, and means "don't include the Python sdk from the runtime, use
  a vendored copy". Vendoring is something `pywrangler` does while building a
  bundle; this resource uploads a single `.py` file and cannot add the package,
  so without the disable flag the deploy fails at
  `from workers import Response, WorkerEntrypoint` with `ModuleNotFoundError`.
- **`python_workers` is still a beta flag**, and Cloudflare may change what it
  requires as Python Workers move toward GA.
- **Removing the old cron trigger.** The provider can create
  `cloudflare_workers_cron_trigger` but cannot delete it — `tofu apply` drops it
  from state while leaving it live in the API. If you applied an earlier version
  of this plan, delete it by hand: Workers & Pages → the worker → Settings →
  Triggers → Cron Events. Left in place it fires every 12 hours against a worker
  with no `scheduled` handler and logs an error each time.
- **`tofu destroy` is the wrong way to redeploy.** Changing `worker/worker.py`
  changes `content_sha256`, which is an in-place update — just `tofu apply`.
  Destroying would delete the KV namespace (taking the live data with it) and
  regenerate the ingest token, breaking the GitHub secret.

## Rotating the ingest token

```bash
tofu taint random_password.ingest_token
tofu apply
```

Then update the `SENATE_INGEST_TOKEN` repository secret, or the next scheduled
refresh fails with a 401.
