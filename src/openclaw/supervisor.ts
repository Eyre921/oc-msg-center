import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { Logger } from "../logger.ts";
import { exec } from "./exec.ts";

/**
 * Embedded openclaw gateway supervisor.
 *
 * - Ensures the QQ + WeChat plugins are installed (idempotent).
 * - Ensures `gateway.mode=local` is set, otherwise `gateway run` refuses to
 *   start ("Gateway start blocked: existing config is missing gateway.mode").
 * - Runs `openclaw gateway run` (the FOREGROUND command — `gateway start` is
 *   the systemd/launchd service installer and does NOT work inside a container;
 *   `--foreground` is not a real flag) and restarts it if it dies (capped
 *   exponential backoff so a permanent crash doesn't spin).
 *
 * Inbound routing is NOT done here: openclaw delivers inbound messages to an
 * agent, and msg-center configures itself as that agent (an OpenAI-compatible
 * endpoint) per account at provision time. See openclaw/provision.ts.
 */
export class OpenClawSupervisor {
  private child: ChildProcess | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private restarts = 0;
  private stopped = false;

  constructor(
    private readonly opts: {
      log: Logger;
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

    // The gateway refuses to run without an explicit local mode.
    await exec("openclaw", ["config", "set", "gateway.mode", "local"], {
      allowFailure: true,
      timeoutMs: 30_000,
    }).catch(() => {});
  }

  /** Snapshot of the embedded gateway process for the status dashboard. */
  status(): { enabled: boolean; running: boolean; pid: number | null; restarts: number } {
    return {
      enabled: true,
      running: this.child != null && !this.child.killed,
      pid: this.child?.pid ?? null,
      restarts: this.restarts,
    };
  }

  start(): void {
    if (this.child || this.stopped) return;
    this.opts.log.info("spawning openclaw gateway (gateway run)");
    const child = spawn("openclaw", ["gateway", "run"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
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
    // A clean start resets the backoff after it has stayed up a while.
    setTimeout(() => {
      if (this.child === child) this.restarts = 0;
    }, 30_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!this.child) return;
    return new Promise<void>((resolve) => {
      this.child!.on("close", () => resolve());
      this.child!.kill("SIGTERM");
      setTimeout(() => this.child?.kill("SIGKILL"), 5000);
    });
  }

  /**
   * Restart the gateway to pick up a config change. Debounced: rapid calls
   * (e.g. adding several bots) collapse into one restart so we don't thrash
   * every account's connection.
   */
  restart(): void {
    if (this.stopped) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.child) {
        this.opts.log.info("restarting openclaw gateway to apply config");
        this.child.kill("SIGTERM"); // exit handler restarts it
      } else {
        this.start();
      }
    }, 1500);
  }
}
