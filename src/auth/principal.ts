import type { FastifyRequest } from "fastify";
import type { Store } from "../db/store.ts";
import type { Config } from "../config.ts";
import type { Principal } from "../types.ts";
import { hashToken } from "./crypto.ts";

/** Pull a bearer token from Authorization or ?token=. */
export function extractToken(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  if (typeof q === "string" && q.length > 0) return q;
  return null;
}

/**
 * Resolve a Principal from the request, or null if anonymous.
 * Recognises:
 *   - the env bootstrap admin token (MSGCENTER_ADMIN_TOKEN)
 *   - api tokens stored in the database (by their sha256 hash)
 */
export function resolvePrincipal(req: FastifyRequest, cfg: Config, store: Store): Principal | null {
  const token = extractToken(req);
  if (!token) return null;

  if (cfg.adminToken && token === cfg.adminToken) {
    return {
      userId: "bootstrap-admin",
      username: cfg.adminUsername,
      role: "admin",
      scopes: ["publish", "subscribe", "admin"],
      isBootstrapAdmin: true,
    };
  }

  const record = store.getTokenByHash(hashToken(token));
  if (!record) return null;
  const user = store.getUser(record.userId);
  if (!user) return null;
  store.touchToken(record.id);
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    scopes: record.scopes,
  };
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requirePrincipal(req: FastifyRequest, cfg: Config, store: Store): Principal {
  const p = resolvePrincipal(req, cfg, store);
  if (!p) throw new AuthError(401, "authentication required");
  return p;
}

export function requireAdmin(req: FastifyRequest, cfg: Config, store: Store): Principal {
  const p = requirePrincipal(req, cfg, store);
  if (p.role !== "admin") throw new AuthError(403, "admin required");
  return p;
}

export function requireScope(p: Principal, scope: string): void {
  if (p.role === "admin" || p.isBootstrapAdmin) return;
  if (!p.scopes.includes(scope)) throw new AuthError(403, `scope "${scope}" required`);
}
