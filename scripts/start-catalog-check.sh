#!/usr/bin/env bash
# Starts the image against the live k3s cluster and the GitHub App, with guest
# sign-in enabled only through a runtime config. Credential values are read
# from the cluster into mode-600 files that stop.sh deletes; nothing is printed.
set -euo pipefail
set +x
image=${1:-ghcr.io/alaborderie/backstage:latest}
port=${PORT:-17010}
prefix="backstage-catalog-check-$$"
umask 077
evidence=$(mktemp -d /tmp/backstage-catalog-check.XXXXXX)
cat > "$evidence/stop.sh" <<SH
#!/usr/bin/env bash
docker logs $prefix-app > $evidence/backend.log 2>&1
docker rm -f $prefix-app $prefix-db >/dev/null
docker network rm $prefix >/dev/null
rm -f $evidence/kubeconfig $evidence/github-app.pem $evidence/app-config.local.yaml
echo "Stopped. Logs: $evidence/backend.log"
SH
chmod 700 "$evidence/stop.sh"
trap 'bash "$evidence/stop.sh" >/dev/null 2>&1' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

kubectl config view --minify --flatten --raw > "$evidence/kubeconfig"
secret() {
  kubectl get secret backstage-secrets -n default -o "jsonpath={.data.$1}" | base64 -d
}
app_id=$(secret github-app-id)
secret github-private-key > "$evidence/github-app.pem"
cat > "$evidence/app-config.local.yaml" <<YAML
app:
  baseUrl: http://localhost:$port
backend:
  baseUrl: http://localhost:$port
  cors:
    origin: http://localhost:$port
integrations:
  github:
    - host: github.com
      apps:
        - appId: $app_id
          privateKey:
            \$file: /app/github-app.pem
          clientId: local-check-unused
          clientSecret: local-check-unused
auth:
  providers:
    guest:
      dangerouslyAllowOutsideDevelopment: true
      userEntityRef: user:default/alaborderie
inventory:
  schedule:
    frequency: { minutes: 5 }
    timeout: { minutes: 3 }
    initialDelay: { seconds: 5 }
YAML
unset app_id


docker network create "$prefix" >/dev/null
docker run -d --name "$prefix-db" --network "$prefix" -e POSTGRES_PASSWORD=proof postgres:17 >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$prefix-db" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker run -d --name "$prefix-app" --network "$prefix" -p "127.0.0.1:$port:7007" \
  -v "$evidence/kubeconfig:/app/kubeconfig:ro" \
  -v "$evidence/github-app.pem:/app/github-app.pem:ro" \
  -v "$evidence/app-config.local.yaml:/app/app-config.local.yaml:ro" \
  -e KUBECONFIG=/app/kubeconfig \
  -e POSTGRES_HOST="$prefix-db" -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=proof \
  -e AUTH_GITHUB_CLIENT_ID=dummy -e AUTH_GITHUB_CLIENT_SECRET=dummy \
  -e GITHUB_APP_ID=1 -e GITHUB_APP_PRIVATE_KEY=unused \
  -e BACKEND_SECRET=proof-only-backend-secret-with-32-characters \
  -e CLOUD_AGENTS_NAMESPACE=cloud-agents -e CLOUD_AGENTS_RUNNER_IMAGE=proof-unused \
  -e CLOUD_AGENTS_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  "$image" node packages/backend --config app-config.yaml --config app-config.production.yaml \
  --config app-config.local.yaml >/dev/null
for _ in $(seq 1 120); do
  if curl -fsS "http://localhost:$port/.backstage/health/v1/readiness" > "$evidence/readiness.json" 2>/dev/null; then break; fi
  sleep 2
done
curl -fsS "http://localhost:$port/.backstage/health/v1/readiness"
trap - EXIT INT TERM
printf '\nURL: http://localhost:%s/catalog\nCheck: python3 scripts/check-catalog.py http://localhost:%s\nCleanup: bash %s/stop.sh\n' \
  "$port" "$port" "$evidence"
