import type { FastifyInstance } from "fastify";
import { getApp } from "./helpers.ts";

/** SSE + WebSocket fan-out endpoints. */
export function registerStreamRoutes(server: FastifyInstance): void {
  // GET /:topic/sse  → text/event-stream
  server.get("/:topic/sse", async (req, reply) => {
    const { topic } = req.params as { topic: string };
    const app = getApp(req);
    const raw = reply.raw;

    raw.statusCode = 200;
    raw.setHeader("content-type", "text/event-stream");
    raw.setHeader("cache-control", "no-cache, no-transform");
    raw.setHeader("connection", "keep-alive");
    raw.setHeader("x-accel-buffering", "no");
    raw.write(":ok\n\n");

    const heartbeat = setInterval(() => {
      try {
        raw.write(":ping\n\n");
      } catch {
        // closed
      }
    }, 25_000);

    const unsubscribe = app.stream.subscribe([topic], (msg) => {
      try {
        raw.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      } catch {
        // closed
      }
    });

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      try {
        raw.end();
      } catch {
        // already closed
      }
    });
    // Detach Fastify reply: we control the response stream.
    return reply.hijack();
  });

  // GET /:topic/json  → newline-delimited json (curl-friendly)
  server.get("/:topic/json", async (req, reply) => {
    const { topic } = req.params as { topic: string };
    const app = getApp(req);
    const raw = reply.raw;
    raw.statusCode = 200;
    raw.setHeader("content-type", "application/x-ndjson");
    raw.setHeader("cache-control", "no-cache, no-transform");
    const unsubscribe = app.stream.subscribe([topic], (msg) => {
      try {
        raw.write(JSON.stringify(msg) + "\n");
      } catch {
        // closed
      }
    });
    req.raw.on("close", () => {
      unsubscribe();
      try {
        raw.end();
      } catch {
        // already closed
      }
    });
    return reply.hijack();
  });

  // WebSocket subscribe: /:topic/ws
  server.get("/:topic/ws", { websocket: true } as never, (socket, req) => {
    const { topic } = req.params as { topic: string };
    const app = getApp(req);
    const unsubscribe = app.stream.subscribe([topic], (msg) => {
      try {
        socket.send(JSON.stringify(msg));
      } catch {
        // socket closed
      }
    });
    socket.on("close", () => unsubscribe());
  });
}
