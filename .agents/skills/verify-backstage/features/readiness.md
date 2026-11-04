# Readiness and frontend

## Sub-features

Postgres migrations, readiness, bundled frontend, non-root runtime.

## How to get to it (user POV)

Visit the portal root; operators probe `/.backstage/health/v1/readiness`.

## Driving it with curl

Run `bash scripts/verify-image.sh backstage:proof`. Require readiness 200,
HTML at `/`, and a nonzero runtime UID. Inspect the saved HTML and backend logs.

## Gotchas

Postgres credentials must allow database creation. Dummy GitHub credentials are
sufficient for startup. The script uses a throwaway Postgres with that permission.
