import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getApp } from "./helpers.ts";
import { listPeers } from "../openclaw/directory.ts";
import { uid } from "../util/ids.ts";
import { extractInbound, type ChatMessage, type ExtractedInbound } from "../core/inbound-media.ts";

interface ChatBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
}

/**
 * OpenAI-compatible agent endpoint. openclaw routes each personal bot's inbound
 * messages here (configured at provision time). Because the URL carries
 * (channelId, accountId) and every bot belongs to exactly one colleague, we
 * know WHO is talking without parsing anything — the bot's owner.
 *
 *   POST /v1/acct/:channel/:accountId/chat/completions
 *   Authorization: Bearer <agentToken>
 */
export function registerAgentRoutes(server: FastifyInstance): void {
  server.post("/v1/acct/:channel/:accountId/chat/completions", (req, reply) =>
    handleChat(req, reply, true),
  );
  // Fallback for an account-less provider config.
  server.post("/v1/chat/completions", (req, reply) => handleChat(req, reply, false));
}

async function handleChat(req: FastifyRequest, reply: FastifyReply, scoped: boolean) {
  const app = getApp(req);
  const log = app.log;

  // Auth: the provider apiKey we configured == app.agentToken.
  const auth = (req.headers["authorization"] as string) ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!app.agentToken || token !== app.agentToken) {
    return reply.code(401).send({ error: { message: "invalid agent token", type: "auth" } });
  }

  const body = (req.body ?? {}) as ChatBody;
  const wantStream = body.stream !== false;
  const extracted = extractInbound(body.messages ?? []);

  let replyText = "";
  try {
    if (scoped) {
      const { channel, accountId } = req.params as { channel: string; accountId: string };
      replyText = await routeInbound(app, channel, accountId, extracted);
    } else {
      log.warn("agent hit /v1/chat/completions without account scope; cannot attribute sender");
      replyText = "";
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, "agent inbound failed");
    replyText = "";
  }

  return wantStream
    ? streamCompletion(reply, replyText, body.model ?? "msgcenter")
    : jsonCompletion(reply, replyText, body.model ?? "msgcenter");
}

/** Resolve the sender, auto-bind, run command/reverse logic, return the reply. */
async function routeInbound(
  app: ReturnType<typeof getApp>,
  channelId: string,
  accountId: string,
  inbound: ExtractedInbound,
): Promise<string> {
  const text = inbound.text;
  const bot = app.store.getBotByAccount(channelId, accountId);
  if (!bot) {
    app.log.warn({ channelId, accountId }, "agent inbound for unknown bot");
    return "";
  }
  app.store.updateBotStatus(bot.id, "active");

  // Resolve the openid we need as an outbound target. Cache on the identity.
  let identity = app.store.getIdentityForBot(bot.id);
  let justBound = false;
  if (!identity || !identity.externalId) {
    const cc = app.cfg.channels.find((c) => c.id === channelId);
    const openclawChannel = cc?.openclawChannel ?? channelId;
    const peers = await listPeers(openclawChannel, accountId, app.log);
    const openid = peers[0]?.id;
    if (openid) {
      const isNew = !identity;
      identity = app.store.upsertIdentity(
        bot.userId,
        channelId,
        accountId,
        openid,
        peers[0]?.name ?? null,
        bot.id,
      );
      justBound = isNew;
      app.log.info({ channelId, accountId, user: bot.userId }, "auto-bound personal bot via agent path");
    }
  }

  const user = app.store.getUser(bot.userId);
  if (!user) return "";

  // First time we've seen this colleague on this bot → greet them.
  if (justBound) {
    const name = user.username ? `${user.username}，` : "";
    return `${name}${app.cfg.welcomeMessage}`;
  }

  // Download any files/images the colleague sent into permanent storage. Every
  // inbound file is kept on the server; the first one is linked to the inbox
  // message (the rest remain available in the storage admin).
  const attachmentIds: string[] = [];
  for (const ref of inbound.media) {
    const att = await app.attachments.ingestRef(ref, user.id);
    if (att) attachmentIds.push(att.id);
    else app.log.warn({ channelId, accountId, ref: ref.slice(0, 48) }, "inbound media ingest failed");
  }
  if (attachmentIds.length) {
    app.log.info({ user: user.id, count: attachmentIds.length }, "captured inbound media");
  }

  // Strip openclaw's envelope header to recover what the colleague actually typed.
  let cleanText = stripEnvelope(text);
  if (!cleanText && attachmentIds.length) {
    cleanText = attachmentIds.length > 1 ? `[收到 ${attachmentIds.length} 个文件]` : "[收到 1 个文件]";
  } else if (attachmentIds.length > 1) {
    cleanText = `${cleanText}\n[共 ${attachmentIds.length} 个文件]`;
  }

  const result = await app.inbound.handle({
    channel: channelId,
    accountId,
    externalId: identity?.externalId ?? `${channelId}:${accountId}`,
    displayName: identity?.displayName ?? user.username,
    text: cleanText,
    attachmentId: attachmentIds[0] ?? null,
  });
  return result.reply ?? "";
}

/**
 * openclaw wraps inbound text in an "envelope" before handing it to the agent.
 * Two shapes seen in the wild:
 *   - simple:  `[channel from ts] Sender: <body>`
 *   - rich:    a leading ```json {chat metadata}``` block, an optional
 *              "Sender (untrusted metadata):" ```json {...}``` block, then the
 *              user's actual message as the trailing text.
 * Recover just the user's message for command/bind detection and a clean
 * inbox. Best-effort; if nothing is left we return the input unchanged.
 */
function stripEnvelope(text: string): string {
  let t = text.trim();
  // Rich envelope: drop fenced ```...``` blocks and metadata labels, keep the rest.
  if (t.includes("```") || /untrusted metadata/i.test(t)) {
    const cleaned = t
      .replace(/```[\s\S]*?```/g, "") // remove all fenced code/JSON blocks
      .replace(/^.*untrusted metadata.*$/gim, "") // remove the metadata label line
      .replace(/^\s*\[[^\]]*\]\s*/, "") // leading [channel from ts] if present
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (cleaned) return cleaned;
  }
  // Simple envelope.
  t = t.replace(/^\[[^\]]*\]\s*/, "");
  t = t.replace(/^[^:\n]{1,40}:\s*/, "");
  return t.trim();
}

function jsonCompletion(reply: FastifyReply, content: string, model: string) {
  return reply.send({
    id: `chatcmpl-${uid()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function streamCompletion(reply: FastifyReply, content: string, model: string) {
  const raw = reply.raw;
  raw.statusCode = 200;
  raw.setHeader("content-type", "text/event-stream");
  raw.setHeader("cache-control", "no-cache, no-transform");
  raw.setHeader("connection", "keep-alive");
  const id = `chatcmpl-${uid()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  raw.write(chunk({ role: "assistant" }, null));
  if (content) raw.write(chunk({ content }, null));
  raw.write(chunk({}, "stop"));
  raw.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })}\n\n`,
  );
  raw.write("data: [DONE]\n\n");
  raw.end();
  return reply.hijack();
}
