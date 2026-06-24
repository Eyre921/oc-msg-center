import type { Config } from "./config.ts";
import type { Store } from "./db/store.ts";
import type { Logger } from "./logger.ts";
import { hashPassword } from "./auth/crypto.ts";
import { randomCode } from "./util/ids.ts";

/**
 * Make sure there is at least one admin user. If MSGCENTER_ADMIN_PASSWORD is
 * set, use it; otherwise generate a random one on first boot and log it.
 *
 * This is the *web login* admin. It is separate from MSGCENTER_ADMIN_TOKEN,
 * which is a bearer token for headless / CLI access.
 */
export function ensureAdmin(cfg: Config, store: Store, log: Logger): void {
  const username = cfg.adminUsername;
  const existing = store.getUserByUsername(username);
  if (existing && existing.role === "admin") {
    if (cfg.adminPassword) {
      store["db"]
        .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .run(hashPassword(cfg.adminPassword), existing.id);
    }
    return;
  }
  if (existing) {
    log.warn({ username }, "user exists but is not admin — leaving alone");
    return;
  }
  const password = cfg.adminPassword ?? randomCode(16);
  store.createUser(username, hashPassword(password), "admin");
  if (!cfg.adminPassword) {
    log.warn(
      { username, password },
      "no MSGCENTER_ADMIN_PASSWORD set — generated a random one. Save it now; it will not be shown again.",
    );
  }
}
