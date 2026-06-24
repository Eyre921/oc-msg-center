/**
 * OpenClaw skill that forwards every inbound channel message to the bridge.
 * Installed by entrypoint.sh into ~/.openclaw/skills/msgcenter-forward/.
 *
 * The exact OpenClaw plugin SDK shape is owned by upstream; if you find that
 * `api.onMessage` / `runtime.events.onInbound` are not exposed in your build,
 * adapt this file to whatever hook your version provides — the only thing that
 * matters is that for each inbound channel message we POST a small JSON
 * payload to http://127.0.0.1:${BRIDGE_PORT}/inbound.
 */
const FALLBACK_BRIDGE_PORT = process.env.BRIDGE_PORT || "7081";

async function forward(evt) {
  try {
    await fetch(`http://127.0.0.1:${FALLBACK_BRIDGE_PORT}/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(evt),
    });
  } catch (err) {
    console.error("[msgcenter-forward] failed:", err?.message ?? err);
  }
}

module.exports = {
  id: "msgcenter-forward",
  name: "MsgCenter Forward",
  register(api) {
    const hook = api?.runtime?.onChannelMessage ?? api?.onMessage;
    if (!hook) {
      console.warn("[msgcenter-forward] could not locate a message hook on the runtime API");
      return;
    }
    hook(async (msg) => {
      await forward({
        externalId: msg.from?.externalId ?? msg.from?.id ?? msg.userId,
        displayName: msg.from?.displayName ?? msg.from?.name ?? null,
        text: msg.text ?? msg.content ?? null,
        attachmentId: msg.attachmentId ?? null,
        raw: msg,
      });
    });
  },
};
