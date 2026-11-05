# Catalog inventory

## Sub-features

Repository components from GitHub, cluster resources and components from k3s,
their relations, the duscraft Group membership.

## How to get to it (user POV)

Open `/catalog`, filter by kind and type, open a component, its repository
(Part of) and its ingress route or database (Depends on resources).

## Driving it with curl

Run `bash scripts/start-catalog-check.sh <image>`, then
`python3 scripts/check-catalog.py http://localhost:17010`. The checker queries
`/api/catalog/entities/by-query` as guest and asserts kinds, types and
relations. Run the printed `stop.sh` afterwards.

## Gotchas

The first refresh runs about 5 seconds after startup in the check config and
15 seconds in production. Private repositories need the GitHub App installed on
their owner; duscraft has none yet, so `pensee-*` stay unlinked. The cluster
has no standalone Job, so the `job` type is empty. Source:
`plugins/catalog-backend-module-inventory/src`.
