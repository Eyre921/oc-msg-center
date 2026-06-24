import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { exec } from "./exec.ts";
import type { Logger } from "../logger.ts";

/**
 * Derive the openclaw-weixin accountId from an exported token.
 * Token looks like "b8c3fc06889d@im.bot:06000032...". openclaw normalizes the
 * prefix (before ':') by replacing @ and . with '-', e.g. "b8c3fc06889d-im-bot".
 */
export function weixinAccountIdFromToken(token: string): string {
  const prefix = token.split(":")[0] ?? token;
  return prefix.replace(/[@.]/g, "-").replace(/[^a-zA-Z0-9_-]/g, "-");
}

export interface WeixinSession {
  token: string;
  baseUrl?: string;
  userId?: string;
}

/**
 * Inject a previously-exported WeChat session directly onto disk so the gateway
 * connects WITHOUT a fresh QR scan. Mirrors what openclaw-weixin's
 * saveWeixinAccount + the account index do:
 *   <state>/openclaw-weixin/accounts/<accountId>.json   (credentials)
 *   <state>/openclaw-weixin/accounts.json               (id index array)
 */
export async function injectWeixinSession(
  configDir: string,
  accountId: string,
  session: WeixinSession,
  log: Logger,
): Promise<void> {
  const dir = path.join(configDir, "openclaw-weixin", "accounts");
  mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${accountId}.json`);
  const data = {
    token: session.token,
    savedAt: new Date().toISOString(),
    ...(session.baseUrl ? { baseUrl: session.baseUrl } : {}),
    ...(session.userId ? { userId: session.userId } : {}),
  };
  writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  try {
    chmodSync(file, 0o600);
  } catch {
    // best-effort
  }

  // Register the id in the index, otherwise listIndexedWeixinAccountIds() is
  // empty and the account is never discovered.
  const indexFile = path.join(configDir, "openclaw-weixin", "accounts.json");
  let ids: string[] = [];
  if (existsSync(indexFile)) {
    try {
      const parsed = JSON.parse(readFileSync(indexFile, "utf-8"));
      if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === "string");
    } catch {
      ids = [];
    }
  }
  if (!ids.includes(accountId)) ids.push(accountId);
  writeFileSync(indexFile, JSON.stringify(ids), "utf-8");

  // Make sure the channel is enabled in openclaw.json.
  await exec("openclaw", ["config", "set", "channels.openclaw-weixin.enabled", "true"], {
    allowFailure: true,
    timeoutMs: 20_000,
  }).catch(() => {});

  log.info({ accountId }, "injected exported WeChat session (no QR needed)");
}
