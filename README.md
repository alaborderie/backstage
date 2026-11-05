# Backstage

Antoine's developer portal, scaffolded with Backstage 1.56.0 and the new backend
and frontend systems. The backend serves the bundled frontend in production.
Only the authenticated GitHub login `alaborderie` can sign in. Guest auth is absent from production. A runtime-only local check config can
enable it. Deployment to Kubernetes is managed separately.

## Local development

Use Node.js 24 LTS, Corepack, and a native build toolchain (Python 3, make, g++).

```sh
corepack enable
git submodule update --init --recursive
yarn install --immutable
export AUTH_GITHUB_CLIENT_ID=your-oauth-client-id
export AUTH_GITHUB_CLIENT_SECRET=your-oauth-client-secret
export CLOUD_AGENTS_RUNNER_IMAGE=ghcr.io/alaborderie/cloud-agent-runner:sha-de01b1b
export CLOUD_AGENTS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
yarn start
```

Open http://localhost:3000. Local development uses in-memory SQLite and the
catalog user in `catalog/org.yaml`. Create a GitHub OAuth app with callback URL
`http://localhost:7007/api/auth/github/handler/frame`. Dummy credentials allow
startup but cannot complete GitHub login. Real login requires the OAuth app.

```sh
yarn tsc
yarn lint:all
yarn test --watch=false --runInBand
docker build -t backstage:local .
bash scripts/verify-image.sh backstage:local
```

The smoke test creates isolated throwaway containers and removes them afterward.
It saves readiness, auth responses, frontend HTML, and logs in a printed
`/tmp/backstage-proof.*` directory.

## Production

Pushes to `main` build and smoke-test the container in GitHub Actions, then publish
`ghcr.io/alaborderie/backstage:<full-commit-sha>` and `:latest`. PRs run TypeScript,
lint, and tests. The image runs as the non-root `node` user on port 7007. Route
HTTPS to this port through Traefik. Probe `/.backstage/health/v1/readiness`.

The production public URL is https://backstage.antoinelaborderie.com. Configure
the production GitHub OAuth app callback as
`https://backstage.antoinelaborderie.com/api/auth/github/handler/frame`.

| Environment variable        | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `AUTH_GITHUB_CLIENT_ID`     | GitHub OAuth client ID, required locally and in production |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth secret, required locally and in production    |
| `BACKEND_SECRET`            | Stable random backend shared secret, production only       |
| `POSTGRES_HOST`             | PostgreSQL host, production only                           |
| `POSTGRES_PORT`             | PostgreSQL port, usually `5432`, production only           |
| `POSTGRES_USER`             | PostgreSQL role, production only                           |
| `POSTGRES_PASSWORD`         | PostgreSQL password, production only                       |

The Postgres role must be able to create Backstage plugin databases. Persist the
Postgres data and provide TLS options through an additional config file if the
Postgres connection requires them. Keep credentials outside git. The allowlist
checks the GitHub-authenticated username, case-insensitively, then resolves
`user:default/alaborderie` through the catalog. Missing catalog users fail closed.
GitHub usernames can be renamed; review this allowlist if ownership changes.

## External plugins

Plugins are installed at build time through Yarn workspaces, then registered with
the new systems. Rebuild and publish the image after changing plugins. No runtime
package download or Kubernetes access is needed to install one.

For an npm backend plugin:

```sh
yarn workspace backend add @your-org/plugin-example-backend
```

Register its exported backend feature in `packages/backend/src/index.ts`:

```ts
backend.add(import('@your-org/plugin-example-backend'));
```

For an npm frontend plugin:

```sh
yarn workspace app add @your-org/plugin-example
```

`app.packages: all` discovers new-frontend-system plugins from app dependencies.
If its docs require explicit registration, import its default feature into
`packages/app/src/App.tsx` and add it to `createApp({ features: [...] })`. Legacy
frontend plugins require the Backstage compatibility adapter or a new-system
entry point, commonly `/alpha`.

For a git dependency, use a Yarn git URL pinned to a commit, for example
`yarn workspace backend add '@your-org/plugin-example-backend@git+https://github.com/your-org/plugin-example.git#commit=<full-sha>'`.
For a plugin inside a git monorepo, use Yarn's `#workspace=<package>&commit=<sha>`
selector. The source repository must support Yarn git packaging and build its
published entry points. Prefer published npm packages for reproducible builds.
Commit `yarn.lock`; keep Backstage package versions compatible with this app.

Verification instructions live in `.agents/skills/verify-backstage/SKILL.md`.
Use `/maintain-verification-skill` when routes, auth, or startup change.

## Ember home and navigation

`external/ember` pins `alaborderie/backstage-ember` at
`369a2aaa4569807e8cc470bada440424cccf752e`. Its `plugins/*` directories are
Yarn workspaces and are copied into the Docker build. The app discovers both
`@alaborderie/backstage-plugin-app-module-ember` and
`@alaborderie/backstage-plugin-home-module-github` through `app.packages: all`.
Ember supplies the only theme, responsive navigation, greeting and home tiles.

The home page is `/`; the catalog is `/catalog`. `app-config.yaml` sets a
7-column issues panel beside 5-column pull requests and cloud agents panels.
The compact 12/6/6-row heights keep empty guest widgets usable; loaded lists
scroll within their panels. Users can resize the grid. Issues use owner
`alaborderie` and hide the `on-hold` label by default. GitHub widgets require a
GitHub session to load data; guest auth is only for local verification.

