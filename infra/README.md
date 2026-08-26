# Cloudflare infrastructure (OpenTofu)

Provisions the cloud half of the pipeline: a **Python Worker** on a 12-hourly
cron trigger that fetches Kalshi and writes the live blob into **Workers KV**,
plus the endpoint the UI reads.

Scope is deliberately the worker + storage only. The static UI is a later
addition to this plan.

## What gets created

| Resource | Purpose |
|---|---|
| `cloudflare_workers_kv_namespace.senate_data` | Holds `live-senate-data` (what the UI reads) and `last-run` (each run's outcome) |
| `cloudflare_workers_script.senate_data` | The Python worker, from the generated `worker/dist/worker.py` |
| `cloudflare_workers_script_subdomain.senate_data` | Serves it at `<worker>.<subdomain>.workers.dev` |
| `cloudflare_workers_cron_trigger.refresh` | The 12-hourly schedule (`0 */12 * * *`, UTC) |
| `random_password.ingest_token` | Bearer token for the authed endpoints, unless you supply your own |

## Why KV and not Durable Objects

Short version: the data is one ~14 KB document, written twice a day by a single
writer and read on every page load. KV is globally replicated and edge-cached;
a Durable Object lives in one colo, so every read would be a round trip there,
and it bills compute on each. Full reasoning is in the task item,
`senate-election-map-kanban/task-items/Dump results to cloudflare.md`.

## First-time setup

**1. Create an API token** at
<https://dash.cloudflare.com/profile/api-tokens> → Create Custom Token. Add
three permission rows, all under the **Account** group:

| Group | Permission | Level | Needed by |
|---|---|---|---|
| Account | `Workers Scripts` | **Edit** | the worker script, the cron trigger, the workers.dev subdomain |
| Account | `Workers KV Storage` | **Edit** | the KV namespace |
| Account | `Workers Tail` | **Read** | `workers_script` and `workers_script_subdomain` both declare it |

Then under **Account Resources**, set Include → your account. No Zone
permissions are needed — nothing here touches DNS or a zone, since the worker
is served from workers.dev rather than a custom domain. (Adding a custom
domain later would add a Zone → `Workers Routes` → Edit row.)

`Edit` covers both Read and Write for that group.

Export it rather than putting it in tfvars, so it stays out of both the file
and the state:

```bash
export CLOUDFLARE_API_TOKEN=...
```

**2. Fill in your account ID:**

```bash
cp terraform.tfvars.example terraform.tfvars
# set account_id (Workers & Pages -> Account details in the dashboard)
```

**3. Make sure the worker bundle is current** — `tofu plan` fails if it isn't:

```bash
python3 worker/build.py
```

**4. Apply:**

```bash
cd infra
tofu init
tofu plan
tofu apply
```

## Verifying a deploy

The cron only fires every 12 hours, so don't wait for it — trigger a run
directly:

```bash
export TOKEN=$(tofu output -raw ingest_token)
export BASE=https://<worker>.<your-subdomain>.workers.dev

# Run the full pipeline now (takes ~40s: 36 tickers at the configured delay)
curl -X POST -H "authorization: Bearer $TOKEN" "$BASE/api/refresh"

# What the UI will fetch
curl -s "$BASE/api/live-data" | head -30

# Last run's outcome, promoted or not
curl -s "$BASE/health"
```

A healthy `/health` looks like `"promoted": true`, `"races": 35`,
`"tickersFailed": 0`.

You can also seed KV from your machine instead of letting the worker fetch:

```bash
export SENATE_INGEST_TOKEN=$(tofu output -raw ingest_token)
python3 script.py --push-to "$BASE"
```

## Things most likely to need adjusting

- **`main_module`.** Cloudflare's own Terraform example for Python workers
  omits it; the schema documents it as how a module-syntax worker is declared.
  It's set to `"worker.py"` here. If the upload is rejected with a
  main-module/body-part complaint, try removing that line.
- **Free-plan subrequest limit.** Workers allow **50 subrequests per
  invocation** on the free plan. A run makes 36 (one per event ticker), so a
  run needing more than ~14 retries would trip it. The paid plan raises this to
  1,000. If `/health` shows widespread failures that don't reproduce locally,
  suspect this first.
- **`python_workers` is a beta flag.** It's set in `compatibility_flags`.
  Cloudflare may change what it requires as Python Workers move toward GA.
- **The cron trigger can't be destroyed by tofu.** The provider warns about
  this on every plan: `cloudflare_workers_cron_trigger` has no delete API, so
  `tofu destroy` leaves it behind and it must be removed by hand in the
  dashboard (Workers & Pages → the worker → Settings → Triggers). Changing
  `cron_schedule` and re-applying works fine; only removal is manual.
- **`fetch_delay_ms`** is a plain-text binding, not baked into the script, so
  you can tune the politeness delay with an `apply` and no rebuild.

## Rotating the ingest token

```bash
tofu taint random_password.ingest_token
tofu apply
```

Anything using the old token (a saved `SENATE_INGEST_TOKEN`) needs updating.
