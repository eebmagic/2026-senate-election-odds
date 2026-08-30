terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "cloudflare" {
  # Left null so the provider falls back to $CLOUDFLARE_API_TOKEN, which keeps
  # the token out of tfvars and state. Set var.api_token only if you'd rather
  # pass it explicitly.
  api_token = var.api_token
}
