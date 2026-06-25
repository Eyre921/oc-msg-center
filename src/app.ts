import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";
import { Store } from "./db/store.ts";
import { ChannelRegistry } from "./channels/registry.ts";
import { BotControl } from "./channels/control.ts";
import { OpenClawSupervisor } from "./openclaw/supervisor.ts";
import { resolveAgentToken } from "./openclaw/agent-token.ts";
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
import { registerBotRoutes } from "./http/bots.ts";
import { registerAgentRoutes } from "./http/agent.ts";
import { registerStorageRoutes } from "./http/storage.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Top-level wiring. Holds every long-lived collaborator. */
export class App {
  readonly log: Logger;
  readonly store: Store;
  readonly registry: ChannelRegistry;
  readonly supervisor: OpenClawSupervisor | null;
  readonly botControl: BotControl;
  /** Internal token openclaw presents (as provider apiKey) on the agent endpoint. */
  readonly agentToken: string;
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
    this.agentToken = resolveAgentToken(cfg.dataDir, this.log);
    const openclawConfigDir = process.env.HOME ? `${process.env.HOME}/.openclaw` : "/root/.openclaw";

    // If any channel is type "openclaw", spawn the embedded gateway. Inbound
    // is routed to msg-center's agent endpoint per account (configured at
    // provision time, see channels/control.ts + openclaw/provision.ts).
    if (this.registry.openclawConfigs.length > 0) {
      this.supervisor = new OpenClawSupervisor({
        log: this.log,
        configDir: openclawConfigDir,
        plugins: pluginsFor(this.registry.openclawConfigs.map((c) => c.openclawChannel!)),
      });
    } else {
      this.supervisor = null;
    }

    this.botControl = new BotControl(cfg, this.log, this.supervisor, {
      msgcenterPort: cfg.port,
      agentToken: this.agentToken,
      configDir: openclawConfigDir,
    });
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
    // Cast pino logger to the FastifyBaseLogger shape — fastify 5 expects a
    // msgPrefix property that older pino types don't expose. Behaviour is
    // unchanged; the cast just stops the inferred FastifyInstance from
    // diverging from the default-generic one our route registrars expect.
    const server = Fastify({
      loggerInstance: this.log as unknown as FastifyBaseLogger,
      bodyLimit: this.cfg.attachmentMaxBytes + 1024 * 1024,
    }) as unknown as FastifyInstance;
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
    registerBotRoutes(server);
    registerAgentRoutes(server);
    registerStorageRoutes(server);

    // Serve the built React app. Falls back to web/ (raw) if dist is absent
    // (e.g. running from source without a web build).
    const distDir = path.resolve(__dirname, "../web/dist");
    const webDir = existsSync(distDir) ? distDir : path.resolve(__dirname, "../web");
    await server.register(fastifyStatic, { root: webDir, prefix: "/", index: ["index.html"] });
    // SPA fallback: any non-API GET that isn't a static asset returns index.html.
    server.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/v1")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not found" });
    });

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

    if (this.supervisor) {
      try {
        await this.supervisor.setup();
        this.supervisor.start();
      } catch (err) {
        this.log.error({ err: (err as Error).message }, "openclaw supervisor setup failed");
      }
    }
  }

  async stop(): Promise<void> {
    this.pruner.stop();
    await this.supervisor?.stop();
    await this.server?.close();
    this.store.close();
  }
}

const PLUGIN_MAP: Record<string, string> = {
  qqbot: "@tencent-connect/openclaw-qqbot",
  "openclaw-weixin": "@tencent-weixin/openclaw-weixin",
};

function pluginsFor(openclawChannels: string[]): string[] {
  const out = new Set<string>();
  for (const c of openclawChannels) {
    const p = PLUGIN_MAP[c];
    if (p) out.add(p);
  }
  return [...out];
}
