import type { Message } from "../types.ts";

export type StreamListener = (message: Message) => void;

/**
 * In-memory pub/sub for live web subscribers (SSE / WebSocket).
 * One process only — fine for a self-hosted ops notification center.
 */
export class StreamHub {
  private readonly topicListeners = new Map<string, Set<StreamListener>>();

  subscribe(topics: string[], listener: StreamListener): () => void {
    for (const t of topics) {
      let set = this.topicListeners.get(t);
      if (!set) {
        set = new Set();
        this.topicListeners.set(t, set);
      }
      set.add(listener);
    }
    return () => {
      for (const t of topics) {
        const set = this.topicListeners.get(t);
        if (set) {
          set.delete(listener);
          if (set.size === 0) this.topicListeners.delete(t);
        }
      }
    };
  }

  publish(message: Message): void {
    const set = this.topicListeners.get(message.topic);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(message);
      } catch {
        // a slow/broken listener must not break fan-out
      }
    }
  }

  subscriberCount(topic: string): number {
    return this.topicListeners.get(topic)?.size ?? 0;
  }
}
