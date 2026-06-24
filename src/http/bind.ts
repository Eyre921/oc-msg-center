import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { adminOnly, getApp, handleError } from "./helpers.ts";
import { randomCode } from "../util/ids.ts";
import { now } from "../util/time.ts";

/**
 * QR-driven binding. An admin (or a user themselves) starts a binding for a
 * user; the server returns a code (and a PNG/SVG QR). The end-user sends
 * "BIND <CODE>" or just the code to the bot in QQ / WeChat; the bridge POSTs
 * an inbound event, the inbound router completes the binding.
 */
export function registerBindRoutes(server: FastifyInstance): void {
  // Start a binding for a user.
  server.post("/api/v1/bindings", async (req, reply) => {
    try {
      const app = getApp(req);
      const admin = adminOnly(req);
      const { userId, username } = (req.body ?? {}) as { userId?: string; username?: string };
      let target: { id: string; username: string } | null = null;
      if (userId) {
        const u = app.store.getUser(userId);
        if (u) target = u;
      } else if (username) {
        const u = app.store.getUserByUsername(username);
        if (u) target = u;
        else {
          const created = app.store.createUser(username, null, "user");
          target = created;
        }
      } else {
        return reply.code(400).send({ error: "userId or username required" });
      }
      if (!target) return reply.code(404).send({ error: "user not found" });

      const code = randomCode(8);
      const expiresAt = now() + app.cfg.bindingTtlSeconds;
      app.store.createBinding(code, target.id, expiresAt);
      const sample = `BIND ${code}`;
      const qrPng = await QRCode.toDataURL(sample, { width: 320, margin: 1 });
      return reply.send({
        code,
        userId: target.id,
        username: target.username,
        sampleMessage: sample,
        expiresAt,
        qr: qrPng,
        instructions:
          "请在 QQ / 微信 中向已部署的机器人发送上面的「sampleMessage」文本，或直接发送 8 位绑定码完成绑定。",
        startedBy: admin.username,
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Poll binding status.
  server.get("/api/v1/bindings/:code", async (req, reply) => {
    const app = getApp(req);
    const { code } = req.params as { code: string };
    const b = app.store.getBinding(code);
    if (!b) return reply.code(404).send({ error: "not found" });
    return reply.send({
      code: b.code,
      status: b.status,
      channel: b.channel,
      externalId: b.externalId,
      expiresAt: b.expiresAt,
    });
  });

  // QR PNG (for HTML <img src=...>)
  server.get("/api/v1/bindings/:code/qr.png", async (req, reply) => {
    const { code } = req.params as { code: string };
    const png = await QRCode.toBuffer(`BIND ${code}`, { type: "png", width: 320, margin: 1 });
    return reply.header("content-type", "image/png").send(png);
  });
}
