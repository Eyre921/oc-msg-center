#!/usr/bin/env node
/**
 * A tiny test bridge with no openclaw / QQ / WeChat dependencies.
 *
 *   - GET  /healthz                — basic liveness probe
 *   - POST /send                   — called by msg-center; just prints the payload
 *   - POST /inject?externalId=…    — manually post a fake inbound message
 *
 * Useful for verifying the end-to-end publish / inbound flow on a laptop.
 *
 *   node bridges/mock/mock-bridge.mjs            # listens on :7099
 *
 * Then in your msg-center channels.json:
 *
 *   [{ "id": "mock", "label": "Mock", "type": "webhook",
 *      "sendUrl": "http://localhost:7099/send",
 *      "sendToken": "x", "inboundToken": "y" }]
 *
 *   BRIDGE_MSGCENTER_URL=http://localhost:2586 \
 *   BRIDGE_MSGCENTER_INBOUND_TOKEN=y \
 *   node bridges/mock/mock-bridge.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 7099);
const MSGCENTER_URL = (process.env.BRIDGE_MSGCENTER_URL ?? "http://localhost:2586").replace(/\/+$/, "");
const INBOUND_TOKEN = process.env.BRIDGE_MSGCENTER_INBOUND_TOKEN ?? "";

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === "POST" && url.pathname === "/send") {
    const body = await readJson(req);
    console.log("[mock] would deliver:", JSON.stringify(body, null, 2));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, remoteId: `mock-${Date.now()}` }));
  }

  if (req.method === "POST" && url.pathname === "/inject") {
    const externalId = url.searchParams.get("externalId") ?? "mock-user-1";
    const text = url.searchParams.get("text") ?? "hello from mock";
    const resp = await fetch(`${MSGCENTER_URL}/api/v1/channels/mock/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(INBOUND_TOKEN ? { authorization: `Bearer ${INBOUND_TOKEN}` } : {}),
      },
      body: JSON.stringify({ externalId, displayName: `mock-${externalId}`, text }),
    });
    const data = await resp.json().catch(() => ({}));
    res.writeHead(resp.ok ? 200 : 500, { "content-type": "application/json" });
    return res.end(JSON.stringify(data));
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`[mock bridge] listening on :${PORT} -> ${MSGCENTER_URL}`);
});
