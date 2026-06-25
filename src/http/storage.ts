import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminOnly, getApp, handleError } from "./helpers.ts";
import { now } from "../util/time.ts";
import type { AttachmentFilter } from "../db/store.ts";

/**
 * Storage administration. Files are kept forever by default; the admin reclaims
 * space here, manually, by any combination of rules (age, size, owner, type,
 * orphaned, or explicit ids). Every destructive call supports a dry run so the
 * admin can preview exactly what a rule would remove before committing.
 */

const RuleSchema = z.object({
  ownerId: z.string().optional(),
  type: z.enum(["image", "file"]).optional(),
  olderThanDays: z.number().min(0).optional(),
  minSizeMb: z.number().min(0).optional(),
  orphan: z.boolean().optional(),
  ids: z.array(z.string()).optional(),
  q: z.string().optional(),
  /** Delete EVERYTHING — required to run a cleanup with no other constraint. */
  all: z.boolean().optional(),
  /** Preview only: count + bytes that would be deleted, without deleting. */
  dryRun: z.boolean().optional(),
});

type Rule = z.infer<typeof RuleSchema>;

/** Translate human-friendly rule units (days, MB) into a store filter. */
function toFilter(rule: Rule, nowSec: number): AttachmentFilter {
  return {
    ownerId: rule.ownerId,
    type: rule.type,
    olderThan: rule.olderThanDays != null ? nowSec - Math.round(rule.olderThanDays * 86400) : undefined,
    minSize: rule.minSizeMb != null ? Math.floor(rule.minSizeMb * 1024 * 1024) : undefined,
    orphan: rule.orphan,
    ids: rule.ids,
    q: rule.q,
  };
}

/** Does this rule constrain the deletion at all? Guards against accidental delete-all. */
function hasConstraint(rule: Rule): boolean {
  return Boolean(
    rule.ownerId ||
      rule.type ||
      rule.olderThanDays != null ||
      rule.minSizeMb != null ||
      rule.orphan ||
      (rule.ids && rule.ids.length) ||
      rule.q,
  );
}

export function registerStorageRoutes(server: FastifyInstance): void {
  // Aggregate usage for the dashboard cards.
  server.get("/api/v1/storage/stats", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const stats = app.store.storageStats();
      return reply.send({
        ...stats,
        config: {
          attachmentsDir: app.cfg.attachmentsDir,
          attachmentMaxBytes: app.cfg.attachmentMaxBytes,
          // 0 = files are kept forever (manual cleanup only).
          attachmentTtlSeconds: app.cfg.attachmentTtlSeconds,
        },
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Filtered, paginated attachment list for the management table.
  server.get("/api/v1/storage/attachments", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const q = req.query as Record<string, string>;
      const rule: Rule = {
        ownerId: q.ownerId || undefined,
        type: q.type === "image" || q.type === "file" ? q.type : undefined,
        olderThanDays: q.olderThanDays ? Number(q.olderThanDays) : undefined,
        minSizeMb: q.minSizeMb ? Number(q.minSizeMb) : undefined,
        orphan: q.orphan === "true" ? true : undefined,
        q: q.q || undefined,
      };
      const filter = toFilter(rule, now());
      const limit = Math.min(500, Number(q.limit) || 100);
      const offset = Math.max(0, Number(q.offset) || 0);
      const rows = app.store.listAttachments(filter, limit, offset);
      const totals = app.store.countAttachments(filter);
      const names = new Map<string, string>();
      const items = rows.map((a) => {
        let ownerName: string | null = null;
        if (a.ownerId) {
          ownerName = names.get(a.ownerId) ?? app.store.getUser(a.ownerId)?.username ?? null;
          if (ownerName) names.set(a.ownerId, ownerName);
        }
        return {
          id: a.id,
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          ownerId: a.ownerId,
          ownerName,
          referenced: a.referenced,
          createdAt: a.createdAt,
          expiresAt: a.expiresAt,
          url: app.attachments.url(a),
        };
      });
      return reply.send({ items, total: totals.count, bytes: totals.bytes, limit, offset });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Rule-based cleanup with a dry-run preview.
  server.post("/api/v1/storage/cleanup", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const rule = RuleSchema.parse(req.body ?? {});
      if (!hasConstraint(rule) && !rule.all) {
        return reply.code(400).send({
          error: "refusing to delete with no rule — pass a constraint, or set all:true to wipe everything",
        });
      }
      const filter = toFilter(rule, now());
      if (rule.dryRun) {
        const preview = app.store.countAttachments(filter);
        return reply.send({ dryRun: true, count: preview.count, bytes: preview.bytes });
      }
      const result = app.attachments.cleanup(filter);
      app.log.info({ count: result.count, bytes: result.bytes, rule }, "storage cleanup");
      return reply.send({ dryRun: false, deleted: result.count, bytes: result.bytes });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // Delete a single attachment.
  server.delete("/api/v1/storage/attachments/:id", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const { id } = req.params as { id: string };
      const result = app.attachments.cleanup({ ids: [id] });
      if (result.count === 0) return reply.code(404).send({ error: "not found" });
      return reply.send({ deleted: result.count, bytes: result.bytes });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
