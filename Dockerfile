# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3
WORKDIR /app
COPY .yarn .yarn
COPY .yarnrc.yml package.json yarn.lock backstage.json ./
COPY packages packages
COPY plugins plugins
COPY external/cloud-agents/plugins external/cloud-agents/plugins
RUN node .yarn/releases/yarn-4.13.0.cjs install --immutable
COPY tsconfig.json app-config*.yaml ./
RUN node .yarn/releases/yarn-4.13.0.cjs tsc && node .yarn/releases/yarn-4.13.0.cjs build:backend
RUN mkdir /bundle && tar xzf packages/backend/dist/skeleton.tar.gz -C /bundle && tar xzf packages/backend/dist/bundle.tar.gz -C /bundle
RUN node .yarn/releases/yarn-4.13.0.cjs workspaces focus --all --production

FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /bundle ./
COPY --chown=node:node app-config.yaml app-config.production.yaml ./
COPY --chown=node:node catalog ./catalog
USER node
EXPOSE 7007
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
