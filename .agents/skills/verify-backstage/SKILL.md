---
name: verify-backstage
description: Verify Backstage container startup, frontend serving, and GitHub-only authentication against a throwaway Postgres.
---

# Verify Backstage

## Launch

Use Docker on the current machine, Node 24 and Corepack for source checks.
Run `yarn install --immutable`, `yarn tsc`, `yarn lint:all`, and
`yarn test --watch=false --runInBand`. Build with
`docker build -t backstage:proof .`, or pull the shipped artifact with
`docker pull ghcr.io/alaborderie/backstage:latest`.
Run `bash scripts/verify-image.sh backstage:proof` (or the GHCR image).
This launches a uniquely named network, Postgres 17, and app with dummy OAuth
credentials. It waits for the real readiness route and removes containers on exit.

## Doctor

Run `docker info` before launch. During a failed run read `backend.log` from the
printed evidence directory. A readiness HTTP 200 is required before driving auth.
Ports are allocated dynamically on loopback; never reuse another instance.

## Drive

The executable helper `scripts/verify-image.sh` requests readiness and `/`, then
checks guest refresh returns 404 and GitHub start redirects to GitHub. It also
checks the runtime UID. Read `features/README.md` for mapped journeys.

## Evidence

The helper prints `/tmp/backstage-proof.*`, containing `backend.log`,
`readiness.json`, `index.html`, `guest.json`, and `github.headers`. Preserve it.
These exercise the production HTTP routes on the real image and real Postgres.
Dummy OAuth credentials prove configuration and redirect only; a completed login
requires the owner's GitHub session and real credentials. The resolver's source
unit test independently proves owner acceptance and other-user rejection.

## Cleanup

The helper trap removes only the containers and network it created, even on
failure. It preserves the evidence directory. Never kill shared services.

## Helpers

`bash scripts/verify-image.sh <image>` runs launch, doctor through readiness,
drive, evidence capture, and cleanup. A nonzero exit means failure.

## Cloud agents

Initialize the pinned source with `git submodule update --init --recursive`
before installing. The production smoke helper supplies dummy cloud-agents
settings and still requires guest refresh HTTP 404. For a real agent check,
follow README's "Local image check against kind": start the runtime-only guest
config with `scripts/start-cloud-agents-check.sh <image>`, then run
`python3 scripts/run-cloud-agent-check.py http://localhost:17007`. This stores
local credentials through the API without printing them and requires a real
OpenCode sandbox agent to succeed. Inspect `/cloud-agents` and
`/cloud-agents/settings` in the browser, choosing Guest. Use the launcher's
printed cleanup command and remove its evidence directory after inspection
(the directory contains a kind admin kubeconfig). No production deployment or
secret changes are part of verification.
