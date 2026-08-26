# Cloudflare side of the Kalshi -> live-senate-data pipeline: a Python Worker
# on a 12-hourly cron trigger writing a single JSON blob into Workers KV, plus
# a read endpoint the UI fetches.
#
# Scope is deliberately just the worker + its storage. The static UI is a
# separate (later) addition to this plan -- see the task item.

locals {
  # The deployed script is generated: `python3 worker/build.py` inlines
  # scripts/build_live_data.py and the event map into one file, because
  # cloudflare_workers_script takes a single content_file for Python workers.
  # It's committed, so plan/apply never depends on running a build first --
  # but it does need to be current. See the freshness check below.
  worker_file = "${path.module}/../worker/dist/worker.py"

  ingest_token = coalesce(var.ingest_token, random_password.ingest_token.result)
}

# Generated only when var.ingest_token is unset. `keepers` is empty so it stays
# stable across applies -- rotating it means tainting this resource explicitly.
resource "random_password" "ingest_token" {
  length  = 48
  special = false
}

# The live blob's home. One key ("live-senate-data") is what the UI reads; a
# second ("last-run") records each cron run's outcome for /health.
resource "cloudflare_workers_kv_namespace" "senate_data" {
  account_id = var.account_id
  title      = var.kv_namespace_title
}

resource "cloudflare_workers_script" "senate_data" {
  account_id  = var.account_id
  script_name = var.worker_name

  content_file   = local.worker_file
  content_sha256 = filesha256(local.worker_file)
  content_type   = "text/x-python"
  main_module    = "worker.py"

  compatibility_date = var.compatibility_date
  # Python Workers are still in open beta and require this flag.
  compatibility_flags = ["python_workers"]

  bindings = [
    {
      name         = "SENATE_DATA"
      type         = "kv_namespace"
      namespace_id = cloudflare_workers_kv_namespace.senate_data.id
    },
    {
      name = "INGEST_TOKEN"
      type = "secret_text"
      text = local.ingest_token
    },
    {
      name = "ALLOWED_ORIGIN"
      type = "plain_text"
      text = var.allowed_origin
    },
    {
      name = "FETCH_DELAY_MS"
      type = "plain_text"
      text = tostring(var.fetch_delay_ms)
    },
  ]

  # Cron failures are invisible without this -- there's no user watching a
  # response when the scheduled handler throws at 00:00 UTC.
  observability = {
    enabled = true
  }

  # Guarantees the staleness check runs before any upload.
  depends_on = [data.external.worker_bundle_is_current]
}

# Serves the worker at <worker_name>.<your-subdomain>.workers.dev. Fine as the
# permanent home for a JSON endpoint; swap for a custom domain later if the UI
# ends up on one.
resource "cloudflare_workers_script_subdomain" "senate_data" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.senate_data.script_name
  enabled     = true
}

resource "cloudflare_workers_cron_trigger" "refresh" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.senate_data.script_name

  schedules = [
    {
      cron = var.cron_schedule
    }
  ]
}

# Fails the plan if worker/dist/worker.py is stale relative to its sources,
# rather than silently deploying a bundle that predates your last edit to
# entry.py or build_live_data.py. build.py --check exits non-zero when stale,
# which aborts the plan with its stderr attached.
#
# Requires python3 on the machine running tofu. If that's ever inconvenient,
# deleting this block only costs you the guardrail.
data "external" "worker_bundle_is_current" {
  program = ["python3", "${path.module}/../worker/build.py", "--check", "--json"]
}
