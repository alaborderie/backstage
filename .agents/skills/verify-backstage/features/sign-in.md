# GitHub sign-in

## Sub-features

GitHub-only sign-in, owner allowlist, catalog identity resolution.

## How to get to it (user POV)

Open the portal. GitHub is the only sign-in choice.

## Driving it with curl

Run `bash scripts/verify-image.sh backstage:proof`. GitHub start must return 302
to `https://github.com/login/oauth/authorize`; guest refresh must return 404.
Run `yarn test --watch=false --runInBand` to prove the resolver rejects other
logins and resolves the owner through the catalog.

## Gotchas

Dummy credentials cannot complete login. Full OAuth login requires real credentials
and the owner's session. Display name and email do not grant access.
