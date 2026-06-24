import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { Bot } from "../types.ts";
import type { OpenClawSupervisor } from "../openclaw/supervisor.ts";
import { exec } from "../openclaw/exec.ts";
import { spawn } from "node:child_process";

export interface ProvisionResult {
  ok: boolean;
  error?: string;
  /** For interactive flows (WeChat scan), an in-progress login session id. */
  sessionId?: string;
}

/**
 * Routes bot provisioning to the right backend. Two paths:
 *
 * - `openclaw` channels: shell out to the embedded `openclaw` CLI. QQ just
 *   runs `channels add --account --token "appId:secret"`. WeChat needs an
 *   interactive QR scan; we kick off a non-blocking login session and return
 *   the live ANSI/PNG QR to the UI (see WeChatLoginSessions).
 *
 * - `webhook` channels: POST to an external bridge's /bots endpoint.
 */
export class BotControl {
  readonly wechatLogins = new WeChatLoginSessions();

  constructor(
    private readonly cfg: Config,
    private readonly log: Logger,
    private readonly supervisor: OpenClawSupervisor | null,
  ) {}

  async provision(bot: Bot): Promise<ProvisionResult> {
    const cc = this.cfg.channels.find((c) => c.id === bot.channel);
    if (!cc) return { ok: false, error: `unknown channel ${bot.channel}` };

    if (cc.type === "openclaw") return this.provisionOpenclaw(bot, cc.openclawChannel ?? bot.channel);
    if (cc.type === "webhook") return this.provisionWebhook(bot, cc);
    return { ok: true }; // console / unknown — nothing to do
  }

  async revoke(channel: string, accountId: string): Promise<ProvisionResult> {
    const cc = this.cfg.channels.find((c) => c.id === channel);
    if (!cc) return { ok: true };

    if (cc.type === "openclaw") {
      const oc = cc.openclawChannel ?? channel;
      try {
        await exec("openclaw", ["channels", "remove", "--channel", oc, "--account", accountId], {
          allowFailure: true,
          timeoutMs: 30_000,
        });
        await this.supervisor?.restart();
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      return { ok: true };
    }
    if (cc.type === "webhook" && cc.controlUrl) {
      try {
        await fetch(cc.controlUrl.replace(/\/+$/, "") + "/bots/" + encodeURIComponent(accountId), {
          method: "DELETE",
          headers: cc.sendToken ? { authorization: `Bearer ${cc.sendToken}` } : {},
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    return { ok: true };
  }

  private async provisionOpenclaw(bot: Bot, openclawChannel: string): Promise<ProvisionResult> {
    // QQ: { appId, secret } → `channels add --token "appId:secret"`.
    if (openclawChannel === "qqbot" || bot.channel === "qqbot") {
      const appId = String(bot.credentials.appId ?? "");
      const secret = String(bot.credentials.secret ?? "");
      if (!appId || !secret) return { ok: false, error: "QQ bot requires credentials.appId and credentials.secret" };
      try {
        await exec("openclaw", [
          "channels",
          "add",
          "--channel",
          openclawChannel,
          "--account",
          bot.accountId,
          "--token",
          `${appId}:${secret}`,
        ], { timeoutMs: 30_000 });
        await this.supervisor?.restart();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    // WeChat: kick off a non-blocking QR login. UI polls /api/v1/bots/:id/qr until ready.
    if (openclawChannel.includes("weixin")) {
      const sessionId = this.wechatLogins.start(openclawChannel, bot, this.log);
      return { ok: true, sessionId };
    }

    return { ok: false, error: `don't know how to provision openclaw channel "${openclawChannel}"` };
  }

  private async provisionWebhook(bot: Bot, cc: { sendToken?: string; controlUrl?: string }): Promise<ProvisionResult> {
    if (!cc.controlUrl) return { ok: true };
    try {
      const res = await fetch(cc.controlUrl.replace(/\/+$/, "") + "/bots", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cc.sendToken ? { authorization: `Bearer ${cc.sendToken}` } : {}),
        },
        body: JSON.stringify({ accountId: bot.accountId, label: bot.label, credentials: bot.credentials }),
        signal: AbortSignal.timeout(20_000),
      });
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

/**
 * Tracks in-progress `openclaw channels login` invocations for WeChat. Each
 * session spawns a CLI subprocess and captures stdout (where openclaw prints
 * the QR as ANSI art). The web UI polls and renders that buffer until the
 * login completes.
 */
export class WeChatLoginSessions {
  private readonly sessions = new Map<string, WeChatSession>();

  start(openclawChannel: string, bot: Bot, log: Logger): string {
    const id = `${bot.channel}:${bot.accountId}`;
    const existing = this.sessions.get(id);
    if (existing && existing.status === "pending") return id;

    const sess: WeChatSession = { id, status: "pending", buffer: "", startedAt: Date.now() };
    this.sessions.set(id, sess);

    const child = spawn(
      "openclaw",
      ["channels", "login", "--channel", openclawChannel, "--account", bot.accountId],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (c) => {
      sess.buffer += c.toString();
    });
    child.stderr.on("data", (c) => {
      sess.buffer += c.toString();
    });
    child.on("close", (code) => {
      sess.status = code === 0 ? "ok" : "failed";
      sess.exitCode = code ?? -1;
      log.info({ accountId: bot.accountId, code }, "weixin login session ended");
    });
    sess.child = child;
    return id;
  }

  get(sessionId: string): WeChatSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  cancel(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s?.child) s.child.kill("SIGTERM");
    this.sessions.delete(sessionId);
  }
}

export interface WeChatSession {
  id: string;
  status: "pending" | "ok" | "failed";
  buffer: string;
  startedAt: number;
  exitCode?: number;
  child?: ReturnType<typeof spawn>;
}
