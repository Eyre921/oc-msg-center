# oc-msg-center — single image (msg-center + embedded openclaw runtime).
#
# msg-center spawns `openclaw gateway start --foreground` as a managed child
# process. The QQ and WeChat openclaw plugins are baked in at build time so
# first-boot is fast. Personal bot credentials (QQ AppID/Secret, WeChat
# scan sessions) are pushed into the gateway at runtime from the web admin.

# ---- stage 1: build the React admin UI ----
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- stage 2: runtime ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    MSGCENTER_DATA_DIR=/data \
    MSGCENTER_HOST=0.0.0.0 \
    MSGCENTER_PORT=2586

# better-sqlite3 needs python3/make/g++ for its native binding.
# We keep python3 around at runtime because openclaw plugin install also
# sometimes node-gyp-rebuilds against the running Node version.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# msg-center runtime deps (uses lockfile so versions match local dev).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# msg-center source + the built UI from stage 1.
COPY tsconfig.json ./
COPY src ./src
COPY web/package.json ./web/package.json
COPY --from=web /web/dist ./web/dist

# Install openclaw + the two channel plugins globally so msg-center can shell
# out without a runtime dependency on the network at first boot.
RUN npm install -g --no-audit --no-fund openclaw \
 && openclaw plugins install @tencent-connect/openclaw-qqbot || true \
 && openclaw plugins install @tencent-weixin/openclaw-weixin || true

# Drop build deps that are no longer needed at runtime.
RUN apt-get purge -y make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /root/.openclaw

EXPOSE 2586
VOLUME ["/data", "/root/.openclaw"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${MSGCENTER_PORT:-2586}/healthz" >/dev/null || exit 1

# Default channels.json (openclaw embedded for QQ + WeChat, plus console for
# smoke tests). Users can override by mounting their own MSGCENTER_CHANNELS_FILE
# or setting MSGCENTER_CHANNELS env var.
RUN printf '%s\n' '[' \
  '  { "id": "qqbot", "label": "QQ", "type": "openclaw", "openclawChannel": "qqbot", "enabled": true },' \
  '  { "id": "weixin", "label": "微信", "type": "openclaw", "openclawChannel": "openclaw-weixin", "enabled": true },' \
  '  { "id": "console", "label": "Console", "type": "console", "enabled": true }' \
  ']' > /etc/msgcenter-channels.json
ENV MSGCENTER_CHANNELS_FILE=/etc/msgcenter-channels.json

CMD ["npx", "tsx", "src/index.ts"]
