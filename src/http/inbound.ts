import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getApp, handleError } from "./helpers.ts";

const InboundBody = z.object({
  accountId: z.string().min(1).default("default"),
  externalId: z.string().min(1),
  displayName: z.string().nullish(),
  text: z.string().nullish(),
  attachmentId: z.string().nullish(),
  raw: z.record(z.any()).optional(),
});

/**
 * The contract every channel bridge must POST against to deliver an inbound
 * (reverse) event from QQ / WeChat to the message center.
 *
 *   POST /api/v1/channels/:id/inbound
 *   Authorization: Bearer <inboundToken>  (per-channel, configured in MSGCENTER_CHANNELS)
 *   Body: { externalId, displayName?, text?, attachmentId?, raw? }
 *
 * Returns: { reply?: string }   — the bridge SHOULD send `reply` back to the
 * sender on the same channel if present (welcome message / command result).
 */
export function registerInboundRoutes(server: FastifyInstance): void {
  server.post("/api/v1/channels/:id/inbound", async (req, reply) => {
    try {
      const app = getApp(req);
      const { id } = req.params as { id: string };
      const channelCfg = app.cfg.channels.find((c) => c.id === id);
      if (!channelCfg) return reply.code(404).send({ error: `unknown channel ${id}` });

      // Authenticate the bridge.
      if (channelCfg.inboundToken) {
        const auth = (req.headers["authorization"] as string) ?? "";
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m || m[1].trim() !== channelCfg.inboundToken) {
          return reply.code(401).send({ error: "invalid inbound token" });
        }
      }

      const body = InboundBody.parse(req.body ?? {});
      const result = await app.inbound.handle({
        channel: id,
        accountId: body.accountId,
        externalId: body.externalId,
        displayName: body.displayName ?? null,
        text: body.text ?? null,
        attachmentId: body.attachmentId ?? null,
        raw: body.raw,
      });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
