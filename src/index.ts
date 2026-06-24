#!/usr/bin/env -S node --import=tsx
import { loadConfig } from "./config.ts";
import { App } from "./app.ts";

async function main() {
  const cfg = loadConfig();
  const app = new App(cfg);
  const shutdown = async (sig: string) => {
    app.log.info({ sig }, "shutting down");
    try {
      await app.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await app.start();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", err);
  process.exit(1);
});
