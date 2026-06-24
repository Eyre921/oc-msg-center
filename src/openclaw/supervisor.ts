import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logger.ts";
import { exec } from "./exec.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Embedded openclaw gateway supervisor.
 *
 * - Ensures the QQ + WeChat plugins are installed (idempotent).
 * - Installs the msgcenter-forward skill that POSTs inbound events back
 *   to msg-center via loopback HTTP.
 * - Spawns `openclaw gateway start --foreground` and restarts it if it
 *   dies (capped exponential backoff so a permanent crash doesn't spin).
 */
export class OpenClawSupervisor {
  private child: ChildProcess | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restarts = 0;
  private stopped = false;

  constructor(
    private readonly opts: {
      log: Logger;
      msgcenterUrl: string;
      inboundToken: string;
      configDir: string;
      plugins?: string[];
    },
  ) {}

  async setup(): Promise<void> {
    mkdirSync(this.opts.configDir, { recursive: true });

    for (const plugin of this.opts.plugins ?? []) {
      try {
        this.opts.log.info({ plugin }, "ensuring openclaw plugin installed");
        await exec("openclaw", ["plugins", "install", plugin], { allowFailure: true, timeoutMs: 180_000 });
      } catch (err) {
        this.opts.log.warn({ plugin, err: (err as Error).message }, "plugin install failed (continuing)");
      }
    }

    this.installForwardSkill();
  }

  start(): void {
    if (this.child || this.stopped) return;
    this.opts.log.info("spawning openclaw gateway");
    const child = spawn("openclaw", ["gateway", "start", "--foreground"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        OC_MSGCENTER_INBOUND_URL: this.opts.msgcenterUrl,
        OC_MSGCENTER_INBOUND_TOKEN: this.opts.inboundToken,
      },
    });
    child.stdout?.on("data", (c) => this.opts.log.info({ src: "openclaw" }, c.toString().trimEnd()));
    child.stderr?.on("data", (c) => this.opts.log.warn({ src: "openclaw" }, c.toString().trimEnd()));
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopped) return;
      this.opts.log.warn({ code, signal }, "openclaw gateway exited; scheduling restart");
      const delayMs = Math.min(30_000, 1000 * Math.pow(2, this.restarts));
      this.restarts++;
      this.restartTimer = setTimeout(() => this.start(), delayMs);
    });
    this.child = child;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (!this.child) return;
    return new Promise<void>((resolve) => {
      this.child!.on("close", () => resolve());
      this.child!.kill("SIGTERM");
      setTimeout(() => this.child?.kill("SIGKILL"), 5000);
    });
  }

  /** Restart gateway after a credential change. */
  async restart(): Promise<void> {
    if (this.child) {
      this.opts.log.info("restarting openclaw gateway");
      this.child.kill("SIGTERM");
      // exit handler schedules the restart
    } else {
      this.start();
    }
  }

  private installForwardSkill(): void {
    const skillDir = path.join(this.opts.configDir, "skills", "msgcenter-forward");
    mkdirSync(skillDir, { recursive: true });
    const skillSrc = path.join(__dirname, "forward-skill.cjs");
    const skillDst = path.join(skillDir, "index.cjs");
    let content: string;
    try {
      content = readFileSync(skillSrc, "utf8");
    } catch {
      // bundled file missing (dev mode); generate inline
      content = INLINE_FORWARD_SKILL;
    }
    writeFileSync(skillDst, content);
    writeFileSync(
      path.join(skillDir, "openclaw.skill.json"),
      JSON.stringify({ id: "msgcenter-forward", name: "MsgCenter Forward", entry: "index.cjs" }, null, 2),
    );
    if (!existsSync(skillDst)) throw new Error("failed to install forward skill");
  }
}

// Fallback if the file-based skill is missing (e.g. dev runs from src/).
const INLINE_FORWARD_SKILL = `
// msgcenter-forward — POSTs every inbound channel message to msg-center.
const url = process.env.OC_MSGCENTER_INBOUND_URL || "http://127.0.0.1:2586";
const token = process.env.OC_MSGCENTER_INBOUND_TOKEN || "";
module.exports = {
  id: "msgcenter-forward",
  name: "MsgCenter Forward",
  register(api) {
    const hook = api?.runtime?.onChannelMessage || api?.onMessage;
    if (!hook) {
      console.warn("[msgcenter-forward] no message hook on runtime");
      return;
    }
    hook(async (msg) => {
      const channel = msg?.channel?.id || msg?.channelId || "unknown";
      try {
        await fetch(url + "/api/v1/channels/" + channel + "/inbound", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: "Bearer " + token } : {}),
          },
          body: JSON.stringify({
            accountId: msg.accountId || msg.account || "default",
            externalId: msg.from?.externalId || msg.from?.id || msg.userId,
            displayName: msg.from?.displayName || msg.from?.name || null,
            text: msg.text || msg.content || null,
            attachmentId: msg.attachmentId || null,
            raw: msg,
          }),
        });
      } catch (err) {
        console.warn("[msgcenter-forward] forward failed:", err.message);
      }
    });
  },
};
`;
