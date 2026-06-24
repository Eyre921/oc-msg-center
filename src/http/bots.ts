import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminOnly, getApp, handleError } from "./helpers.ts";

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
      if (app.store.getBotByAccount(body.channel, body.accountId))
        return reply.code(409).send({ error: `(${body.channel}, ${body.accountId}) is taken` });

      const bot = app.store.createBot({
        userId: body.userId,
        channel: body.channel,
        accountId: body.accountId,
        label: body.label ?? null,
        credentials: body.credentials,
        status: "pending",
      });
      const result = await app.botControl.provision(bot);
      if (!result.ok) {
        app.store.updateBotStatus(bot.id, "error", false);
        return reply.code(502).send({ error: `bridge rejected: ${result.error}`, bot });
      }
      app.store.updateBotStatus(bot.id, "active");
      const fresh = app.store.getBot(bot.id)!;
      return reply.send({ ...fresh, credentials: redact(fresh.credentials) });
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
