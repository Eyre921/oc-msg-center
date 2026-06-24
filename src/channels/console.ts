import type { ChannelAdapter, ChannelTarget, DeliveryResult, OutboundMessage } from "./types.ts";
import type { Logger } from "../logger.ts";

/** A no-op adapter that logs deliveries. Useful for local development. */
export class ConsoleChannel implements ChannelAdapter {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly log: Logger,
  ) {}

  async send(target: ChannelTarget, message: OutboundMessage): Promise<DeliveryResult> {
    this.log.info(
      { channel: this.id, to: target.externalId, title: message.title, body: message.body },
      "[console channel] would deliver message",
    );
    return { ok: true };
  }
}
