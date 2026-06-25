import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminOnly, auth, getApp, handleError } from "./helpers.ts";
import { hashPassword, verifyPassword } from "../auth/crypto.ts";
import { issueToken } from "../core/tokens.ts";
import { normalizeTopic } from "../util/time.ts";
import type { Priority } from "../types.ts";

const PrioritySchema = z.number().int().min(1).max(5);

/** Admin-only CRUD on users / groups / identities / subscriptions / hooks, plus login. */
export function registerAdminRoutes(server: FastifyInstance): void {
  // ---- login (session-less: returns a token) ----
  server.post("/api/v1/login", async (req, reply) => {
    const app = getApp(req);
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) return reply.code(400).send({ error: "username and password required" });
    const u = app.store.getUserByUsername(username);
    if (!u || !verifyPassword(password, u.passwordHash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const scopes = u.role === "admin" ? ["publish", "subscribe", "admin"] : ["publish", "subscribe"];
    const { token } = issueToken(app.store, u.id, "web-login", scopes);
    return reply.send({
      token,
      user: { id: u.id, username: u.username, role: u.role },
    });
  });

  // current principal
  server.get("/api/v1/me", async (req, reply) => {
    try {
      const principal = auth(req);
      const app = getApp(req);
      const identities = app.store.listIdentitiesForUser(principal.userId);
      const bots = app.store.listBotsForUser(principal.userId);
      const subs = app.store.listSubscriptionsForUser(principal.userId);
      const groups = app.store.listGroupsForUser(principal.userId);
      return reply.send({ principal, identities, bots, subscriptions: subs, groups });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- users ----
  server.get("/api/v1/users", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const users = app.store.listUsers();
      const enriched = users.map((u) => ({
        ...u,
        identities: app.store.listIdentitiesForUser(u.id),
        bots: app.store.listBotsForUser(u.id).map((b) => ({
          id: b.id,
          channel: b.channel,
          accountId: b.accountId,
          label: b.label,
          status: b.status,
        })),
        groups: app.store.listGroupsForUser(u.id).map((g) => g.name),
      }));
      return reply.send({ users: enriched });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.post("/api/v1/users", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const body = z
        .object({
          username: z.string().min(1).max(64),
          password: z.string().min(6).optional(),
          role: z.enum(["admin", "user"]).default("user"),
        })
        .parse(req.body ?? {});
      if (app.store.getUserByUsername(body.username))
        return reply.code(409).send({ error: "username already exists" });
      const u = app.store.createUser(
        body.username,
        body.password ? hashPassword(body.password) : null,
        body.role,
      );
      return reply.send(u);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/users/:id", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      app.store.deleteUser(id);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- identities ----
  server.delete("/api/v1/identities/:id", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      app.store.deleteIdentity(id);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- groups ----
  server.get("/api/v1/groups", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const groups = app.store.listGroups();
      const enriched = groups.map((g) => ({ ...g, members: app.store.listGroupMembers(g.id) }));
      return reply.send({ groups: enriched });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.post("/api/v1/groups", async (req, reply) => {
    try {
      const admin = adminOnly(req);
      const app = getApp(req);
      const body = z
        .object({ name: z.string().min(1).max(64), description: z.string().nullish() })
        .parse(req.body ?? {});
      if (app.store.getGroupByName(body.name))
        return reply.code(409).send({ error: "group name already exists" });
      const ownerId = admin.isBootstrapAdmin ? null : admin.userId;
      const g = app.store.createGroup(body.name, body.description ?? null, ownerId);
      return reply.send(g);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/groups/:id", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      app.store.deleteGroup(id);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.post("/api/v1/groups/:id/members", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      const body = z.object({ userId: z.string() }).parse(req.body ?? {});
      app.store.addGroupMember(id, body.userId);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/groups/:id/members/:userId", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id, userId } = req.params as { id: string; userId: string };
      app.store.removeGroupMember(id, userId);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- subscriptions (admin assigns) ----
  server.post("/api/v1/subscriptions", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const body = z
        .object({
          userId: z.string(),
          topic: z.string().min(1),
          channels: z.array(z.string()).default([]),
          minPriority: PrioritySchema.default(1),
        })
        .parse(req.body ?? {});
      const topic = normalizeTopic(body.topic);
      app.store.ensureTopic(topic);
      const sub = app.store.upsertSubscription(
        body.userId,
        topic,
        body.channels,
        body.minPriority as Priority,
      );
      return reply.send(sub);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/subscriptions", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const body = z.object({ userId: z.string(), topic: z.string() }).parse(req.body ?? {});
      app.store.deleteSubscription(body.userId, body.topic);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- topics & channels (read-only) ----
  server.get("/api/v1/topics", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const isSystem = (name: string) =>
        name.startsWith(app.cfg.inboxTopicPrefix) || name.startsWith("group-") || name.startsWith("dm-");
      const topics = app.store.listTopics().map((t) => ({
        ...t,
        system: isSystem(t.name),
        userSubscribers: app.store.listSubscriptionsForTopic(t.name).length,
        groupSubscribers: app.store.listGroupsForTopic(t.name).length,
      }));
      return reply.send({ topics });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Recent outbound messages (sent history) with a human target label.
  server.get("/api/v1/sent", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const limit = Math.min(200, Number((req.query as Record<string, string>).limit ?? 30) || 30);
      const messages = app.store.listRecentOutbound(app.cfg.inboxTopicPrefix, limit).map((m) => {
        let target: { kind: "user" | "group" | "channel"; label: string };
        if (m.topic.startsWith("dm-")) {
          const u = app.store.getUser(m.topic.slice(3));
          target = { kind: "user", label: u?.username ?? m.topic };
        } else if (m.topic.startsWith("group-")) {
          target = { kind: "group", label: m.topic.slice(6) };
        } else {
          target = { kind: "channel", label: m.topic };
        }
        return { ...m, target };
      });
      return reply.send({ messages });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Who receives a topic — users + groups.
  server.get("/api/v1/topics/:topic/subscribers", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { topic } = req.params as { topic: string };
      const users = app.store
        .listSubscriptionsForTopic(topic)
        .map((s) => {
          const u = app.store.getUser(s.userId);
          return u ? { id: u.id, username: u.username, minPriority: s.minPriority } : null;
        })
        .filter(Boolean);
      const groups = app.store
        .listGroupsForTopic(topic)
        .map((g) => {
          const grp = app.store.getGroup(g.groupId);
          return grp ? { id: grp.id, name: grp.name, minPriority: g.minPriority } : null;
        })
        .filter(Boolean);
      return reply.send({ topic, users, groups });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Add a user OR group to a topic (ntfy-style "join channel").
  server.post("/api/v1/topics/:topic/subscribers", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { topic: rawTopic } = req.params as { topic: string };
      const topic = normalizeTopic(rawTopic);
      app.store.ensureTopic(topic);
      const body = z
        .object({
          userId: z.string().optional(),
          username: z.string().optional(),
          groupId: z.string().optional(),
          groupName: z.string().optional(),
          minPriority: PrioritySchema.default(1),
        })
        .parse(req.body ?? {});

      if (body.userId || body.username) {
        const u = body.userId ? app.store.getUser(body.userId) : app.store.getUserByUsername(body.username!);
        if (!u) return reply.code(404).send({ error: "user not found" });
        app.store.upsertSubscription(u.id, topic, [], body.minPriority as Priority);
        return reply.send({ ok: true, kind: "user", id: u.id });
      }
      if (body.groupId || body.groupName) {
        const g = body.groupId ? app.store.getGroup(body.groupId) : app.store.getGroupByName(body.groupName!);
        if (!g) return reply.code(404).send({ error: "group not found" });
        app.store.subscribeGroupToTopic(topic, g.id, body.minPriority as Priority);
        return reply.send({ ok: true, kind: "group", id: g.id });
      }
      return reply.code(400).send({ error: "user or group required" });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/topics/:topic/subscribers", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { topic } = req.params as { topic: string };
      const body = z.object({ userId: z.string().optional(), groupId: z.string().optional() }).parse(req.body ?? {});
      if (body.userId) app.store.deleteSubscription(body.userId, topic);
      if (body.groupId) app.store.unsubscribeGroupFromTopic(topic, body.groupId);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // 1:1 conversation thread with a user (their messages + direct sends to them).
  server.get("/api/v1/users/:id/conversation", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      const user = app.store.getUser(id);
      if (!user) return reply.code(404).send({ error: "user not found" });
      const limit = Math.min(500, Number((req.query as Record<string, string>).limit ?? 200) || 200);
      const inboxTopic = `${app.cfg.inboxTopicPrefix}${id}`;
      const dmTopic = `dm-${id}`;
      const messages = app.store.listConversation(inboxTopic, dmTopic, limit).map((m) => {
        const att = m.attachmentId ? app.store.getAttachment(m.attachmentId) : null;
        return {
          ...m,
          direction: m.topic === inboxTopic ? "in" : "out",
          attachment: att
            ? { id: att.id, filename: att.filename, contentType: att.contentType, size: att.size, url: app.attachments.url(att) }
            : null,
        };
      });
      return reply.send({ user: { id: user.id, username: user.username }, messages });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Unified inbox: messages users sent back to their bots (reverse messages).
  server.get("/api/v1/inbox", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const limit = Math.min(500, Number((req.query as Record<string, string>).limit ?? 100) || 100);
      const msgs = app.store.listInboundMessages(app.cfg.inboxTopicPrefix, limit).map((m) => {
        const userId = m.topic.slice(app.cfg.inboxTopicPrefix.length);
        const u = app.store.getUser(userId);
        return { ...m, fromUser: u ? { id: u.id, username: u.username } : null };
      });
      return reply.send({ messages: msgs });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.get("/api/v1/channels", async (req, reply) => {
    try {
      auth(req);
      const app = getApp(req);
      return reply.send({
        channels: app.registry.list().map((c) => ({ id: c.id, label: c.label })),
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- outbound webhooks (per-topic) ----
  server.get("/api/v1/webhooks", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      return reply.send({ webhooks: app.store.listAllWebhooks() });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.post("/api/v1/webhooks", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const body = z
        .object({
          topic: z.string().min(1),
          url: z.string().url(),
          secret: z.string().nullish(),
        })
        .parse(req.body ?? {});
      const hook = app.store.createWebhook(normalizeTopic(body.topic), body.url, body.secret ?? null);
      return reply.send(hook);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/webhooks/:id", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      app.store.deleteWebhook(id);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ---- tokens (per-user) ----
  server.get("/api/v1/tokens", async (req, reply) => {
    try {
      const principal = auth(req);
      const app = getApp(req);
      return reply.send({ tokens: app.store.listTokensForUser(principal.userId) });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.post("/api/v1/tokens", async (req, reply) => {
    try {
      const principal = auth(req);
      const app = getApp(req);
      const body = z
        .object({
          label: z.string().nullish(),
          scopes: z.array(z.enum(["publish", "subscribe", "admin"])).default(["publish", "subscribe"]),
        })
        .parse(req.body ?? {});
      const requestedAdmin = body.scopes.includes("admin");
      if (requestedAdmin && principal.role !== "admin") {
        return reply.code(403).send({ error: "only admins can mint admin tokens" });
      }
      const { token, record } = issueToken(app.store, principal.userId, body.label ?? null, body.scopes);
      return reply.send({ token, record });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  server.delete("/api/v1/tokens/:id", async (req, reply) => {
    try {
      const principal = auth(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      app.store.deleteToken(id, principal.userId);
      return reply.send({ ok: true });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
