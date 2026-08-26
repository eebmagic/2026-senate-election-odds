locals {
  worker_base = (
    var.workers_dev_subdomain == null
    ? "(set var.workers_dev_subdomain to render this URL)"
    : "https://${var.worker_name}.${var.workers_dev_subdomain}.workers.dev"
  )
}

output "worker_url" {
  description = "Base URL of the deployed worker."
  value       = local.worker_base
}

output "data_url" {
  description = "Public read endpoint the UI fetches."
  value       = "${local.worker_base}/api/live-data"
}

output "health_url" {
  description = "Last cron run's outcome (promoted or not, per-ticker failures)."
  value       = "${local.worker_base}/health"
}

output "refresh_url" {
  description = "Authed POST endpoint that runs the pipeline on demand, instead of waiting for the next cron tick."
  value       = "${local.worker_base}/api/refresh"
}

output "kv_namespace_id" {
  description = "ID of the KV namespace holding the live blob."
  value       = cloudflare_workers_kv_namespace.senate_data.id
}

output "cron_schedule" {
  description = "Active refresh schedule (UTC)."
  value       = var.cron_schedule
}

output "ingest_token" {
  description = <<-EOT
    Bearer token for the authed endpoints. Read it with
    `tofu output -raw ingest_token` and pass it to
    `python3 script.py --push-to <worker_url>` via $SENATE_INGEST_TOKEN.
  EOT
  value       = local.ingest_token
  sensitive   = true
}
