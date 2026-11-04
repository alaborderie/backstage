#!/usr/bin/env bash
set -euo pipefail
image=${1:-ghcr.io/alaborderie/backstage:latest}
port=${PORT:-17007}
prefix="backstage-cloud-check-$$"
evidence=$(mktemp -d /tmp/backstage-cloud-check.XXXXXX)
chmod 700 "$evidence"
kind get kubeconfig --name cloud-agents --internal > "$evidence/kubeconfig"
chmod 644 "$evidence/kubeconfig"
cat > "$evidence/app-config.local.yaml" <<YAML
app:
  baseUrl: http://localhost:$port
backend:
  baseUrl: http://localhost:$port
  cors:
    origin: http://localhost:$port
auth:
  providers:
    guest:
      dangerouslyAllowOutsideDevelopment: true
      userEntityRef: user:default/local-check
YAML
cat > "$evidence/stop.sh" <<SH
#!/usr/bin/env bash
docker rm -f $prefix-app $prefix-db
docker network rm $prefix
SH
chmod 700 "$evidence/stop.sh"
trap 'bash "$evidence/stop.sh" >/dev/null 2>&1' ERR
docker network create "$prefix" >/dev/null
docker run -d --name "$prefix-db" --network "$prefix" -e POSTGRES_PASSWORD=proof postgres:17 >/dev/null
for i in $(seq 1 60); do
  if docker exec "$prefix-db" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker create --name "$prefix-app" --network "$prefix" -p "127.0.0.1:$port:7007" \
  -v "$evidence/kubeconfig:/app/kubeconfig:ro" \
  -v "$evidence/app-config.local.yaml:/app/app-config.local.yaml:ro" \
  -e KUBECONFIG=/app/kubeconfig \
  -e POSTGRES_HOST="$prefix-db" -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=proof \
  -e AUTH_GITHUB_CLIENT_ID=dummy -e AUTH_GITHUB_CLIENT_SECRET=dummy \
  -e BACKEND_SECRET=proof-only-backend-secret-with-32-characters \
  -e CLOUD_AGENTS_NAMESPACE=cloud-agents \
  -e CLOUD_AGENTS_RUNNER_IMAGE="${CLOUD_AGENTS_RUNNER_IMAGE:-ghcr.io/alaborderie/cloud-agent-runner:sha-de01b1b}" \
  -e CLOUD_AGENTS_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  "$image" node packages/backend --config app-config.yaml --config app-config.production.yaml --config app-config.local.yaml >/dev/null
docker network connect kind "$prefix-app"
docker start "$prefix-app" >/dev/null
for i in $(seq 1 120); do
  if curl -fsS "http://localhost:$port/.backstage/health/v1/readiness" > "$evidence/readiness.json" 2>/dev/null; then break; fi
  sleep 2
done
curl -fsS "http://localhost:$port/.backstage/health/v1/readiness"
printf '\nURL: http://localhost:%s/cloud-agents\nContainer: %s-app\nEvidence: %s\nCleanup: bash %s/stop.sh\n' "$port" "$prefix" "$evidence" "$evidence"
