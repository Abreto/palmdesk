ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:1.28-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /build
RUN npm install --global pnpm@11.19.0
COPY .sources/frontend/ ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --frozen-lockfile --ignore-scripts
ENV VITE_API_BASE_URL=/api \
    VITE_SIGNALING_URL= \
    VITE_CLIENT_BASE_URL= \
    VITE_TURN_URL= \
    VITE_TURN_USERNAME= \
    VITE_TURN_CREDENTIAL= \
    VITE_ENABLE_UPSTREAM_VERSION_CHECK=false \
    VITE_OPEN_DEVTOOLS=false
RUN pnpm build:prod

FROM ${NGINX_IMAGE}
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist/ /usr/share/nginx/html/
RUN nginx -t
EXPOSE 80
