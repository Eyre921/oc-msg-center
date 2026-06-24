import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { Bot } from "../types.ts";

/**
 * Bot control plane: msg-center pushes / revokes per-user bot accounts on the
 * bridge sidecar. The bridge in turn calls `openclaw channels add --account …`
 * (or its WeChat-flavored equivalent).
 *
 * Contract:
 *   POST   <controlUrl>/bots            { accountId, label?, credentials }
 *   DELETE <controlUrl>/bots/:accountId
 */
export class BotControl {
  constructor(
    private readonly cfg: Config,
    private readonly log: Logger,
  ) {}

  async provision(bot: Bot): Promise<{ ok: boolean; error?: string }> {
    const cc = this.cfg.channels.find((c) => c.id === bot.channel);
    if (!cc?.controlUrl) {
      // No control plane configured — assume the bridge was hand-provisioned.
      return { ok: true };
    }
    try {
      const res = await fetch(cc.controlUrl.replace(/\/+$/, "") + "/bots", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cc.sendToken ? { authorization: `Bearer ${cc.sendToken}` } : {}),
        },
        body: JSON.stringify({
          accountId: bot.accountId,
          label: bot.label,
          credentials: bot.credentials,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `bridge returned ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (err) {
      this.log.warn({ channel: bot.channel, err: (err as Error).message }, "bot provision failed");
      return { ok: false, error: (err as Error).message };
    }
  }

  async revoke(channel: string, accountId: string): Promise<{ ok: boolean; error?: string }> {
    const cc = this.cfg.channels.find((c) => c.id === channel);
    if (!cc?.controlUrl) return { ok: true };
    try {
      const res = await fetch(
        cc.controlUrl.replace(/\/+$/, "") + "/bots/" + encodeURIComponent(accountId),
        {
          method: "DELETE",
          headers: cc.sendToken ? { authorization: `Bearer ${cc.sendToken}` } : {},
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `bridge returned ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
