#!/usr/bin/env python3
"""
Cloudflare R2 storage for the Senate live-data pipeline.

script.py used to write web/live-senate-data.json plus a local
live_data_snapshots/ audit trail. The store is now an R2 bucket instead:

  latest.json                  the current payload; the UI fetches this
  snapshots/<fetchedAt>.json   immutable per-run history, keyed by the run's
                               own fetchedAt (ISO-8601 UTC), e.g.
                               snapshots/2026-09-07T18:30:00Z.json

Each run uploads its snapshots/<ts>.json first; only if that succeeds is
latest.json replaced. So a failed history write can never leave latest.json
pointing at a payload that isn't also in the history.

Config is read from a .env file at the repo root (see .env.example); real
environment variables win over the file, so CI can inject secrets directly.

  R2_ACCOUNT_ID          Cloudflare account id (the R2 S3 endpoint host)
  R2_ACCESS_KEY_ID       R2 API token access key id
  R2_SECRET_ACCESS_KEY   R2 API token secret
  R2_BUCKET              bucket name (default: election-map)
  R2_PUBLIC_BASE_URL     optional; only used to print latest.json's public URL

boto3 is imported lazily, so build_live_data.py and `script.py --write-local`
keep working with nothing installed beyond the stdlib.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_PATH = ROOT / ".env"

DEFAULT_BUCKET = "election-map"
LATEST_KEY = "latest.json"
SNAPSHOT_PREFIX = "snapshots/"

# R2 ignores the region, but botocore's SigV4 signer still requires one set.
_R2_REGION = "auto"


class R2ConfigError(RuntimeError):
    """R2 credentials/config are missing, or boto3/python-dotenv isn't installed."""


def snapshot_key(fetched_at: str) -> str:
    """Bucket key for the history entry of a run with this fetchedAt."""
    return f"{SNAPSHOT_PREFIX}{fetched_at}.json"


def load_env(path: Path = DEFAULT_ENV_PATH) -> None:
    """Populate os.environ from `path` without overriding already-set vars.
    A missing file is fine (python-dotenv no-ops) -- CI passes real env vars."""
    try:
        from dotenv import load_dotenv
    except ModuleNotFoundError as e:
        raise R2ConfigError(
            "python-dotenv not installed -- run `pip install -r scripts/requirements.txt`"
        ) from e
    load_dotenv(path, override=False)


class R2Store:
    """Thin wrapper over an S3 client pointed at R2: get/put JSON objects."""

    def __init__(self, client, bucket: str, public_base_url: str | None = None):
        self._client = client
        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/") if public_base_url else None

    @classmethod
    def from_env(cls, env_path: Path = DEFAULT_ENV_PATH,
                 bucket: str | None = None) -> "R2Store":
        load_env(env_path)

        account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
        access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
        secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
        bucket = bucket or os.environ.get("R2_BUCKET", "").strip() or DEFAULT_BUCKET
        public_base = os.environ.get("R2_PUBLIC_BASE_URL", "").strip() or None

        missing = [name for name, val in (
            ("R2_ACCOUNT_ID", account_id),
            ("R2_ACCESS_KEY_ID", access_key),
            ("R2_SECRET_ACCESS_KEY", secret_key),
        ) if not val]
        if missing:
            raise R2ConfigError(
                f"missing R2 config: {', '.join(missing)} "
                f"(set in {env_path} -- copy .env.example to .env)"
            )

        try:
            import boto3
            from botocore.config import Config
        except ModuleNotFoundError as e:
            raise R2ConfigError(
                "boto3 not installed -- run `pip install -r scripts/requirements.txt`"
            ) from e

        client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=_R2_REGION,
            config=Config(signature_version="s3v4",
                          retries={"max_attempts": 3, "mode": "standard"}),
        )
        return cls(client, bucket, public_base)

    def get_json(self, key: str):
        """Parsed JSON at `key`, or None if the object doesn't exist."""
        from botocore.exceptions import ClientError
        try:
            resp = self._client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            code = str(e.response.get("Error", {}).get("Code", ""))
            if code in ("NoSuchKey", "NoSuchBucket", "404", "NotFound"):
                return None
            raise
        return json.loads(resp["Body"].read())

    def put_json(self, key: str, payload) -> None:
        body = (json.dumps(payload, indent=2) + "\n").encode("utf-8")
        self._client.put_object(Bucket=self.bucket, Key=key, Body=body,
                                ContentType="application/json")

    def public_url(self, key: str) -> str | None:
        if not self.public_base_url:
            return None
        from urllib.parse import quote
        return f"{self.public_base_url}/{quote(key)}"
