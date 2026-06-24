import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminOnly, getApp, handleError } from "./helpers.ts";
import { weixinAccountIdFromToken } from "../openclaw/weixin-session.ts";

const CreateBody = z.object({
  userId: z.string(),
  channel: z.string().min(1),
  accountId: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "accountId must be url-safe"),
  label: z.string().nullish(),
  credentials: z.record(z.any()).default({}),
});

/** Admin-only management of per-user bot credentials. */
export function registerBotRoutes(server: FastifyInstance): void {
  server.get("/api/v1/bots", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const bots = app.store.listAllBots().map((b) => ({
        ...b,
        credentials: redact(b.credentials),
      }));
      return reply.send({ bots });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.get("/api/v1/users/:userId/bots", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { userId } = req.params as { userId: string };
      const bots = app.store.listBotsForUser(userId).map((b) => ({
        ...b,
        credentials: redact(b.credentials),
      }));
      return reply.send({ bots });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.post("/api/v1/bots", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const body = CreateBody.parse(req.body ?? {});
      if (!app.registry.has(body.channel))
        return reply.code(400).send({ error: `channel "${body.channel}" not configured` });
      if (!app.store.getUser(body.userId))
        return reply.code(404).send({ error: "user not found" });

      // For an imported WeChat session the accountId is fixed by the token
      // (openclaw derives the on-disk filename from it), so override whatever
      // the form sent.
      const cc0 = app.cfg.channels.find((c) => c.id === body.channel);
      const isWeixin = (cc0?.openclawChannel ?? body.channel).includes("weixin");
      const wxToken = typeof body.credentials.token === "string" ? body.credentials.token : "";
      const accountId = isWeixin && wxToken ? weixinAccountIdFromToken(wxToken) : body.accountId;

      if (app.store.getBotByAccount(body.channel, accountId))
        return reply.code(409).send({ error: `(${body.channel}, ${accountId}) is taken` });

      const bot = app.store.createBot({
        userId: body.userId,
        channel: body.channel,
        accountId,
        label: body.label ?? null,
        credentials: body.credentials,
        status: "pending",
      });

      // Provisioning (channels add + agent wiring + gateway restart) takes
      // ~15s — far too long to block the request. Respond immediately with a
      // pending bot; the UI polls /api/v1/users for the status to flip to
      // active/error. WeChat additionally surfaces a QR login session the UI
      // can poll by its deterministic id.
      // QR is only needed for WeChat WITHOUT an imported session token.
      const needsQrScan = isWeixin && !wxToken;
      const loginSessionId = `${bot.channel}:${bot.accountId}`;

      void app.botControl
        .provision(bot)
        .then((result) => {
          if (!result.ok) {
            app.store.updateBotStatus(bot.id, "error", false);
            app.log.warn({ bot: bot.id, err: result.error }, "bot provisioning failed");
          } else if (!result.sessionId) {
            app.store.updateBotStatus(bot.id, "active");
          }
          // sessionId (WeChat): stays pending until the QR login completes,
          // at which point the login-session endpoint marks it active.
        })
        .catch((err) => {
          app.store.updateBotStatus(bot.id, "error", false);
          app.log.error({ bot: bot.id, err: String(err) }, "bot provisioning threw");
        });

      const fresh = app.store.getBot(bot.id)!;
      return reply.send({
        ...fresh,
        credentials: redact(fresh.credentials),
        provisioning: true,
        ...(needsQrScan ? { needsQrScan: true, loginSessionId } : {}),
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.patch("/api/v1/bots/:id", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      const bot = app.store.getBot(id);
      if (!bot) return reply.code(404).send({ error: "bot not found" });
      const body = z
        .object({
          credentials: z.record(z.any()).optional(),
          label: z.string().nullish(),
          status: z.enum(["pending", "active", "disabled", "error"]).optional(),
        })
        .parse(req.body ?? {});
      if (body.credentials) {
        app.store.updateBotCredentials(id, body.credentials);
        const refreshed = { ...bot, credentials: body.credentials };
        const result = await app.botControl.provision(refreshed);
        app.store.updateBotStatus(id, result.ok ? "active" : "error", false);
      }
      if (body.status) app.store.updateBotStatus(id, body.status, false);
      const updated = app.store.getBot(id)!;
      return reply.send({ ...updated, credentials: redact(updated.credentials) });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.get("/api/v1/bots/login-sessions/:sessionId", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { sessionId } = req.params as { sessionId: string };
      const sess = app.botControl.wechatLogins.get(sessionId);
      if (!sess) return reply.code(404).send({ error: "session not found" });
      // If the login finished, mark the corresponding bot active.
      if (sess.status === "ok") {
        const [channel, accountId] = sess.id.split(":", 2);
        const bot = app.store.getBotByAccount(channel, accountId);
        if (bot && bot.status !== "active") app.store.updateBotStatus(bot.id, "active");
      }
      return reply.send({
        id: sess.id,
        status: sess.status,
        buffer: sess.buffer,
        exitCode: sess.exitCode ?? null,
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/bots/:id", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      const bot = app.store.getBot(id);
      if (!bot) return reply.code(404).send({ error: "bot not found" });
      await app.botControl.revoke(bot.channel, bot.accountId);
      app.store.deleteBot(id);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

function redact(creds: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v !== "string") out[k] = v;
    else if (/secret|token|password|key/i.test(k) && v.length > 4) out[k] = v.slice(0, 2) + "•••" + v.slice(-2);
    else out[k] = v;
  }
  return out;
}
