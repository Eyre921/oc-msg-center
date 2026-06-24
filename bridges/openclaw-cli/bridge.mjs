/**
 * Bridge HTTP server.
 *
 * Outbound: POST /send  body={target, message} from msg-center.
 *   We spawn:  openclaw message send --channel <openclaw-channel> --target <ref> --message <body>
 *   For attachments we use --file / --image as appropriate.
 *
 * Inbound (POST /inbound) is invoked locally by the forward-skill above each time
 * openclaw sees a message in QQ / WeChat. We translate and POST it on to
 *   {MSGCENTER_URL}/api/v1/channels/{CHANNEL_ID}/inbound.
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

function ocSend({ target, body, file, image }) {
  return new Promise((resolve, reject) => {
    const args = ["message", "send", "--channel", OPENCLAW_CHANNEL, "--target", target];
    if (body) args.push("--message", body);
    if (file) args.push("--file", file);
    if (image) args.push("--image", image);
    const child = spawn("openclaw", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, stdout: out.trim() });
      else reject(new Error(err.trim() || `openclaw exited ${code}`));
    });
    child.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, channel: CHANNEL_ID }));
  }

  if (req.method === "POST" && req.url === "/send") {
    if (!authOk(req)) { res.writeHead(401); return res.end(); }
    try {
      const { target, message } = await readJson(req);
      if (!target?.externalId) throw new Error("target.externalId required");
      const ref = `${OPENCLAW_CHANNEL}:c2c:${target.externalId}`;
      const text = [message?.title, message?.body].filter(Boolean).join("\n\n");
      const attachmentUrl = message?.attachment?.url ?? null;
      let result;
      if (attachmentUrl) {
        const isImg = /^image\//.test(message?.attachment?.contentType ?? "");
        result = await ocSend({ target: ref, body: text, [isImg ? "image" : "file"]: attachmentUrl });
      } else {
        result = await ocSend({ target: ref, body: text });
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, remoteId: result.stdout || undefined }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
  }

  // Local-only endpoint hit by forward-skill.js — translate & forward to msg-center.
  if (req.method === "POST" && req.url === "/inbound") {
    try {
      const evt = await readJson(req);
      const body = {
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
      // If the center replied with a string, we should echo it back to the user.
      if (data?.reply && body.externalId) {
        await ocSend({ target: `${OPENCLAW_CHANNEL}:c2c:${body.externalId}`, body: data.reply }).catch(() => {});
      }
      res.writeHead(resp.ok ? 200 : 502, { "content-type": "application/json" });
      return res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on :${PORT} for channel ${CHANNEL_ID} -> ${MSGCENTER_URL}`);
});
