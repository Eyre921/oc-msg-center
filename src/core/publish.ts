import type { Config } from "../config.ts";
import type { Store } from "../db/store.ts";
import type { Logger } from "../logger.ts";
import type { ChannelRegistry } from "../channels/registry.ts";
import type { OutboundMessage } from "../channels/types.ts";
import type { Group, Message, Priority } from "../types.ts";
import type { StreamHub } from "./stream.ts";
import type { WebhookDispatcher } from "./webhooks.ts";
import type { Attachments } from "./attachments.ts";
import { uid } from "../util/ids.ts";
import { now, normalizeTopic } from "../util/time.ts";

export interface PublishInput {
  topic: string;
  body?: string;
  title?: string | null;
  priority?: Priority;
  tags?: string[];
  click?: string | null;
  sender?: string | null;
  attachmentId?: string | null;
  /** Force delivery to these channel ids only (overrides per-subscription prefs). */
  channels?: string[];
}

/** Stores a message, streams it to web subscribers, fans it out to channels and webhooks. */
export class Publisher {
  constructor(
    private readonly cfg: Config,
    private readonly store: Store,
    private readonly registry: ChannelRegistry,
    private readonly stream: StreamHub,
    private readonly webhooks: WebhookDispatcher,
    private readonly attachments: Attachments,
    private readonly log: Logger,
  ) {}

  /** Publish to a topic. Recipients = subscribers of that topic. */
  async publish(input: PublishInput, opts: { wait?: boolean } = {}): Promise<Message> {
    const topic = normalizeTopic(input.topic);
    this.store.ensureTopic(topic);
    const message = this.record(topic, input);

    const recipients = this.recipientsFromSubscriptions(topic, message.priority, input.channels);
    return this.fanout(message, recipients, opts);
  }

  /**
   * Publish to a group. Recipients = all members of the group, delivered to
   * every channel they have bound (subscription not required). Useful for ops
   * broadcasts like "page the on-call group".
   */
  async publishToGroup(
    group: Group,
    input: Omit<PublishInput, "topic"> & { topic?: string },
    opts: { wait?: boolean } = {},
  ): Promise<Message> {
    const topic = normalizeTopic(input.topic ?? `group-${group.name}`);
    this.store.ensureTopic(topic);
    const message = this.record(topic, { ...input, topic });

    const members = this.store.listGroupMembers(group.id);
    const recipients = members.map((m) => ({ userId: m.id, channels: input.channels ?? [] }));
    return this.fanout(message, recipients, opts);
  }

  private record(topic: string, input: PublishInput): Message {
    const ts = now();
    const ttl = this.cfg.messageTtlSeconds;
    const message: Message = {
      id: uid("msg"),
      topic,
      title: input.title ?? null,
      body: input.body ?? "",
      priority: input.priority ?? 3,
      tags: input.tags ?? [],
      click: input.click ?? null,
      sender: input.sender ?? null,
      attachmentId: input.attachmentId ?? null,
      createdAt: ts,
      // 0 = keep forever (admin cleans up manually).
      expiresAt: ttl > 0 ? ts + ttl : 0,
    };
    this.store.insertMessage(message);
    this.stream.publish(message);
    return message;
  }

  private async fanout(
    message: Message,
    recipients: Recipient[],
    opts: { wait?: boolean },
  ): Promise<Message> {
    const work = Promise.allSettled([
      this.deliverToRecipients(message, recipients),
      this.webhooks.dispatch(message),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") this.log.error({ err: r.reason }, "publish side-effect failed");
      }
    });
    if (opts.wait) await work;
    else void work;
    return message;
  }

  /** Publish to a single user. Recipients = just that user (all their bots). */
  async publishToUser(
    user: { id: string; username: string },
    input: Omit<PublishInput, "topic"> & { topic?: string },
    opts: { wait?: boolean } = {},
  ): Promise<Message> {
    const topic = normalizeTopic(input.topic ?? `dm-${user.id}`);
    this.store.ensureTopic(topic);
    const message = this.record(topic, { ...input, topic });
    return this.fanout(message, [{ userId: user.id, channels: input.channels ?? [] }], opts);
  }

  private recipientsFromSubscriptions(
    topic: string,
    priority: Priority,
    forcedChannels?: string[],
  ): Recipient[] {
    const out: Recipient[] = [];
    // Directly-subscribed users.
    for (const sub of this.store.listSubscriptionsForTopic(topic)) {
      if (priority < sub.minPriority) continue;
      out.push({ userId: sub.userId, channels: forcedChannels?.length ? forcedChannels : sub.channels });
    }
    // Whole groups subscribed to this topic — expand to current members.
    for (const gs of this.store.listGroupsForTopic(topic)) {
      if (priority < gs.minPriority) continue;
      for (const member of this.store.listGroupMembers(gs.groupId)) {
        out.push({ userId: member.id, channels: forcedChannels ?? [] });
      }
    }
    return out;
  }

  private toOutbound(message: Message): OutboundMessage {
    let attachment = null;
    if (message.attachmentId) {
      const att = this.attachments.get(message.attachmentId);
      if (att) {
        attachment = {
          id: att.id,
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          url: this.attachments.url(att),
        };
      }
    }
    return {
      id: message.id,
      topic: message.topic,
      title: message.title,
      body: message.body,
      priority: message.priority,
      tags: message.tags,
      click: message.click,
      attachment,
    };
  }

  private async deliverToRecipients(message: Message, recipients: Recipient[]): Promise<void> {
    if (recipients.length === 0) return;
    const outbound = this.toOutbound(message);

    // De-duplicate by user; collect channel filters per user.
    const merged = new Map<string, Set<string>>();
    for (const r of recipients) {
      const set = merged.get(r.userId) ?? new Set<string>();
      for (const c of r.channels ?? []) set.add(c);
      if (!r.channels || r.channels.length === 0) set.add("*");
      merged.set(r.userId, set);
    }

    const jobs: Promise<void>[] = [];
    for (const [userId, channelSet] of merged) {
      // Each user has a fleet of personal bots — one per channel they're reachable on.
      const bots = this.store.listBotsForUser(userId).filter((b) => b.status !== "disabled");
      if (bots.length === 0) continue;

      const all = channelSet.has("*");
      for (const bot of bots) {
        if (!all && !channelSet.has(bot.channel)) continue;
        const adapter = this.registry.get(bot.channel);
        if (!adapter) continue;
        const identity = this.store.getIdentityForBot(bot.id);
        if (!identity) continue; // bot exists but the colleague hasn't completed binding yet

        jobs.push(
          adapter
            .send(
              { channel: bot.channel, accountId: bot.accountId, externalId: identity.externalId },
              outbound,
            )
            .then((res) => {
              this.store.logDelivery(
                message.id,
                userId,
                `${bot.channel}/${bot.accountId}`,
                res.ok ? "delivered" : "failed",
                res.error,
              );
              if (!res.ok)
                this.log.warn(
                  { channel: bot.channel, account: bot.accountId, err: res.error },
                  "channel delivery failed",
                );
            })
            .catch((err) => {
              this.store.logDelivery(
                message.id,
                userId,
                `${bot.channel}/${bot.accountId}`,
                "failed",
                String(err),
              );
              this.log.error({ err: String(err) }, "channel delivery threw");
            }),
        );
      }
    }
    await Promise.allSettled(jobs);
  }
}

interface Recipient {
  userId: string;
  /** Channel ids; empty/undefined means "all channels the user has bound". */
  channels?: string[];
}
