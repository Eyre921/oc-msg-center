import type { ChannelConfig } from "../config.ts";
import type { ChannelAdapter, ChannelTarget, DeliveryResult, OutboundMessage } from "./types.ts";

/**
 * Bridges to an OpenClaw channel plugin (or any bot) over HTTP.
 *
 * Outbound: POST { target, message } to `sendUrl`. The bridge translates this
 * into a plugin `message send` (text / image / file …) on QQ or WeChat.
 * See docs/BRIDGE.md for the exact contract.
 */
export class WebhookChannel implements ChannelAdapter {
  readonly id: string;
  readonly label: string;
  private readonly sendUrl: string;
  private readonly sendToken?: string;

  constructor(cfg: ChannelConfig) {
    if (!cfg.sendUrl) throw new Error(`channel "${cfg.id}" of type webhook requires sendUrl`);
    this.id = cfg.id;
    this.label = cfg.label;
    this.sendUrl = cfg.sendUrl;
    this.sendToken = cfg.sendToken;
  }

  async send(target: ChannelTarget, message: OutboundMessage): Promise<DeliveryResult> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.sendToken) headers["authorization"] = `Bearer ${this.sendToken}`;

    let res: Response;
    try {
      res = await fetch(this.sendUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ target, message }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return { ok: false, error: `bridge unreachable: ${(err as Error).message}` };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `bridge returned ${res.status}: ${text.slice(0, 200)}` };
    }
    let remoteId: string | undefined;
    try {
      const data = (await res.json()) as { id?: string; remoteId?: string };
      remoteId = data.remoteId ?? data.id;
    } catch {
      // body is optional
    }
    return { ok: true, remoteId };
  }
}
