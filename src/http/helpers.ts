import type { FastifyReply, FastifyRequest } from "fastify";
import type { App } from "../app.ts";
import { AuthError, requireAdmin, requirePrincipal, resolvePrincipal } from "../auth/principal.ts";

export function getApp(req: FastifyRequest): App {
  const app = (req.server as unknown as { msg?: App }).msg;
  if (!app) throw new Error("App is not attached to fastify");
  return app;
}

export function tryAuth(req: FastifyRequest) {
  const app = getApp(req);
  return resolvePrincipal(req, app.cfg, app.store);
}

export function auth(req: FastifyRequest) {
  const app = getApp(req);
  return requirePrincipal(req, app.cfg, app.store);
}

export function adminOnly(req: FastifyRequest) {
  const app = getApp(req);
  return requireAdmin(req, app.cfg, app.store);
}

export function handleError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof AuthError) return reply.code(err.status).send({ error: err.message });
  const e = err as Error;
  return reply.code(400).send({ error: e?.message ?? String(err) });
}
