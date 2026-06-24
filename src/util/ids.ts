import { randomBytes, randomUUID } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford-ish base32, no ambiguous chars

/** Random base32 string of the given length. */
export function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** A globally unique id with an optional prefix, e.g. "msg_a1b2...". */
export function uid(prefix?: string): string {
  const id = randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id}` : id;
}

/** A url-safe opaque token, e.g. "tk_xxxxxxxx". */
export function newToken(prefix = "tk"): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}
