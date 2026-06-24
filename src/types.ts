/** Domain model shared across the message center. */

export type Priority = 1 | 2 | 3 | 4 | 5; // 1=min .. 3=default .. 5=max (ntfy-compatible)

export type Role = "admin" | "user";

export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt: number;
}

/** A bound external identity (a QQ openid or WeChat user id, etc.). */
export interface Identity {
  id: string;
  userId: string;
  channel: string; // channel id, e.g. "qqbot"
  externalId: string; // the per-channel user id used as a send target
  displayName: string | null;
  createdAt: number;
}

export interface Topic {
  name: string;
  ownerId: string | null;
  createdAt: number;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  createdAt: number;
}

export interface Subscription {
  id: string;
  userId: string;
  topic: string;
  /** Which channels to deliver to. Empty array = all bound channels + web. */
  channels: string[];
  /** Only deliver messages at or above this priority. */
  minPriority: Priority;
  createdAt: number;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** Absolute path on disk. */
  path: string;
  ownerId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface Message {
  id: string;
  topic: string;
  title: string | null;
  body: string;
  priority: Priority;
  tags: string[];
  /** Optional click-through URL. */
  click: string | null;
  /** Display name / id of the sender. */
  sender: string | null;
  attachmentId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface OutboundWebhook {
  id: string;
  topic: string;
  url: string;
  secret: string | null;
  createdAt: number;
}

export interface ApiToken {
  id: string;
  userId: string;
  label: string | null;
  /** "publish" | "subscribe" | "admin" — comma-joined in storage. */
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
}

export interface Binding {
  code: string;
  userId: string;
  status: "pending" | "bound" | "expired";
  channel: string | null;
  externalId: string | null;
  createdAt: number;
  expiresAt: number;
}

/** A resolved principal for an authenticated request. */
export interface Principal {
  userId: string;
  username: string;
  role: Role;
  scopes: string[];
  /** True for the env bootstrap admin token. */
  isBootstrapAdmin?: boolean;
}
