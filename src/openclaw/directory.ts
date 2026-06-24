import { exec } from "./exec.ts";
import type { Logger } from "../logger.ts";

export interface Peer {
  id: string;
  name: string | null;
}

/**
 * List the contacts/users that have interacted with a given account, via
 * `openclaw directory peers list`. For a personal bot this is normally just
 * the owner. Used to resolve the openid we need as an outbound send target.
 */
export async function listPeers(openclawChannel: string, accountId: string, log: Logger): Promise<Peer[]> {
  try {
    const r = await exec(
      "openclaw",
      ["directory", "peers", "list", "--channel", openclawChannel, "--account", accountId, "--json"],
      { allowFailure: true, timeoutMs: 20_000 },
    );
    if (r.code !== 0 || !r.stdout) return [];
    const parsed = JSON.parse(r.stdout);
    const rows: unknown[] = Array.isArray(parsed) ? parsed : (parsed.peers ?? parsed.data ?? []);
    return rows
      .map((row) => {
        const o = row as Record<string, unknown>;
        const id = (o.id ?? o.peerId ?? o.openid ?? o.userId ?? o.user_id) as string | undefined;
        const name = (o.name ?? o.nickname ?? o.displayName ?? null) as string | null;
        return id ? { id: String(id), name: name ? String(name) : null } : null;
      })
      .filter((p): p is Peer => p !== null);
  } catch (err) {
    log.warn({ channel: openclawChannel, account: accountId, err: (err as Error).message }, "directory peers failed");
    return [];
  }
}
