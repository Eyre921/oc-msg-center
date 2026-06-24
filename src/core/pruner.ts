import type { Store } from "../db/store.ts";
import type { Attachments } from "./attachments.ts";
import type { Logger } from "../logger.ts";
import { now } from "../util/time.ts";

/** Periodically deletes expired messages and attachment files. */
export class Pruner {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly attachments: Attachments,
    private readonly log: Logger,
  ) {}

  start(intervalMs = 60 * 60 * 1000): void {
    if (this.timer) return;
    const tick = () => {
      try {
        const deletedMsgs = this.store.pruneMessages(now());
        const deletedAtts = this.attachments.prune();
        if (deletedMsgs || deletedAtts)
          this.log.info({ deletedMsgs, deletedAtts }, "pruner cleaned up expired records");
      } catch (err) {
        this.log.error({ err }, "pruner failed");
      }
    };
    tick();
    this.timer = setInterval(tick, intervalMs).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
