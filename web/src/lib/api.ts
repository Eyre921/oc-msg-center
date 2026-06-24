const TOKEN_KEY = "msg_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  opts: { raw?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (body !== undefined && !opts.raw) headers["content-type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : opts.raw ? (body as BodyInit) : JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error?.message ?? j.error ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : await res.text()) as T;
}

// ---- domain types (mirrors src/types.ts) ----
export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  identities: Identity[];
  bots: Bot[];
  groups: string[];
}
export interface Identity {
  id: string;
  channel: string;
  accountId: string;
  externalId: string;
  displayName: string | null;
}
export interface Bot {
  id: string;
  channel: string;
  accountId: string;
  label: string | null;
  status: "pending" | "active" | "disabled" | "error";
}
export interface Group {
  id: string;
  name: string;
  description: string | null;
  members: { id: string; username: string }[];
}
export interface Topic {
  name: string;
  createdAt: number;
  system: boolean;
  userSubscribers: number;
  groupSubscribers: number;
}
export interface Message {
  id: string;
  topic: string;
  title: string | null;
  body: string;
  priority: number;
  tags: string[];
  sender: string | null;
  createdAt: number;
  fromUser?: { id: string; username: string } | null;
  target?: { kind: "user" | "group" | "channel"; label: string };
}
export interface Channel {
  id: string;
  label: string;
}
export interface Webhook {
  id: string;
  topic: string;
  url: string;
  secret: string | null;
}
export interface ApiToken {
  id: string;
  label: string | null;
  scopes: string[];
  lastUsedAt: number | null;
}
