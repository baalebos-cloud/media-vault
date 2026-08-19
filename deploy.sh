#!/usr/bin/env bash
set -euo pipefail

echo "==> Rebuilding and recreating api + worker"
docker compose up -d --build api worker

echo "==> Waiting for api to report healthy"
until [ "$(docker inspect -f '{{.State.Health.Status}}' media-vault-api-1 2>/dev/null)" = "healthy" ]; do
  sleep 2
  echo "    still waiting..."
done

echo "==> Bouncing cloudflared to re-resolve api's new IP"
docker restart media-vault-cloudflared-1

echo "==> Deploy complete"
