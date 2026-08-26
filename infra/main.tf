# Cloudflare side of the Senate tracker: a Workers KV namespace holding the
# live data, and a small Python Worker that stores and serves it.
#
# The worker does NOT fetch Kalshi. It did, on a cron trigger, but Kalshi
# rate-limits by IP and Workers egress from addresses shared across many
# Cloudflare customers, so nearly every request came back 429. The pipeline now
# runs where it has a usable IP (script.py, from CI or a laptop) and pushes the
# result here -- so there is no cron trigger in this plan, and the schedule
# lives in .github/workflows/refresh-data.yml instead.
#
# Scope is deliberately just the worker + its storage. The static UI is a
# separate (later) addition to this plan -- see the task item.

locals {
  # Uploaded as-is: with the transform gone, the worker is self-contained and
  # needs no build step or generated bundle.
  worker_file = "${path.module}/../worker/worker.py"

  ingest_token = coalesce(var.ingest_token, random_password.ingest_token.result)
}

# Generated only when var.ingest_token is unset. `keepers` is empty so it stays
# stable across applies -- rotating it means tainting this resource explicitly.
resource "random_password" "ingest_token" {
  length  = 48
  special = false
}

# The live blob's home. One key ("live-senate-data") is what the UI reads; a
# second ("last-run") records what the last push contained, for /health.
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

  compatibility_flags = [
    # Python Workers are still in open beta and require this flag.
    "python_workers",

    # Required because compatibility_date is on/after 2026-04-21, when
    # workerd's pythonExternalSDK flag begins defaulting on ("Don't include
    # the Python sdk from the runtime, use a vendored copy"). Vendoring is
    # something pywrangler does when it builds a bundle; this resource uploads
    # a single .py file and has no way to add the package, so without this the
    # deploy dies at `from workers import ...` with ModuleNotFoundError.
    # Disabling it puts the runtime-provided SDK back.
    "disable_python_external_sdk",
  ]

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
  ]

  observability = {
    enabled = true
  }
}

# Serves the worker at <worker_name>.<your-subdomain>.workers.dev. Fine as the
# permanent home for a JSON endpoint; swap for a custom domain later if the UI
# ends up on one.
resource "cloudflare_workers_script_subdomain" "senate_data" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.senate_data.script_name
  enabled     = true
}


