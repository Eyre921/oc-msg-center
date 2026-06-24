import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Configuration for a single delivery channel (a "bridge" to an OpenClaw
 * channel plugin such as openclaw-qqbot or openclaw-weixin, or any other
 * HTTP-reachable bot).
 *
 * The message center never speaks the QQ / WeChat wire protocol itself —
 * it delegates the hard parts (login, QR, media, send/receive) to the
 * existing plugins and talks to them over a small HTTP contract documented
 * in docs/BRIDGE.md.
 */
export interface ChannelConfig {
  /** Stable id, e.g. "qqbot" or "weixin". Used in target refs and inbound URLs. */
  id: string;
  /** Human label shown in the UI, e.g. "QQ" / "微信". */
  label: string;
  /** Adapter implementation. "webhook" bridges to a plugin; "console" just logs. */
  type: "webhook" | "console";
  /** Whether the channel is active. */
  enabled?: boolean;
  /** webhook: URL the center POSTs outbound messages to (the bridge's send endpoint). */
  sendUrl?: string;
  /** webhook: bearer token attached to outbound POSTs (authenticates center -> bridge). */
  sendToken?: string;
  /** webhook: bearer token the bridge must present on inbound POSTs (authenticates bridge -> center). */
  inboundToken?: string;
  /** webhook: URL the center POSTs to manage bot accounts (provision/revoke). Optional. */
  controlUrl?: string;
}

export interface Config {
  host: string;
  port: number;
  /** Public base URL, used to build QR links and attachment download URLs. */
  baseUrl: string;
  /** Directory that holds the sqlite database and uploaded attachments. */
  dataDir: string;
  dbPath: string;
  attachmentsDir: string;
  /** Bootstrap admin token. When set, requests bearing it act as a built-in admin. */
  adminToken: string | null;
  /** Seed admin account created on first boot (web login). */
  adminUsername: string;
  adminPassword: string | null;
  /** Allow anyone to self-register a web account. */
  openRegistration: boolean;
  /** Require a valid token to publish to a topic (ntfy "auth" behaviour). */
  authPublish: boolean;
  /** Max single attachment size in bytes. */
  attachmentMaxBytes: number;
  /** How long (seconds) stored messages are retained before pruning. */
  messageTtlSeconds: number;
  /** How long (seconds) attachments are retained before pruning. */
  attachmentTtlSeconds: number;
  /** How long (seconds) a QR binding code stays valid. */
  bindingTtlSeconds: number;
  /** Topic that inbound (reverse) messages are republished to, per user: prefix + userId. */
  inboxTopicPrefix: string;
  /** When an unknown identity first contacts the bot, auto-create a (pending) user. */
  channelAutoRegister: boolean;
  /** Message sent to a user right after they bind / register by scanning. */
  welcomeMessage: string;
  /** Delivery channels (bridges). */
  channels: ChannelConfig[];
  logLevel: string;
}

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function loadChannels(): ChannelConfig[] {
  // Channels can come from a JSON env var or a JSON file path.
  const inline = env("MSGCENTER_CHANNELS");
  const filePath = env("MSGCENTER_CHANNELS_FILE");
  let raw: string | undefined = inline;
  if (!raw && filePath && existsSync(filePath)) {
    raw = readFileSync(filePath, "utf8");
  }
  if (!raw) {
    // Default: a console channel so the server is useful out of the box.
    return [{ id: "console", label: "Console", type: "console", enabled: true }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`MSGCENTER_CHANNELS is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("MSGCENTER_CHANNELS must be a JSON array");
  return parsed.map((c, i) => {
    const ch = c as Partial<ChannelConfig>;
    if (!ch.id) throw new Error(`channel[${i}] is missing "id"`);
    return {
      id: ch.id,
      label: ch.label ?? ch.id,
      type: ch.type ?? "webhook",
      enabled: ch.enabled ?? true,
      sendUrl: ch.sendUrl,
      sendToken: ch.sendToken,
      inboundToken: ch.inboundToken,
      controlUrl: ch.controlUrl,
    };
  });
}

export function loadConfig(): Config {
  const dataDir = path.resolve(env("MSGCENTER_DATA_DIR", "./data")!);
  const port = envInt("MSGCENTER_PORT", envInt("PORT", 2586));
  const host = env("MSGCENTER_HOST", "0.0.0.0")!;
  const baseUrl = (env("MSGCENTER_BASE_URL", `http://localhost:${port}`)!).replace(/\/+$/, "");

  return {
    host,
    port,
    baseUrl,
    dataDir,
    dbPath: path.join(dataDir, "msgcenter.sqlite"),
    attachmentsDir: path.join(dataDir, "attachments"),
    adminToken: env("MSGCENTER_ADMIN_TOKEN") ?? null,
    adminUsername: env("MSGCENTER_ADMIN_USERNAME", "admin")!,
    adminPassword: env("MSGCENTER_ADMIN_PASSWORD") ?? null,
    openRegistration: envBool("MSGCENTER_OPEN_REGISTRATION", true),
    authPublish: envBool("MSGCENTER_AUTH_PUBLISH", false),
    attachmentMaxBytes: envInt("MSGCENTER_ATTACHMENT_MAX_BYTES", 100 * 1024 * 1024),
    messageTtlSeconds: envInt("MSGCENTER_MESSAGE_TTL_SECONDS", 12 * 60 * 60),
    attachmentTtlSeconds: envInt("MSGCENTER_ATTACHMENT_TTL_SECONDS", 3 * 24 * 60 * 60),
    bindingTtlSeconds: envInt("MSGCENTER_BINDING_TTL_SECONDS", 10 * 60),
    inboxTopicPrefix: env("MSGCENTER_INBOX_TOPIC_PREFIX", "inbox-")!,
    channelAutoRegister: envBool("MSGCENTER_CHANNEL_AUTO_REGISTER", true),
    welcomeMessage: env(
      "MSGCENTER_WELCOME_MESSAGE",
      "✅ 你已成功绑定消息中心。\n稍后管理员会把你加入相应的通知分组，之后即可在此接收推送消息。",
    )!,
    channels: loadChannels(),
    logLevel: env("MSGCENTER_LOG_LEVEL", "info")!,
  };
}
