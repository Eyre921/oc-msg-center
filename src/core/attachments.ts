import { mkdirSync, createWriteStream, createReadStream, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import type { Config } from "../config.ts";
import type { Store, AttachmentFilter } from "../db/store.ts";
import type { Attachment } from "../types.ts";
import { uid } from "../util/ids.ts";
import { now } from "../util/time.ts";
import { guessContentType, extForContentType } from "../util/mime.ts";

/** Stores uploaded files on local disk and tracks them in the database. */
export class Attachments {
  constructor(
    private readonly cfg: Config,
    private readonly store: Store,
  ) {
    mkdirSync(cfg.attachmentsDir, { recursive: true });
  }

  /** Persist a stream to disk and record it. Enforces the size limit. */
  async save(
    stream: Readable,
    filename: string,
    contentType: string,
    ownerId: string | null,
  ): Promise<Attachment> {
    const id = uid("att");
    const safeName = path.basename(filename || "file").replace(/[^\w.\-]+/g, "_") || "file";
    const diskPath = path.join(this.cfg.attachmentsDir, `${id}-${safeName}`);

    let size = 0;
    const limit = this.cfg.attachmentMaxBytes;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > limit) {
          cb(new Error(`attachment exceeds limit of ${limit} bytes`));
          return;
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(stream, counter, createWriteStream(diskPath));
    } catch (err) {
      if (existsSync(diskPath)) {
        try {
          rmSync(diskPath);
        } catch {
          // ignore cleanup failure
        }
      }
      throw err;
    }

    const ts = now();
    const ttl = this.cfg.attachmentTtlSeconds;
    return this.store.createAttachment({
      filename: safeName,
      contentType: contentType || "application/octet-stream",
      size,
      path: diskPath,
      ownerId,
      createdAt: ts,
      // 0 = keep forever (admin cleans up manually).
      expiresAt: ttl > 0 ? ts + ttl : 0,
    });
  }

  /**
   * Download an inbound media reference into permanent storage so every file a
   * user sends is kept on the server. Handles inline `data:` URIs, local file
   * paths (`file://` or absolute — openclaw downloads media onto the same disk
   * in the single-image deploy), and remote `http(s)` URLs. Returns null on any
   * failure (caller logs); never throws.
   */
  async ingestRef(ref: string, ownerId: string | null): Promise<Attachment | null> {
    try {
      const r = ref.trim();
      if (!r) return null;

      // Inline base64 (or url-encoded) data URI.
      if (r.startsWith("data:")) {
        const m = r.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
        if (!m) return null;
        const contentType = m[1] || "application/octet-stream";
        const buf = m[2]
          ? Buffer.from(m[3], "base64")
          : Buffer.from(decodeURIComponent(m[3]), "utf8");
        if (buf.length === 0) return null;
        const filename = `media-${uid().slice(-8)}${extForContentType(contentType)}`;
        return await this.save(Readable.from(buf), filename, contentType, ownerId);
      }

      // Local file on the shared filesystem.
      let filePath: string | null = null;
      if (r.startsWith("file://")) filePath = decodeURIComponent(new URL(r).pathname);
      else if (r.startsWith("/")) filePath = r;
      if (filePath) {
        if (!existsSync(filePath)) return null;
        const filename = path.basename(filePath) || "file";
        return await this.save(createReadStream(filePath), filename, guessContentType(filename), ownerId);
      }

      // Remote URL.
      if (r.startsWith("http://") || r.startsWith("https://")) {
        const res = await fetch(r);
        if (!res.ok || !res.body) return null;
        const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim() || guessContentType(r);
        const last = r.split(/[?#]/)[0].split("/").pop() || "";
        const filename = last && last.includes(".") ? last : `download-${uid().slice(-8)}${extForContentType(contentType)}`;
        return await this.save(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), filename, contentType, ownerId);
      }

      return null;
    } catch {
      return null;
    }
  }

  /** Delete every attachment matching a filter, unlinking the files. */
  cleanup(filter: AttachmentFilter): { count: number; bytes: number } {
    const removed = this.store.deleteAttachmentsByFilter(filter);
    let bytes = 0;
    for (const a of removed) {
      bytes += a.size;
      if (existsSync(a.path)) {
        try {
          rmSync(a.path);
        } catch {
          // ignore cleanup failure
        }
      }
    }
    return { count: removed.length, bytes };
  }

  get(id: string): Attachment | null {
    return this.store.getAttachment(id);
  }

  /** Build the public download URL for an attachment. */
  url(att: Attachment): string {
    return `${this.cfg.baseUrl}/file/${att.id}/${encodeURIComponent(att.filename)}`;
  }

  prune(): number {
    const expired = this.store.pruneAttachments(now());
    for (const a of expired) {
      if (existsSync(a.path)) {
        try {
          rmSync(a.path);
        } catch {
          // ignore
        }
      }
    }
    return expired.length;
  }
}