To update Ember, fetch and check out a reviewed full SHA in `external/ember`,
run the checks above, and commit the submodule pin with `yarn.lock`.
Production image tags are pinned separately in `k3s-ovh-config/backstage.yaml`;
open a tag bump PR after the main image publishes. Merging that PR deploys it.

## Cloud agents

The frontend registers the plugin's `/cloud-agents` page, including the list,
`/cloud-agents/new`, `/cloud-agents/agents/:id`, and `/cloud-agents/settings`.
The sidebar discovers its Cloud agents item. The backend serves `/api/cloud-agents`.

The source is the Git submodule `external/cloud-agents`, pinned to
`b2aa949beb3232b9173abac4c65b844f3a6abdd8`; its three plugin directories are Yarn
workspaces. No npm publication or vendored source copy is needed. Yarn 4 Git
workspace packing was tested: upstream's prepack rewrites entry points to `dist`
but does not build it, leaving archives without executable entry points. Building
the source workspaces with Backstage avoids that failure. Docker copies only the
plugin workspaces; CI checks out the submodule recursively.

To bump the pin, select a reviewed upstream commit and rebuild:

```sh
git -C external/cloud-agents fetch origin
git -C external/cloud-agents checkout <full-commit-sha>
yarn install
yarn tsc && yarn lint:all && yarn test --watch=false --runInBand
docker build -t backstage:cloud-agents .
git add external/cloud-agents yarn.lock
```

Production uses these additional environment variables. The runner backend URL is
optional; the other variables are required:

| Variable                      | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `CLOUD_AGENTS_NAMESPACE`      | Namespace for Jobs, Pods, and Secrets (`cloud-agents`)  |
| `CLOUD_AGENTS_RUNNER_IMAGE`   | Runner image tag or digest                              |
| `CLOUD_AGENTS_ENCRYPTION_KEY` | Stable base64-encoded 32-byte credential encryption key |
| `CLOUD_AGENTS_RUNNER_BACKEND_URL` | Optional Backstage base URL reachable by runner pods, such as `http://backstage.default.svc.cluster.local` |

With the runner backend URL set, pods fetch the current GitHub token through
`/api/cloud-agents/runner/github-token` using a per-run token. The plugin handles
this route's authentication; a missing or invalid run token returns HTTP 401.
Without the URL, the app still starts and pods use their initial `GH_TOKEN`.

The plugin reuses `AUTH_GITHUB_CLIENT_ID` and `AUTH_GITHUB_CLIENT_SECRET`. Add
`https://backstage.antoinelaborderie.com/api/cloud-agents/me/github/callback`
to the GitHub App's callbacks alongside the sign-in callback. `GITHUB_APP_ID` and
`GITHUB_APP_PRIVATE_KEY` are deployment inputs; this plugin uses user OAuth or
per-user tokens and does not read the App installation key.

Kubernetes client configuration follows `KUBECONFIG`, then `~/.kube/config`, then
in-cluster credentials. Production mounts no kubeconfig and uses ServiceAccount
`default/backstage`; its namespace-scoped RoleBinding in `cloud-agents` is managed
by the deployment repository. It needs Jobs create/get/list/watch/patch/delete,
Pods and Pods/log get/list/watch, and Secrets create/get/delete.

### Local image check against kind

Requires Docker, kind cluster `cloud-agents` (namespace `cloud-agents` and runner
image already loaded), Python 3, OpenSSL, authenticated `gh`, and an active
`opencode-go` credential available through `opencode auth export`. The recipe
keeps credential values in memory, stores them through the plugin API, and never
prints them. Do not enable shell tracing. It uses the real image and throwaway
Postgres 17. It does not change your current Kubernetes context or production.

```sh
docker pull ghcr.io/alaborderie/backstage:latest
bash scripts/verify-image.sh ghcr.io/alaborderie/backstage:latest
bash scripts/start-cloud-agents-check.sh ghcr.io/alaborderie/backstage:latest
python3 scripts/run-cloud-agent-check.py http://localhost:17007
```

The first check uses only the image's production config: readiness, frontend,
guest refresh HTTP 404, runner credential HTTP 401, GitHub redirect, and non-root
UID. The launcher then writes an additional local config under its printed `/tmp/backstage-cloud-check.*`
directory, mounts it at runtime, and explicitly enables guest only for that run.
Use `PORT=17008` to choose another loopback port, or set
`CLOUD_AGENTS_RUNNER_IMAGE` to another image already loaded into kind.

The Python check obtains a Backstage guest identity, creates a `cat_` token, sets
OpenCode and GitHub credentials through `/api/cloud-agents`, starts an OpenCode
agent on `alaborderie/cloud-agent-runner-sandbox`, and requires `succeeded`.
Its read-only prompt does not create a PR. To create a token for another local
client, call `GET /api/auth/guest/refresh` with
`X-Requested-With: XMLHttpRequest`, then use `backstageIdentity.token` as Bearer
credentials for `POST /api/cloud-agents/me/tokens {"name":"local-client"}`.
Only that response returns the `cat_` token; keep it private.

Open http://localhost:17007/cloud-agents and
http://localhost:17007/cloud-agents/settings; choose Guest on the local sign-in
page. The API check and browser share `user:default/local-check`.
After inspection, run the printed `bash /tmp/backstage-cloud-check.*/stop.sh`
command for that instance. It removes only its app, Postgres, and Docker network.
The evidence directory remains and includes an admin kind kubeconfig; remove
that directory after inspection. Never mount this local config into production.
