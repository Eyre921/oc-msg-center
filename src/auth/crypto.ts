import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

/** Hash a password with scrypt: returns "scrypt$salt$hash" (all hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Stable hash used to index API tokens without storing them in clear. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
