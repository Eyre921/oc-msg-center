import Fastify, { type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";
import { Store } from "./db/store.ts";
import { ChannelRegistry } from "./channels/registry.ts";
import { StreamHub } from "./core/stream.ts";
import { Attachments } from "./core/attachments.ts";
import { WebhookDispatcher } from "./core/webhooks.ts";
import { Publisher } from "./core/publish.ts";
import { Commands } from "./core/commands.ts";
import { Inbound } from "./core/inbound.ts";
import { Pruner } from "./core/pruner.ts";
import { ensureAdmin } from "./bootstrap.ts";
import { registerPublishRoutes } from "./http/publish.ts";
import { registerStreamRoutes } from "./http/stream.ts";
import { registerFileRoutes } from "./http/files.ts";
import { registerBindRoutes } from "./http/bind.ts";
import { registerInboundRoutes } from "./http/inbound.ts";
import { registerAdminRoutes } from "./http/admin.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Top-level wiring. Holds every long-lived collaborator. */
export class App {
  readonly log: Logger;
  readonly store: Store;
  readonly registry: ChannelRegistry;
  readonly stream: StreamHub;
  readonly attachments: Attachments;
  readonly webhooks: WebhookDispatcher;
  readonly publisher: Publisher;
  readonly commands: Commands;
  readonly inbound: Inbound;
  readonly pruner: Pruner;
  server: FastifyInstance | null = null;

  constructor(readonly cfg: Config) {
    this.log = createLogger(cfg.logLevel);
    this.store = new Store(cfg.dbPath);
    ensureAdmin(cfg, this.store, this.log);
    this.registry = new ChannelRegistry(cfg.channels, this.log);
    this.stream = new StreamHub();
    this.attachments = new Attachments(cfg, this.store);
    this.webhooks = new WebhookDispatcher(this.store, this.log);
    this.publisher = new Publisher(
      cfg,
      this.store,
      this.registry,
      this.stream,
      this.webhooks,
      this.attachments,
      this.log,
    );
    this.commands = new Commands(cfg, this.store);
    this.inbound = new Inbound(cfg, this.store, this.commands, this.publisher, this.log);
    this.pruner = new Pruner(this.store, this.attachments, this.log);
  }

  async start(): Promise<void> {
    const server = Fastify({
      logger: this.log,
      bodyLimit: this.cfg.attachmentMaxBytes + 1024 * 1024,
    });
    (server as unknown as { msg: App }).msg = this;

    await server.register(fastifyCors, { origin: true, credentials: true });
    await server.register(fastifyWebsocket);
    await server.register(fastifyMultipart, {
      limits: { fileSize: this.cfg.attachmentMaxBytes },
    });

    // Accept text/* bodies as raw strings (ntfy-style POST /:topic).
    server.addContentTypeParser(/^text\/.*/, { parseAs: "string" }, (_req, body, done) => done(null, body));
    server.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) =>
      done(null, body),
    );

    server.get("/healthz", async () => ({
      ok: true,
      channels: this.registry.ids(),
      users: this.store.countUsers(),
    }));

    registerPublishRoutes(server);
    registerStreamRoutes(server);
    registerFileRoutes(server);
    registerBindRoutes(server);
    registerInboundRoutes(server);
    registerAdminRoutes(server);

    const webDir = path.resolve(__dirname, "../web");
    await server.register(fastifyStatic, { root: webDir, prefix: "/", index: ["index.html"] });

    this.server = server;
    this.pruner.start();
    await server.listen({ host: this.cfg.host, port: this.cfg.port });
    this.log.info(
      {
        url: this.cfg.baseUrl,
        channels: this.registry.ids(),
      },
      "oc-msg-center listening",
    );
  }

  async stop(): Promise<void> {
    this.pruner.stop();
    await this.server?.close();
    this.store.close();
  }
}
