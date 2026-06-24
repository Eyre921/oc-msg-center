# Bridge sidecar: msg-center <-> openclaw CLI (QQ / WeChat plugin).
#
# It exposes:
#   POST /send          — called BY msg-center; turns it into `openclaw message send`
#   GET  /qr            — first-time WeChat QR (if applicable)
# And it CALLS:
#   POST {MSGCENTER_URL}/api/v1/channels/{CHANNEL_ID}/inbound  — for every reverse event
#
# Inbound is delivered to this container by openclaw via a small forwarding
# skill (see ./forward-skill.js — installed into openclaw on first boot).
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
RUN npm install -g --no-audit --no-fund openclaw

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY bridge.mjs entrypoint.sh forward-skill.js ./
RUN chmod +x entrypoint.sh

EXPOSE 7081 7082
VOLUME ["/root/.openclaw"]
ENTRYPOINT ["./entrypoint.sh"]
