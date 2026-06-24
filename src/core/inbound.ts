import type { Config } from "../config.ts";
import type { Store } from "../db/store.ts";
import type { Logger } from "../logger.ts";
import type { InboundEvent } from "../channels/types.ts";
import type { Commands } from "./commands.ts";
import type { Publisher } from "./publish.ts";
import { now } from "../util/time.ts";

export interface InboundResult {
  /** Resolved user id, if the sender is/became known. */
  userId?: string;
  /** A reply the bridge should deliver back to the sender, if any. */
  reply?: string;
  /** What the center did with the event. */
  action: "bound" | "registered" | "command" | "message" | "ignored";
}

/** Routes inbound (reverse) channel events: binding, auto-register, commands, messages. */
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
    let identity = this.store.getIdentity(evt.channel, evt.externalId);

    // 1) A pending binding code completes a binding regardless of current state.
    const code = this.extractBindingCode(text);
    if (code) {
      const binding = this.store.getBinding(code);
      if (binding && binding.status === "pending" && binding.expiresAt > now()) {
        this.store.completeBinding(code, evt.channel, evt.externalId);
        this.store.upsertIdentity(binding.userId, evt.channel, evt.externalId, evt.displayName ?? null);
        const user = this.store.getUser(binding.userId);
        this.log.info({ channel: evt.channel, user: binding.userId }, "identity bound via code");
        return { userId: binding.userId, reply: this.welcome(user?.username), action: "bound" };
      }
    }

    // 2) Unknown sender → auto-register (if enabled).
    if (!identity) {
      if (!this.cfg.channelAutoRegister) {
        return { action: "ignored", reply: "你尚未注册到消息中心，请联系管理员获取绑定码。" };
      }
      const user = this.registerNewUser(evt);
      identity = this.store.upsertIdentity(user.id, evt.channel, evt.externalId, evt.displayName ?? null);
      this.log.info({ channel: evt.channel, user: user.id }, "auto-registered identity");
      return { userId: user.id, reply: this.welcome(user.username), action: "registered" };
    }

    const user = this.store.getUser(identity.userId);
    if (!user) return { action: "ignored" };

    // 3) Known sender + slash command → informational reply.
    if (text && this.commands.isCommand(text)) {
      const reply = await this.commands.handle(user, evt.channel, text);
      return { userId: user.id, reply, action: "command" };
    }

    // 4) Otherwise it is a reverse message/file → republish to the user's inbox topic.
    const topic = `${this.cfg.inboxTopicPrefix}${user.id}`;
    await this.publisher.publish({
      topic,
      title: `来自 ${evt.displayName ?? user.username} 的消息`,
      body: text,
      sender: evt.displayName ?? user.username,
      attachmentId: evt.attachmentId ?? null,
      tags: ["inbound", evt.channel],
    });
    return { userId: user.id, action: "message" };
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
    // strip a leading keyword like "绑定" / "bind"
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
