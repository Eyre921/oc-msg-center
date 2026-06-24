import { createHmac } from "node:crypto";
import type { Store } from "../db/store.ts";
import type { Logger } from "../logger.ts";
import type { Message } from "../types.ts";

/** Dispatches messages to per-topic outbound webhook URLs. */
export class WebhookDispatcher {
  constructor(
    private readonly store: Store,
    private readonly log: Logger,
  ) {}

  async dispatch(message: Message): Promise<void> {
    const hooks = this.store.listWebhooksForTopic(message.topic);
    if (hooks.length === 0) return;
    const payload = JSON.stringify({ event: "message", message });
    await Promise.all(
      hooks.map(async (hook) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-msgcenter-event": "message",
          "x-msgcenter-topic": message.topic,
        };
        if (hook.secret) {
          headers["x-msgcenter-signature"] =
            "sha256=" + createHmac("sha256", hook.secret).update(payload).digest("hex");
        }
        try {
          const res = await fetch(hook.url, {
            method: "POST",
            headers,
            body: payload,
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) {
            this.log.warn({ url: hook.url, status: res.status }, "outbound webhook non-2xx");
          }
        } catch (err) {
          this.log.warn({ url: hook.url, err: (err as Error).message }, "outbound webhook failed");
        }
      }),
    );
  }
}
