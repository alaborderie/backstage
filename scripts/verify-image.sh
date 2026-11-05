#!/usr/bin/env bash
set -euo pipefail
image=${1:-ghcr.io/alaborderie/backstage:latest}
prefix="backstage-proof-$$"
evidence=$(mktemp -d /tmp/backstage-proof.XXXXXX)
cleanup() {
  docker logs "$prefix-app" > "$evidence/backend.log" 2>&1 || true
  docker rm -f "$prefix-app" "$prefix-db" >/dev/null 2>&1 || true
  docker network rm "$prefix" >/dev/null 2>&1 || true
  echo "Evidence: $evidence"
}
trap cleanup EXIT
docker network create "$prefix" >/dev/null
docker run -d --name "$prefix-db" --network "$prefix" -e POSTGRES_PASSWORD=proof postgres:17 >/dev/null
for i in $(seq 1 60); do
  if docker exec "$prefix-db" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker run -d --name "$prefix-app" --network "$prefix" -p 127.0.0.1::7007 \
  -e POSTGRES_HOST="$prefix-db" -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=proof -e AUTH_GITHUB_CLIENT_ID=dummy -e AUTH_GITHUB_CLIENT_SECRET=dummy \
  -e GITHUB_APP_ID=1 -e GITHUB_APP_PRIVATE_KEY=unused \
  -e CLOUD_AGENTS_NAMESPACE=cloud-agents -e CLOUD_AGENTS_RUNNER_IMAGE=proof-unused \
  -e CLOUD_AGENTS_RUNNER_BACKEND_URL \
  -e CLOUD_AGENTS_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  -e BACKEND_SECRET=proof-only-backend-secret-with-32-characters "$image" >/dev/null
port=$(docker port "$prefix-app" 7007/tcp | cut -d: -f2)
base="http://127.0.0.1:$port"
for i in $(seq 1 120); do
  if curl -fsS "$base/.backstage/health/v1/readiness" > "$evidence/readiness.json"; then break; fi
  sleep 2
done
curl -fsS "$base/.backstage/health/v1/readiness" | tee "$evidence/readiness.json"
curl -fsS "$base/" > "$evidence/index.html"
grep -qi '<!doctype html' "$evidence/index.html"
status=$(curl -sS -o "$evidence/guest.json" -w '%{http_code}' "$base/api/auth/guest/refresh")
test "$status" = 404
status=$(curl -sS -o "$evidence/runner.json" -w '%{http_code}' "$base/api/cloud-agents/runner/github-token")
test "$status" = 401
grep -Eq '"name": *"AuthenticationError"' "$evidence/runner.json"
grep -Eq '"message": *"Unknown or finished run"' "$evidence/runner.json"
status=$(curl -sS -D "$evidence/github.headers" -o /dev/null -w '%{http_code}' "$base/api/auth/github/start?env=production&origin=https%3A%2F%2Fbackstage.antoinelaborderie.com")
test "$status" = 302
grep -qi '^location: https://github.com/login/oauth/authorize' "$evidence/github.headers"
test "$(docker exec "$prefix-app" id -u)" != 0
echo 'PASS: ready, frontend served, guest absent, runner rejects missing run token, GitHub redirects, non-root'
