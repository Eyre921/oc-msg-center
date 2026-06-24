import type { ChannelConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { ChannelAdapter } from "./types.ts";
import { ConsoleChannel } from "./console.ts";
import { WebhookChannel } from "./webhook.ts";

/** Holds the configured channel adapters and looks them up by id. */
export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor(configs: ChannelConfig[], log: Logger) {
    for (const cfg of configs) {
      if (cfg.enabled === false) continue;
      try {
        const adapter =
          cfg.type === "console" ? new ConsoleChannel(cfg.id, cfg.label, log) : new WebhookChannel(cfg);
        this.adapters.set(adapter.id, adapter);
        log.info({ channel: cfg.id, type: cfg.type }, "channel registered");
      } catch (err) {
        log.error({ channel: cfg.id, err: (err as Error).message }, "failed to register channel");
      }
    }
  }

  get(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  list(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }
}
