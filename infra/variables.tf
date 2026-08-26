variable "account_id" {
  description = "Cloudflare account ID (dashboard -> Workers & Pages -> Account details)."
  type        = string
}

variable "api_token" {
  description = <<-EOT
    Cloudflare API token. Leave unset to use $CLOUDFLARE_API_TOKEN instead
    (preferred -- keeps it out of tfvars and state).

    The token needs these account-scoped permissions:
      Workers Scripts      Edit
      Workers KV Storage   Edit
      Workers Tail         Read
  EOT
  type        = string
  default     = null
  sensitive   = true
}

variable "worker_name" {
  description = "Name of the Worker script. Also the workers.dev hostname prefix."
  type        = string
  default     = "senate-election-data"
}

variable "kv_namespace_title" {
  description = "Human-readable title for the KV namespace holding the live blob."
  type        = string
  default     = "senate-election-data"
}

variable "cron_schedule" {
  description = <<-EOT
    Cron expression for the refresh job, in UTC. Default is every 12 hours at
    00:00 and 12:00 UTC.
  EOT
  type        = string
  default     = "0 */12 * * *"
}

variable "ingest_token" {
  description = <<-EOT
    Bearer token guarding the worker's authed endpoints (PUT /api/live-data and
    POST /api/refresh). Leave unset and one is generated for you -- read it back
    with `tofu output -raw ingest_token`.
  EOT
  type        = string
  default     = null
  sensitive   = true
}

variable "allowed_origin" {
  description = <<-EOT
    Value for the Access-Control-Allow-Origin header on the data endpoints.
    Defaults to "*" because the payload is public prediction-market data; once
    the UI has its own domain you can narrow it to that origin.
  EOT
  type        = string
  default     = "*"
}

variable "fetch_delay_ms" {
  description = <<-EOT
    Politeness delay between Kalshi event-ticker requests, in milliseconds.
    Tunable without a redeploy (it's a plain_text binding, not baked into the
    script). Lower values shorten the cron run; too low risks 429s.
  EOT
  type        = number
  default     = 1000
}

variable "compatibility_date" {
  description = "Workers runtime compatibility date."
  type        = string
  default     = "2026-08-01"
}

variable "workers_dev_subdomain" {
  description = <<-EOT
    Your account's workers.dev subdomain (the "<this>" in
    <worker>.<this>.workers.dev). Find it under Workers & Pages -> Subdomain in
    the dashboard.

    Only used to render the URL outputs -- the provider exposes no data source
    for it, so it can't be looked up automatically. Leave unset and the outputs
    just tell you to set it.
  EOT
  type        = string
  default     = null
}
