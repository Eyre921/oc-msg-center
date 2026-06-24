import type { Priority } from "../types.ts";

/** A target for an outbound channel delivery. */
export interface ChannelTarget {
  /** Channel id, e.g. "qqbot". */
  channel: string;
  /** Which bot account on that channel to send through. */
  accountId: string;
  /** The per-(channel, account) recipient id (QQ openid, WeChat user id, ...). */
  externalId: string;
}

/** An attachment reference passed to a channel adapter. */
export interface OutboundAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** Public URL the bridge can download the file from. */
  url: string;
}

/** A normalised message handed to a channel adapter for delivery. */
export interface OutboundMessage {
  id: string;
  topic: string;
  title: string | null;
  body: string;
  priority: Priority;
  tags: string[];
  click: string | null;
  attachment: OutboundAttachment | null;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
  /** Channel-side message id, if returned. */
  remoteId?: string;
}

/**
 * An inbound event coming back from a channel (reverse messaging).
 * Produced by the bridge POSTing to /api/v1/channels/:id/inbound.
 */
export interface InboundEvent {
  channel: string;
  /** Which bot account on that channel observed the event. */
  accountId: string;
  /** The per-(channel, account) sender id. */
  externalId: string;
  /** Optional display name of the sender. */
  displayName?: string | null;
  /** Plain text content, if any. */
  text?: string | null;
  /** Inbound attachment, already uploaded to the center (file id), if any. */
  attachmentId?: string | null;
  /** Free-form metadata from the bridge. */
  raw?: Record<string, unknown>;
}

/** A channel adapter delivers outbound messages and identifies itself. */
export interface ChannelAdapter {
  readonly id: string;
  readonly label: string;
  send(target: ChannelTarget, message: OutboundMessage): Promise<DeliveryResult>;
}
