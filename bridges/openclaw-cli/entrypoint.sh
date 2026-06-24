#!/usr/bin/env sh
# Bridge sidecar entrypoint.
#
# 1. Install the relevant openclaw channel plugin if not present.
# 2. Configure its credentials (QQ AppID/Secret) or kick off a QR login (WeChat).
# 3. Drop the forward-skill into openclaw so inbound events are HTTP-POSTed to us.
# 4. Start openclaw gateway in the background.
# 5. Start the HTTP bridge.

set -e

: "${BRIDGE_CHANNEL_ID:?BRIDGE_CHANNEL_ID is required (e.g. qqbot or weixin)}"
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

case "$BRIDGE_CHANNEL_ID" in
  qqbot)
    if [ -n "$QQBOT_APPID" ] && [ -n "$QQBOT_SECRET" ]; then
      echo "[bridge] configuring QQ channel"
      openclaw channels add --channel qqbot --token "${QQBOT_APPID}:${QQBOT_SECRET}" || true
    else
      echo "[bridge][warn] QQBOT_APPID / QQBOT_SECRET not set; QQ channel will not authenticate"
    fi
    ;;
  weixin)
    if [ ! -f "/root/.openclaw/openclaw.json" ] || ! grep -q "openclaw-weixin" "/root/.openclaw/openclaw.json" 2>/dev/null; then
      echo "[bridge] starting one-time WeChat QR login — scan the QR shown below"
      openclaw channels login --channel "${CHANNEL}" || true
    fi
    ;;
esac

# Drop the forwarding skill that POSTs inbound events to this bridge.
mkdir -p /root/.openclaw/skills/msgcenter-forward
cp /app/forward-skill.js /root/.openclaw/skills/msgcenter-forward/index.js
cat > /root/.openclaw/skills/msgcenter-forward/openclaw.skill.json <<EOF
{ "id": "msgcenter-forward", "name": "MsgCenter Forward", "entry": "index.js" }
EOF

echo "[bridge] starting openclaw gateway in background"
( openclaw gateway start --foreground 2>&1 | sed 's/^/[openclaw] /' ) &

echo "[bridge] starting HTTP bridge on :${BRIDGE_PORT}"
exec node /app/bridge.mjs
