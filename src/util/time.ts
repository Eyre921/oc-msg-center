/** Current unix time in seconds. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Validate and normalise a topic name (ntfy-style: url-safe slug). */
export function normalizeTopic(name: string): string {
  const t = name.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t)) {
    throw new Error("Invalid topic: use 1-64 chars of [a-zA-Z0-9_-]");
  }
  return t;
}
