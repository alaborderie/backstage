# Backstage

Antoine's developer portal, scaffolded with Backstage 1.56.0 and the new backend
and frontend systems. The backend serves the bundled frontend in production.
Only the authenticated GitHub login `alaborderie` can sign in. Guest auth is not
registered in any environment. Deployment to Kubernetes is managed separately.

## Local development

Use Node.js 24 LTS, Corepack, and a native build toolchain (Python 3, make, g++).

```sh
corepack enable
yarn install --immutable
export AUTH_GITHUB_CLIENT_ID=your-oauth-client-id
export AUTH_GITHUB_CLIENT_SECRET=your-oauth-client-secret
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
