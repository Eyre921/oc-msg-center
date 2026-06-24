#!/usr/bin/env sh
# Multi-bot bridge entrypoint.
#
# This container hosts ONE channel (qqbot OR weixin) but holds MANY bot
# accounts. Per-user bots are pushed in by msg-center via POST /bots after
# the operator clicks "add bot for user X" in the web admin. No credentials
# are baked into env vars.

set -e
: "${BRIDGE_CHANNEL_ID:?BRIDGE_CHANNEL_ID is required (qqbot or weixin)}"
: "${BRIDGE_PORT:=7081}"
: "${BRIDGE_MSGCENTER_URL:?BRIDGE_MSGCENTER_URL is required}"

PLUGIN="${BRIDGE_OPENCLAW_PLUGIN:-}"
CHANNEL="${BRIDGE_OPENCLAW_CHANNEL:-$BRIDGE_CHANNEL_ID}"

if [ -z "$PLUGIN" ]; then
  case "$BRIDGE_CHANNEL_ID" in
    qqbot)  PLUGIN="@tencent-connect/openclaw-qqbot" ;;
    weixin) PLUGIN="@tencent-weixin/openclaw-weixin" ;;
  esac
fi

if [ -n "$PLUGIN" ]; then
  echo "[bridge] ensuring openclaw plugin ${PLUGIN} is installed"
  openclaw plugins install "${PLUGIN}" || true
fi

# Install the local forwarding skill: openclaw sees an inbound message and
# POSTs it to http://127.0.0.1:${BRIDGE_PORT}/inbound, which the bridge then
# relays to msg-center.
mkdir -p /root/.openclaw/skills/msgcenter-forward
cp /app/forward-skill.js /root/.openclaw/skills/msgcenter-forward/index.js
cat > /root/.openclaw/skills/msgcenter-forward/openclaw.skill.json <<EOF
{ "id": "msgcenter-forward", "name": "MsgCenter Forward", "entry": "index.js" }
EOF

echo "[bridge] starting openclaw gateway in background"
( openclaw gateway start --foreground 2>&1 | sed 's/^/[openclaw] /' ) &

echo "[bridge] HTTP bridge on :${BRIDGE_PORT}, msg-center -> ${BRIDGE_MSGCENTER_URL}"
exec node /app/bridge.mjs
