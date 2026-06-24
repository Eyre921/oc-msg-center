/**
 * Bridge HTTP server — multi-bot edition.
 *
 *   POST   /send            (from msg-center)   { target: { channel, accountId, externalId }, message }
 *   POST   /bots            (from msg-center)   { accountId, label, credentials }   provision a per-user bot
 *   DELETE /bots/:accountId (from msg-center)                                         revoke it
 *   POST   /inbound         (from openclaw forward-skill, local-only)                forward reverse events
 *
 * Outbound and provisioning translate to:
 *   openclaw channels add    --channel <openclaw-channel> --account <accountId> --token "<appId>:<secret>"
 *   openclaw message send    --channel <openclaw-channel> --account <accountId> --target <ref> --message ...
 *   openclaw gateway restart                                                        (after credential change)
 */
import { spawn } from "node:child_process";
import http from "node:http";

const PORT = Number(process.env.BRIDGE_PORT ?? 7081);
const SEND_TOKEN = process.env.BRIDGE_SEND_TOKEN ?? "";
const MSGCENTER_URL = (process.env.BRIDGE_MSGCENTER_URL ?? "").replace(/\/+$/, "");
const INBOUND_TOKEN = process.env.BRIDGE_MSGCENTER_INBOUND_TOKEN ?? "";
const CHANNEL_ID = process.env.BRIDGE_CHANNEL_ID ?? "channel";
const OPENCLAW_CHANNEL = process.env.BRIDGE_OPENCLAW_CHANNEL ?? CHANNEL_ID;

function authOk(req) {
  if (!SEND_TOKEN) return true;
  const auth = req.headers["authorization"] ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m && m[1].trim() === SEND_TOKEN;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function oc(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("openclaw", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `openclaw exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function sendOutbound({ accountId, externalId, body, file, image }) {
  const args = [
    "message",
    "send",
    "--channel",
    OPENCLAW_CHANNEL,
    "--account",
    accountId,
    "--target",
    `${OPENCLAW_CHANNEL}:c2c:${externalId}`,
  ];
  if (body) args.push("--message", body);
  if (file) args.push("--file", file);
  if (image) args.push("--image", image);
  return oc(args);
}

async function provisionBot({ accountId, credentials }) {
  // QQ: credentials = { appId, secret }
  // WeChat: credentials are provided through QR scan, not here; this endpoint just
  // registers the accountId placeholder and the operator must run `openclaw channels
  // login --channel openclaw-weixin` once interactively.
  if (CHANNEL_ID === "qqbot") {
    if (!credentials?.appId || !credentials?.secret)
      throw new Error("QQ bot requires credentials.appId and credentials.secret");
    await oc([
      "channels",
      "add",
      "--channel",
      OPENCLAW_CHANNEL,
      "--account",
      accountId,
      "--token",
      `${credentials.appId}:${credentials.secret}`,
    ]);
    await oc(["gateway", "restart"]).catch(() => {});
    return { ok: true };
  }
  if (CHANNEL_ID === "weixin") {
    // Trigger a QR login that will print the QR to STDOUT of this container's logs.
    // The operator scans it within ~90s; we shell out and let the child stream to our stdout.
    return await new Promise((resolve) => {
      const child = spawn(
        "openclaw",
        ["channels", "login", "--channel", OPENCLAW_CHANNEL, "--account", accountId],
        { stdio: "inherit" },
      );
      child.on("close", (code) =>
        code === 0 ? resolve({ ok: true }) : resolve({ ok: false, error: `login exited ${code}` }),
      );
    });
  }
  return { ok: true };
}

async function revokeBot(accountId) {
  // openclaw doesn't necessarily expose a `channels remove --account` command in every
  // build. Best-effort: try the obvious form and ignore failure.
  try {
    await oc(["channels", "remove", "--channel", OPENCLAW_CHANNEL, "--account", accountId]);
    await oc(["gateway", "restart"]).catch(() => {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true, channel: CHANNEL_ID });

  if (req.method === "POST" && req.url === "/send") {
    if (!authOk(req)) return send(401, { ok: false, error: "unauthorized" });
    try {
      const { target, message } = await readJson(req);
      if (!target?.externalId || !target?.accountId)
        throw new Error("target.accountId and target.externalId required");
      const text = [message?.title, message?.body].filter(Boolean).join("\n\n");
      const attachmentUrl = message?.attachment?.url ?? null;
      let remoteId;
      if (attachmentUrl) {
        const isImg = /^image\//.test(message?.attachment?.contentType ?? "");
        remoteId = await sendOutbound({
          accountId: target.accountId,
          externalId: target.externalId,
          body: text,
          [isImg ? "image" : "file"]: attachmentUrl,
        });
      } else {
        remoteId = await sendOutbound({
          accountId: target.accountId,
          externalId: target.externalId,
          body: text,
        });
      }
      return send(200, { ok: true, remoteId: remoteId || undefined });
    } catch (err) {
      return send(500, { ok: false, error: String(err.message || err) });
    }
  }

  if (req.method === "POST" && req.url === "/bots") {
    if (!authOk(req)) return send(401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJson(req);
      const r = await provisionBot(body);
      return send(r.ok ? 200 : 502, r);
    } catch (err) {
      return send(500, { ok: false, error: String(err.message || err) });
    }
  }

  const revokeMatch = req.url?.match(/^\/bots\/([^/?]+)/);
  if (req.method === "DELETE" && revokeMatch) {
    if (!authOk(req)) return send(401, { ok: false, error: "unauthorized" });
    const r = await revokeBot(decodeURIComponent(revokeMatch[1]));
    return send(r.ok ? 200 : 502, r);
  }

  if (req.method === "POST" && req.url === "/inbound") {
    try {
      const evt = await readJson(req);
      const body = {
        accountId: evt.accountId ?? evt.account ?? "default",
        externalId: evt.externalId ?? evt.from ?? evt.userId,
        displayName: evt.displayName ?? evt.userName ?? null,
        text: evt.text ?? evt.content ?? null,
        attachmentId: evt.attachmentId ?? null,
        raw: evt,
      };
      const resp = await fetch(`${MSGCENTER_URL}/api/v1/channels/${CHANNEL_ID}/inbound`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(INBOUND_TOKEN ? { authorization: `Bearer ${INBOUND_TOKEN}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (data?.reply && body.externalId) {
        await sendOutbound({
          accountId: body.accountId,
          externalId: body.externalId,
          body: data.reply,
        }).catch((e) => console.warn("[bridge] reply failed:", e.message));
      }
      return send(resp.ok ? 200 : 502, data);
    } catch (err) {
      return send(500, { ok: false, error: String(err.message || err) });
    }
  }

  send(404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on :${PORT} for channel ${CHANNEL_ID} -> ${MSGCENTER_URL}`);
});
