import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { auth, getApp, handleError } from "./helpers.ts";

/** Attachment upload and download endpoints. */
export function registerFileRoutes(server: FastifyInstance): void {
  // multipart upload — used by both the web UI and bridge plugins for inbound media.
  server.post("/api/v1/files", async (req, reply) => {
    try {
      const app = getApp(req);
      const principal = auth(req);
      const part = await (req as unknown as { file: () => Promise<any> }).file();
      if (!part) return reply.code(400).send({ error: "missing file part" });
      const att = await app.attachments.save(
        part.file,
        part.filename ?? "file",
        part.mimetype ?? "application/octet-stream",
        principal.userId,
      );
      return reply.send({
        id: att.id,
        filename: att.filename,
        size: att.size,
        contentType: att.contentType,
        url: app.attachments.url(att),
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // raw body upload (curl -d @file)
  server.post("/api/v1/files/raw", async (req, reply) => {
    try {
      const app = getApp(req);
      const principal = auth(req);
      const filename = (req.headers["x-filename"] as string) || "upload.bin";
      const contentType = (req.headers["content-type"] as string) || "application/octet-stream";
      const stream = req.raw;
      const att = await app.attachments.save(stream, filename, contentType, principal.userId);
      return reply.send({
        id: att.id,
        filename: att.filename,
        size: att.size,
        contentType: att.contentType,
        url: app.attachments.url(att),
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // public download — by id; filename in URL is cosmetic.
  server.get("/file/:id/:filename", async (req, reply) => {
    const { id } = req.params as { id: string; filename: string };
    const app = getApp(req);
    const att = app.attachments.get(id);
    if (!att) return reply.code(404).send({ error: "not found" });
    return reply
      .header("content-type", att.contentType)
      .header("content-disposition", `inline; filename="${encodeURIComponent(att.filename)}"`)
      .header("content-length", String(att.size))
      .send(createReadStream(att.path));
  });

  // also reachable by id only (used internally by bridges)
  server.get("/file/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const app = getApp(req);
    const att = app.attachments.get(id);
    if (!att) return reply.code(404).send({ error: "not found" });
    return reply
      .header("content-type", att.contentType)
      .header("content-disposition", `inline; filename="${encodeURIComponent(att.filename)}"`)
      .header("content-length", String(att.size))
      .send(createReadStream(att.path));
  });
}
