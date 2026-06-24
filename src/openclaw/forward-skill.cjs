// msgcenter-forward — installed into ~/.openclaw/skills by the supervisor.
//
// POSTs every inbound QQ / WeChat message back to oc-msg-center over loopback
// HTTP. The exact runtime API exposed by openclaw varies; we look for the
// most common hook names and fall back to no-op if none are present (the
// supervisor will log a warning the first time it sees gateway output).

const url = process.env.OC_MSGCENTER_INBOUND_URL || "http://127.0.0.1:2586";
const token = process.env.OC_MSGCENTER_INBOUND_TOKEN || "";

async function forward(channelId, msg) {
  try {
    await fetch(`${url}/api/v1/channels/${channelId}/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        accountId: msg.accountId || msg.account || "default",
        externalId: msg.from?.externalId || msg.from?.id || msg.userId,
        displayName: msg.from?.displayName || msg.from?.name || null,
        text: msg.text || msg.content || null,
        attachmentId: msg.attachmentId || null,
        raw: msg,
      }),
    });
  } catch (err) {
    console.warn("[msgcenter-forward] failed:", err?.message ?? err);
  }
}

module.exports = {
  id: "msgcenter-forward",
  name: "MsgCenter Forward",
  register(api) {
    const hook = api?.runtime?.onChannelMessage || api?.onMessage || api?.onInbound;
    if (!hook) {
      console.warn("[msgcenter-forward] could not find a message hook on the runtime API");
      return;
    }
    hook(async (msg) => {
      const channel = msg?.channel?.id || msg?.channelId || msg?.channel || "unknown";
      await forward(channel, msg);
    });
  },
};
