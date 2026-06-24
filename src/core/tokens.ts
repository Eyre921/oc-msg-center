import type { Store } from "../db/store.ts";
import type { ApiToken } from "../types.ts";
import { newToken } from "../util/ids.ts";
import { hashToken } from "../auth/crypto.ts";

/** Issues a fresh API token, stores only its hash, and returns the clear value once. */
export function issueToken(
  store: Store,
  userId: string,
  label: string | null,
  scopes: string[] = ["publish", "subscribe"],
): { token: string; record: ApiToken } {
  const token = newToken("tk");
  const record = store.createToken(userId, hashToken(token), label, scopes);
  return { token, record };
}
