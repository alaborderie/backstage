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
COPY external/ember/plugins external/ember/plugins
RUN node .yarn/releases/yarn-4.13.0.cjs install --immutable
COPY tsconfig.json app-config*.yaml ./
RUN node .yarn/releases/yarn-4.13.0.cjs tsc && node .yarn/releases/yarn-4.13.0.cjs build:backend
RUN mkdir /bundle && tar xzf packages/backend/dist/skeleton.tar.gz -C /bundle && tar xzf packages/backend/dist/bundle.tar.gz -C /bundle
RUN node .yarn/releases/yarn-4.13.0.cjs workspaces focus --all --production
# Yarn nests a workspace's dependency when its version differs from the root
# one, and the bundle carries no node_modules, so copy the nested ones over.
RUN for dir in packages/* plugins/* external/*/plugins/*; do \
      if [ -d "$dir/node_modules" ] && [ -d "/bundle/$dir" ]; then cp -a "$dir/node_modules" "/bundle/$dir/"; fi; \
    done

FROM node:24-trixie-slim AS runtime
ARG CLAUDE_CODE_VERSION=2.1.318
# The assistant's reasoning tool runs Claude Code with each user's Claude Code token.
RUN npm install -g --no-fund --no-audit "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /bundle ./
COPY --chown=node:node app-config.yaml app-config.production.yaml ./
COPY --chown=node:node catalog ./catalog
USER node
EXPOSE 7007
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
