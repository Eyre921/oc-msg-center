import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA } from "./schema.ts";
import { uid } from "../util/ids.ts";
import { now } from "../util/time.ts";
import type {
  ApiToken,
  Attachment,
  Binding,
  Bot,
  Group,
  Identity,
  Message,
  OutboundWebhook,
  Priority,
  Role,
  Subscription,
  Topic,
  User,
} from "../types.ts";

type Row = Record<string, any>;

/** Typed data-access layer over a single sqlite database. */
export class Store {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- users ----------------------------------------------------------------

  createUser(username: string, passwordHash: string | null, role: Role = "user"): User {
    const id = uid("u");
    const ts = now();
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)")
      .run(id, username, passwordHash, role, ts);
    return { id, username, role, createdAt: ts };
  }

  getUser(id: string): User | null {
    return mapUser(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row);
  }

  getUserByUsername(username: string): (User & { passwordHash: string | null }) | null {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as Row;
    if (!row) return null;
    return { ...mapUser(row)!, passwordHash: row.password_hash ?? null };
  }

  listUsers(): User[] {
    return (this.db.prepare("SELECT * FROM users ORDER BY created_at").all() as Row[]).map((r) => mapUser(r)!);
  }

  countUsers(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as Row).n as number;
  }

  deleteUser(id: string): void {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  // ---- bots -----------------------------------------------------------------

  createBot(b: Omit<Bot, "id" | "createdAt" | "lastSeenAt">): Bot {
    const id = uid("bot");
    const ts = now();
    this.db
      .prepare(
        "INSERT INTO bots (id, user_id, channel, account_id, label, credentials_json, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(id, b.userId, b.channel, b.accountId, b.label, JSON.stringify(b.credentials), b.status, ts);
    return { id, createdAt: ts, lastSeenAt: null, ...b };
  }

  getBot(id: string): Bot | null {
    return mapBot(this.db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as Row);
  }

  getBotByAccount(channel: string, accountId: string): Bot | null {
    return mapBot(
      this.db
        .prepare("SELECT * FROM bots WHERE channel = ? AND account_id = ?")
        .get(channel, accountId) as Row,
    );
  }

  listBotsForUser(userId: string): Bot[] {
    return (this.db.prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY created_at").all(userId) as Row[]).map(
      (r) => mapBot(r)!,
    );
  }

  listAllBots(): Bot[] {
    return (this.db.prepare("SELECT * FROM bots ORDER BY created_at").all() as Row[]).map((r) => mapBot(r)!);
  }

  updateBotStatus(id: string, status: Bot["status"], touch = true): void {
    if (touch) this.db.prepare("UPDATE bots SET status = ?, last_seen_at = ? WHERE id = ?").run(status, now(), id);
    else this.db.prepare("UPDATE bots SET status = ? WHERE id = ?").run(status, id);
  }

  updateBotCredentials(id: string, credentials: Record<string, unknown>): void {
    this.db.prepare("UPDATE bots SET credentials_json = ? WHERE id = ?").run(JSON.stringify(credentials), id);
  }

  deleteBot(id: string): void {
    this.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
  }

  // ---- identities -----------------------------------------------------------

  upsertIdentity(
    userId: string,
    channel: string,
    accountId: string,
    externalId: string,
    displayName: string | null,
    botId: string | null = null,
  ): Identity {
    const existing = this.getIdentity(channel, accountId, externalId);
    if (existing) {
      this.db
        .prepare("UPDATE identities SET user_id = ?, display_name = ?, bot_id = ? WHERE id = ?")
        .run(userId, displayName, botId, existing.id);
      return { ...existing, userId, displayName, botId };
    }
    const id = uid("idn");
    const ts = now();
    this.db
      .prepare(
        "INSERT INTO identities (id, user_id, bot_id, channel, account_id, external_id, display_name, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(id, userId, botId, channel, accountId, externalId, displayName, ts);
    return { id, userId, botId, channel, accountId, externalId, displayName, createdAt: ts };
  }

  getIdentity(channel: string, accountId: string, externalId: string): Identity | null {
    const row = this.db
      .prepare("SELECT * FROM identities WHERE channel = ? AND account_id = ? AND external_id = ?")
      .get(channel, accountId, externalId) as Row;
    return mapIdentity(row);
  }

  /** All identities a user has been bound on. */
  listIdentitiesForUser(userId: string): Identity[] {
    return (this.db.prepare("SELECT * FROM identities WHERE user_id = ?").all(userId) as Row[]).map(
      (r) => mapIdentity(r)!,
    );
  }

  /** Identity bound on a specific bot (a user has at most one). */
  getIdentityForBot(botId: string): Identity | null {
    return mapIdentity(this.db.prepare("SELECT * FROM identities WHERE bot_id = ? LIMIT 1").get(botId) as Row);
  }

  deleteIdentity(id: string): void {
    this.db.prepare("DELETE FROM identities WHERE id = ?").run(id);
  }

  // ---- topics ---------------------------------------------------------------

  ensureTopic(name: string, ownerId: string | null = null): Topic {
    const existing = this.getTopic(name);
    if (existing) return existing;
    const ts = now();
    this.db.prepare("INSERT INTO topics (name, owner_id, created_at) VALUES (?,?,?)").run(name, ownerId, ts);
    return { name, ownerId, createdAt: ts };
  }

  getTopic(name: string): Topic | null {
    const row = this.db.prepare("SELECT * FROM topics WHERE name = ?").get(name) as Row;
    return row ? { name: row.name, ownerId: row.owner_id ?? null, createdAt: row.created_at } : null;
  }

  listTopics(): Topic[] {
    return (this.db.prepare("SELECT * FROM topics ORDER BY name").all() as Row[]).map((r) => ({
      name: r.name,
      ownerId: r.owner_id ?? null,
      createdAt: r.created_at,
    }));
  }

  // ---- groups ---------------------------------------------------------------

  createGroup(name: string, description: string | null, ownerId: string | null): Group {
    const id = uid("grp");
    const ts = now();
    this.db
      .prepare("INSERT INTO groups (id, name, description, owner_id, created_at) VALUES (?,?,?,?,?)")
      .run(id, name, description, ownerId, ts);
    return { id, name, description, ownerId, createdAt: ts };
  }

  getGroup(id: string): Group | null {
    return mapGroup(this.db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as Row);
  }

  getGroupByName(name: string): Group | null {
    return mapGroup(this.db.prepare("SELECT * FROM groups WHERE name = ?").get(name) as Row);
  }

  listGroups(): Group[] {
    return (this.db.prepare("SELECT * FROM groups ORDER BY name").all() as Row[]).map((r) => mapGroup(r)!);
  }

  deleteGroup(id: string): void {
    this.db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  }

  addGroupMember(groupId: string, userId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, created_at) VALUES (?,?,?)")
      .run(groupId, userId, now());
  }

  removeGroupMember(groupId: string, userId: string): void {
    this.db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(groupId, userId);
  }

  listGroupMembers(groupId: string): User[] {
    return (
      this.db
        .prepare(
          "SELECT u.* FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.username",
        )
        .all(groupId) as Row[]
    ).map((r) => mapUser(r)!);
  }

  listGroupsForUser(userId: string): Group[] {
    return (
      this.db
        .prepare(
          "SELECT g.* FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = ? ORDER BY g.name",
        )
        .all(userId) as Row[]
    ).map((r) => mapGroup(r)!);
  }

  // ---- subscriptions --------------------------------------------------------

  upsertSubscription(
    userId: string,
    topic: string,
    channels: string[],
    minPriority: Priority,
  ): Subscription {
    const existing = this.db
      .prepare("SELECT * FROM subscriptions WHERE user_id = ? AND topic = ?")
      .get(userId, topic) as Row;
    const ts = now();
    const channelsStr = channels.join(",");
    if (existing) {
      this.db
        .prepare("UPDATE subscriptions SET channels = ?, min_priority = ? WHERE id = ?")
        .run(channelsStr, minPriority, existing.id);
      return mapSubscription({ ...existing, channels: channelsStr, min_priority: minPriority })!;
    }
    const id = uid("sub");
    this.db
      .prepare(
        "INSERT INTO subscriptions (id, user_id, topic, channels, min_priority, created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, userId, topic, channelsStr, minPriority, ts);
    return { id, userId, topic, channels, minPriority, createdAt: ts };
  }

  listSubscriptionsForTopic(topic: string): Subscription[] {
    return (this.db.prepare("SELECT * FROM subscriptions WHERE topic = ?").all(topic) as Row[]).map(
      (r) => mapSubscription(r)!,
    );
  }

  listSubscriptionsForUser(userId: string): Subscription[] {
    return (
      this.db.prepare("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at").all(userId) as Row[]
    ).map((r) => mapSubscription(r)!);
  }

  deleteSubscription(userId: string, topic: string): void {
    this.db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND topic = ?").run(userId, topic);
  }

  // ---- attachments ----------------------------------------------------------

  createAttachment(a: Omit<Attachment, "id">): Attachment {
    const id = uid("att");
    this.db
      .prepare(
        "INSERT INTO attachments (id, filename, content_type, size, path, owner_id, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(id, a.filename, a.contentType, a.size, a.path, a.ownerId, a.createdAt, a.expiresAt);
    return { id, ...a };
  }

  getAttachment(id: string): Attachment | null {
    const row = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as Row;
    return mapAttachment(row);
  }

  pruneAttachments(before: number): Attachment[] {
    const rows = this.db.prepare("SELECT * FROM attachments WHERE expires_at < ?").all(before) as Row[];
    this.db.prepare("DELETE FROM attachments WHERE expires_at < ?").run(before);
    return rows.map((r) => mapAttachment(r)!);
  }

  // ---- messages -------------------------------------------------------------

  insertMessage(m: Message): Message {
    this.db
      .prepare(
        `INSERT INTO messages (id, topic, title, body, priority, tags, click, sender, attachment_id, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        m.id,
        m.topic,
        m.title,
        m.body,
        m.priority,
        m.tags.join(","),
        m.click,
        m.sender,
        m.attachmentId,
        m.createdAt,
        m.expiresAt,
      );
    return m;
  }

  listMessages(topic: string, since: number, limit = 100): Message[] {
    return (
      this.db
        .prepare("SELECT * FROM messages WHERE topic = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?")
        .all(topic, since, limit) as Row[]
    )
      .map((r) => mapMessage(r)!)
      .reverse();
  }

  pruneMessages(before: number): number {
    const info = this.db.prepare("DELETE FROM messages WHERE expires_at < ?").run(before);
    return info.changes;
  }

  // ---- webhooks -------------------------------------------------------------

  createWebhook(topic: string, url: string, secret: string | null): OutboundWebhook {
    const id = uid("wh");
    const ts = now();
    this.db
      .prepare("INSERT INTO webhooks (id, topic, url, secret, created_at) VALUES (?,?,?,?,?)")
      .run(id, topic, url, secret, ts);
    return { id, topic, url, secret, createdAt: ts };
  }

  listWebhooksForTopic(topic: string): OutboundWebhook[] {
    return (this.db.prepare("SELECT * FROM webhooks WHERE topic = ?").all(topic) as Row[]).map(
      (r) => mapWebhook(r)!,
    );
  }

  listAllWebhooks(): OutboundWebhook[] {
    return (this.db.prepare("SELECT * FROM webhooks ORDER BY created_at").all() as Row[]).map(
      (r) => mapWebhook(r)!,
    );
  }

  deleteWebhook(id: string): void {
    this.db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
  }

  // ---- tokens ---------------------------------------------------------------

  createToken(userId: string, tokenHash: string, label: string | null, scopes: string[]): ApiToken {
    const id = uid("tok");
    const ts = now();
    this.db
      .prepare("INSERT INTO tokens (id, token_hash, user_id, label, scopes, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, tokenHash, userId, label, scopes.join(","), ts);
    return { id, userId, label, scopes, createdAt: ts, lastUsedAt: null };
  }

  getTokenByHash(tokenHash: string): (ApiToken & { userId: string }) | null {
    const row = this.db.prepare("SELECT * FROM tokens WHERE token_hash = ?").get(tokenHash) as Row;
    return mapToken(row);
  }

  touchToken(id: string): void {
    this.db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(now(), id);
  }

  listTokensForUser(userId: string): ApiToken[] {
    return (this.db.prepare("SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at").all(userId) as Row[]).map(
      (r) => mapToken(r)!,
    );
  }

  deleteToken(id: string, userId: string): void {
    this.db.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?").run(id, userId);
  }

  // ---- bindings -------------------------------------------------------------

  createBinding(code: string, userId: string, botId: string | null, expiresAt: number): Binding {
    const ts = now();
    this.db
      .prepare(
        "INSERT INTO bindings (code, user_id, bot_id, status, created_at, expires_at) VALUES (?,?,?,?,?,?)",
      )
      .run(code, userId, botId, "pending", ts, expiresAt);
    return {
      code,
      userId,
      botId,
      status: "pending",
      channel: null,
      accountId: null,
      externalId: null,
      createdAt: ts,
      expiresAt,
    };
  }

  getBinding(code: string): Binding | null {
    const row = this.db.prepare("SELECT * FROM bindings WHERE code = ?").get(code) as Row;
    return mapBinding(row);
  }

  completeBinding(code: string, channel: string, accountId: string, externalId: string): void {
    this.db
      .prepare(
        "UPDATE bindings SET status = 'bound', channel = ?, account_id = ?, external_id = ? WHERE code = ?",
      )
      .run(channel, accountId, externalId, code);
  }

  // ---- deliveries -----------------------------------------------------------

  logDelivery(messageId: string, userId: string | null, channel: string, status: string, error?: string): void {
    this.db
      .prepare("INSERT INTO deliveries (id, message_id, user_id, channel, status, error, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(uid("dlv"), messageId, userId, channel, status, error ?? null, now());
  }
}

// ---- row mappers ------------------------------------------------------------

function mapUser(r: Row): User | null {
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role as Role, createdAt: r.created_at };
}

function mapIdentity(r: Row): Identity | null {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    botId: r.bot_id ?? null,
    channel: r.channel,
    accountId: r.account_id ?? "default",
    externalId: r.external_id,
    displayName: r.display_name ?? null,
    createdAt: r.created_at,
  };
}

function mapBot(r: Row): Bot | null {
  if (!r) return null;
  let creds: Record<string, unknown> = {};
  try {
    creds = JSON.parse(r.credentials_json ?? "{}");
  } catch {
    // ignore parse failure
  }
  return {
    id: r.id,
    userId: r.user_id,
    channel: r.channel,
    accountId: r.account_id,
    label: r.label ?? null,
    status: r.status as Bot["status"],
    credentials: creds,
    lastSeenAt: r.last_seen_at ?? null,
    createdAt: r.created_at,
  };
}

function mapGroup(r: Row): Group | null {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    ownerId: r.owner_id ?? null,
    createdAt: r.created_at,
  };
}

function mapSubscription(r: Row): Subscription | null {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    topic: r.topic,
    channels: r.channels ? String(r.channels).split(",").filter(Boolean) : [],
    minPriority: r.min_priority as Priority,
    createdAt: r.created_at,
  };
}

function mapAttachment(r: Row): Attachment | null {
  if (!r) return null;
  return {
    id: r.id,
    filename: r.filename,
    contentType: r.content_type,
    size: r.size,
    path: r.path,
    ownerId: r.owner_id ?? null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

function mapMessage(r: Row): Message | null {
  if (!r) return null;
  return {
    id: r.id,
    topic: r.topic,
    title: r.title ?? null,
    body: r.body ?? "",
    priority: r.priority as Priority,
    tags: r.tags ? String(r.tags).split(",").filter(Boolean) : [],
    click: r.click ?? null,
    sender: r.sender ?? null,
    attachmentId: r.attachment_id ?? null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

function mapWebhook(r: Row): OutboundWebhook | null {
  if (!r) return null;
  return { id: r.id, topic: r.topic, url: r.url, secret: r.secret ?? null, createdAt: r.created_at };
}

function mapToken(r: Row): (ApiToken & { userId: string }) | null {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    label: r.label ?? null,
    scopes: r.scopes ? String(r.scopes).split(",").filter(Boolean) : [],
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at ?? null,
  };
}

function mapBinding(r: Row): Binding | null {
  if (!r) return null;
  return {
    code: r.code,
    userId: r.user_id,
    botId: r.bot_id ?? null,
    status: r.status,
    channel: r.channel ?? null,
    accountId: r.account_id ?? null,
    externalId: r.external_id ?? null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}
