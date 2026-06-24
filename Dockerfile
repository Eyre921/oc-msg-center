# oc-msg-center — self-hosted notification hub for OpenClaw QQ/WeChat plugins.
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production \
    MSGCENTER_DATA_DIR=/data \
    MSGCENTER_HOST=0.0.0.0 \
    MSGCENTER_PORT=2586

# better-sqlite3 needs a C/C++ toolchain to build native bindings on first install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY web ./web

# Drop build deps once native modules compiled.
RUN apt-get purge -y python3 make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 2586
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MSGCENTER_PORT||2586)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/index.ts"]
