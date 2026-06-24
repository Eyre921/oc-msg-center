import { mkdirSync, createWriteStream, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import type { Config } from "../config.ts";
import type { Store } from "../db/store.ts";
import type { Attachment } from "../types.ts";
import { uid } from "../util/ids.ts";
import { now } from "../util/time.ts";

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
    return this.store.createAttachment({
      filename: safeName,
      contentType: contentType || "application/octet-stream",
      size,
      path: diskPath,
      ownerId,
      createdAt: ts,
      expiresAt: ts + this.cfg.attachmentTtlSeconds,
    });
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
