import type { Config } from "../config.ts";
import type { Store } from "../db/store.ts";
import type { Logger } from "../logger.ts";
import type { InboundEvent } from "../channels/types.ts";
import type { Commands } from "./commands.ts";
import type { Publisher } from "./publish.ts";
import { now } from "../util/time.ts";

export interface InboundResult {
  userId?: string;
  reply?: string;
  action: "bound" | "registered" | "command" | "message" | "ignored";
}

/**
 * Inbound router. With the per-user bot fleet model the identity lookup is
 * scoped by (channel, accountId, externalId): the bot account itself is the
 * primary signal of who the sender is, since each colleague has their OWN bot.
 */
export class Inbound {
  constructor(
    private readonly cfg: Config,
    private readonly store: Store,
    private readonly commands: Commands,
    private readonly publisher: Publisher,
    private readonly log: Logger,
  ) {}

  async handle(evt: InboundEvent): Promise<InboundResult> {
    const text = (evt.text ?? "").trim();
    let identity = this.store.getIdentity(evt.channel, evt.accountId, evt.externalId);
    const bot = this.store.getBotByAccount(evt.channel, evt.accountId);
    if (bot) this.store.updateBotStatus(bot.id, "active");

    // 1) Binding code completes a pending bind.
    const code = this.extractBindingCode(text);
    if (code) {
      const binding = this.store.getBinding(code);
      if (binding && binding.status === "pending" && binding.expiresAt > now()) {
        if (binding.botId && bot && binding.botId !== bot.id) {
          // Code was issued for a specific bot; ignore inbound on the wrong bot.
          return { action: "ignored", reply: "绑定码与当前机器人不匹配。" };
        }
        this.store.completeBinding(code, evt.channel, evt.accountId, evt.externalId);
        this.store.upsertIdentity(
          binding.userId,
          evt.channel,
          evt.accountId,
          evt.externalId,
          evt.displayName ?? null,
          binding.botId ?? bot?.id ?? null,
        );
        const user = this.store.getUser(binding.userId);
        this.log.info(
          { channel: evt.channel, account: evt.accountId, user: binding.userId },
          "identity bound via code",
        );
        return { userId: binding.userId, reply: this.welcome(user?.username), action: "bound" };
      }
    }

    // 2) Unknown sender on a known bot → bind to the bot's owner automatically.
    //    (A personal bot has exactly one expected user — the colleague who owns it.)
    if (!identity && bot) {
      identity = this.store.upsertIdentity(
        bot.userId,
        evt.channel,
        evt.accountId,
        evt.externalId,
        evt.displayName ?? null,
        bot.id,
      );
      const user = this.store.getUser(bot.userId);
      this.log.info({ channel: evt.channel, account: evt.accountId, user: bot.userId }, "auto-bound personal bot");
      return { userId: bot.userId, reply: this.welcome(user?.username), action: "bound" };
    }

    // 3) Unknown bot AND unknown identity → auto-register only if allowed.
    if (!identity) {
      if (!this.cfg.channelAutoRegister) {
        return { action: "ignored", reply: "未知机器人或未注册用户。请联系管理员获取绑定码。" };
      }
      const user = this.registerNewUser(evt);
      identity = this.store.upsertIdentity(
        user.id,
        evt.channel,
        evt.accountId,
        evt.externalId,
        evt.displayName ?? null,
      );
      return { userId: user.id, reply: this.welcome(user.username), action: "registered" };
    }

    const user = this.store.getUser(identity.userId);
    if (!user) return { action: "ignored" };

    if (text && this.commands.isCommand(text)) {
      const reply = await this.commands.handle(user, evt.channel, text);
      return { userId: user.id, reply, action: "command" };
    }

    // Reverse message / file → republish to the user's inbox topic.
    const topic = `${this.cfg.inboxTopicPrefix}${user.id}`;
    await this.publisher.publish({
      topic,
      title: `来自 ${evt.displayName ?? user.username} 的消息`,
      body: text,
      sender: evt.displayName ?? user.username,
      attachmentId: evt.attachmentId ?? null,
      tags: ["inbound", evt.channel],
    });
    return { userId: user.id, action: "message", reply: this.cfg.inboundAck || undefined };
  }

  private welcome(username?: string): string {
    const name = username ? `${username}，` : "";
    return `${name}${this.cfg.welcomeMessage}`;
  }

  private registerNewUser(evt: InboundEvent) {
    const base = sanitizeUsername(evt.displayName) || `${evt.channel}-${evt.externalId.slice(0, 8)}`;
    let username = base;
    let i = 1;
    while (this.store.getUserByUsername(username)) username = `${base}-${i++}`;
    return this.store.createUser(username, null, "user");
  }

  private extractBindingCode(text: string): string | null {
    if (!text) return null;
    const cleaned = text.replace(/^\s*(绑定|bind)\s*/i, "");
    const m = cleaned.toUpperCase().match(/\b[0-9A-HJ-NP-TV-Z]{8}\b/);
    return m ? m[0] : null;
  }
}

function sanitizeUsername(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.trim().replace(/[^\w一-龥.\-]+/g, "_").slice(0, 32);
  return s || null;
}
