import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { auth, getApp, handleError, tryAuth } from "./helpers.ts";
import { normalizeTopic } from "../util/time.ts";
import type { Priority } from "../types.ts";

const PrioritySchema = z.number().int().min(1).max(5);

const PublishBody = z
  .object({
    topic: z.string().min(1).max(64).optional(),
    title: z.string().max(200).nullish(),
    message: z.string().optional(),
    body: z.string().optional(),
    priority: PrioritySchema.optional(),
    tags: z.array(z.string()).optional(),
    click: z.string().url().nullish(),
    attachmentId: z.string().optional(),
    /** Optional override of delivery channels. */
    channels: z.array(z.string()).optional(),
    /** Send to a named group instead of fanning out by topic subscribers. */
    group: z.string().optional(),
    /** Send directly to one user (by id or username). */
    user: z.string().optional(),
  })
  .refine((b) => b.topic || b.group || b.user, "one of topic / group / user is required");

export function registerPublishRoutes(server: FastifyInstance): void {
  // ntfy-style: POST /:topic with raw body or JSON.
  server.post("/:topic", async (req, reply) => {
    try {
      const { topic } = req.params as { topic: string };
      const app = getApp(req);
      const principal = app.cfg.authPublish ? auth(req) : tryAuth(req);

      // Custom headers (ntfy-compatible)
      const title = (req.headers["x-title"] as string | undefined) ?? null;
      const priorityHeader = req.headers["x-priority"] as string | undefined;
      const priority = priorityHeader
        ? (Math.max(1, Math.min(5, parseInt(priorityHeader, 10))) as Priority)
        : 3;
      const tagsHeader = req.headers["x-tags"] as string | undefined;
      const tags = tagsHeader ? tagsHeader.split(",").map((t) => t.trim()).filter(Boolean) : [];
      const click = (req.headers["x-click"] as string | undefined) ?? null;
      const attachmentId = (req.headers["x-attachment"] as string | undefined) ?? null;

      const ct = (req.headers["content-type"] ?? "").toString();
      let body = "";
      if (ct.startsWith("application/json")) {
        const parsed = PublishBody.parse(req.body ?? {});
        return reply.send(
          await app.publisher.publish({
            topic: parsed.topic ?? topic,
            title: parsed.title ?? title,
            body: parsed.message ?? parsed.body ?? "",
            priority: (parsed.priority ?? priority) as Priority,
            tags: parsed.tags ?? tags,
            click: parsed.click ?? click,
            sender: principal?.username ?? null,
            attachmentId: parsed.attachmentId ?? attachmentId,
            channels: parsed.channels,
          }),
        );
      }
      if (typeof req.body === "string") body = req.body;
      else if (Buffer.isBuffer(req.body)) body = req.body.toString("utf8");
      else body = String(req.body ?? "");

      const msg = await app.publisher.publish({
        topic,
        title,
        body,
        priority,
        tags,
        click,
        attachmentId,
        sender: principal?.username ?? null,
      });
      return reply.send(msg);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Rich JSON publish (topic or group)
  server.post("/api/v1/publish", async (req, reply) => {
    try {
      const app = getApp(req);
      const principal = app.cfg.authPublish ? auth(req) : tryAuth(req);
      const body = PublishBody.parse(req.body ?? {});
      const common = {
        title: body.title ?? null,
        body: body.message ?? body.body ?? "",
        priority: body.priority as Priority | undefined,
        tags: body.tags,
        click: body.click ?? null,
        sender: principal?.username ?? null,
        attachmentId: body.attachmentId ?? null,
        channels: body.channels,
      };
      if (body.user) {
        const u = app.store.getUser(body.user) ?? app.store.getUserByUsername(body.user);
        if (!u) return reply.code(404).send({ error: `user "${body.user}" not found` });
        const msg = await app.publisher.publishToUser(u, {
          ...common,
          topic: body.topic ? normalizeTopic(body.topic) : undefined,
        });
        return reply.send(msg);
      }
      if (body.group) {
        const group = app.store.getGroupByName(body.group);
        if (!group) return reply.code(404).send({ error: `group "${body.group}" not found` });
        const msg = await app.publisher.publishToGroup(group, {
          ...common,
          topic: body.topic ? normalizeTopic(body.topic) : undefined,
        });
        return reply.send(msg);
      }
      if (!body.topic) return reply.code(400).send({ error: "topic required" });
      const msg = await app.publisher.publish({ topic: body.topic, ...common });
      return reply.send(msg);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // List recent messages for a topic.
  server.get("/api/v1/topics/:topic/messages", async (req: FastifyRequest, reply: FastifyReply) => {
    const { topic } = req.params as { topic: string };
    const app = getApp(req);
    const since = Number((req.query as Record<string, string>).since ?? 0) || 0;
    const limit = Math.min(500, Number((req.query as Record<string, string>).limit ?? 100) || 100);
    return reply.send({ messages: app.store.listMessages(topic, since, limit) });
  });
}
