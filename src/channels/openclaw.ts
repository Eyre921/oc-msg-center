import type { Logger } from "../logger.ts";
import { exec } from "../openclaw/exec.ts";
import type { ChannelAdapter, ChannelTarget, DeliveryResult, OutboundMessage } from "./types.ts";

/**
 * In-process channel that talks to an openclaw CLI installed in the SAME
 * container. No HTTP bridge sidecar; we just shell out to:
 *
 *   openclaw message send --channel <openclaw-channel> --account <accountId>
 *                         --target <openclaw-channel>:c2c:<externalId>
 *                         --message <body> [--image|--file <url>]
 */
export class OpenClawEmbeddedChannel implements ChannelAdapter {
  constructor(
    readonly id: string,
    readonly label: string,
    /** The channel id understood by `openclaw` itself (e.g. "qqbot" or "openclaw-weixin"). */
    private readonly openclawChannel: string,
    private readonly log: Logger,
  ) {}

  async send(target: ChannelTarget, message: OutboundMessage): Promise<DeliveryResult> {
    const text = [message.title, message.body].filter(Boolean).join("\n\n");
    const args = [
      "message",
      "send",
      "--channel",
      this.openclawChannel,
      "--account",
      target.accountId,
      "--target",
      `${this.openclawChannel}:c2c:${target.externalId}`,
    ];
    if (text) args.push("--message", text);
    if (message.attachment) {
      const flag = message.attachment.contentType.startsWith("image/") ? "--image" : "--file";
      args.push(flag, message.attachment.url);
    }
    try {
      const r = await exec("openclaw", args, { timeoutMs: 60_000 });
      return { ok: true, remoteId: r.stdout || undefined };
    } catch (err) {
      this.log.warn(
        { channel: this.id, account: target.accountId, err: (err as Error).message },
        "openclaw send failed",
      );
      return { ok: false, error: (err as Error).message };
    }
  }
}
