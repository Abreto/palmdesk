ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY .sources/backend/ ./
RUN pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/
COPY backend/overlay/secret.ts src/secret/secret.ts
COPY backend/compile.cjs ./compile.cjs
COPY backend/runtime/ ./runtime/
RUN node compile.cjs && pnpm prune --prod --ignore-scripts
RUN node runtime/verify-build.cjs

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    NODE_APP_RELEASE_PROJECT_ENV=prod \
    NODE_APP_RELEASE_PROJECT_NAME=palmdesk-server \
    NODE_APP_RELEASE_PROJECT_PORT=4300
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules/ ./node_modules/
COPY --from=build --chown=node:node /app/dist/ ./dist/
COPY --from=build --chown=node:node /app/runtime/ ./runtime/
USER node
EXPOSE 4300
CMD ["node", "runtime/main.cjs", "serve"]
