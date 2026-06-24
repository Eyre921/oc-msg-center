import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { newToken } from "../util/ids.ts";
import type { Logger } from "../logger.ts";

/**
 * The internal token msg-center uses as the apiKey for the openclaw model
 * provider, and which the agent endpoint requires on inbound. Stable across
 * restarts so we don't have to re-provision every bot.
 */
export function resolveAgentToken(dataDir: string, log: Logger): string {
  const fromEnv = process.env.MSGCENTER_AGENT_TOKEN;
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, "agent-token");
  if (existsSync(file)) {
    try {
      const t = readFileSync(file, "utf8").trim();
      if (t) return t;
    } catch {
      // fall through to regenerate
    }
  }
  const token = newToken("ocagent");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, token, { mode: 0o600 });
  log.info("generated internal agent token (stored in data dir)");
  return token;
}
