import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { App } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

describe("oc-msg-center smoke", () => {
  let app: App;
  let baseUrl: string;
  let adminToken: string;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "msgcenter-"));

  beforeAll(async () => {
    process.env.MSGCENTER_DATA_DIR = tmp;
    process.env.MSGCENTER_PORT = "0";
    process.env.MSGCENTER_ADMIN_PASSWORD = "test-pw";
    process.env.MSGCENTER_ADMIN_TOKEN = "test-token";
    process.env.MSGCENTER_CHANNELS = JSON.stringify([
      { id: "console", label: "Console", type: "console", enabled: true },
    ]);
    process.env.MSGCENTER_LOG_LEVEL = "warn";
    const cfg = loadConfig();
    app = new App(cfg);
    await app.start();
    const addr = app.server!.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    adminToken = "test-token";
  });

  afterAll(async () => {
    await app.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("serves /healthz", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { channels: string[] };
    expect(body.channels).toContain("console");
  });

  it("admin can create a user, then add a bot for them", async () => {
    const userRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ username: "alice" }),
    });
    expect(userRes.ok).toBe(true);
    const alice = (await userRes.json()) as { id: string; username: string };
    expect(alice.username).toBe("alice");

    const botRes = await fetch(`${baseUrl}/api/v1/bots`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        userId: alice.id,
        channel: "console",
        accountId: "alice-console",
        label: "Alice's console bot",
        credentials: { token: "doesnt-matter" },
      }),
    });
    expect(botRes.ok).toBe(true);
    const bot = (await botRes.json()) as { id: string; status: string; provisioning?: boolean };
    // Provisioning is async now: the create call returns immediately as pending.
    expect(bot.status).toBe("pending");
    expect(bot.provisioning).toBe(true);
    // The console channel has nothing to provision, so it flips to active shortly.
    let status = "pending";
    for (let i = 0; i < 20 && status !== "active"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const list = (await (
        await fetch(`${baseUrl}/api/v1/bots`, { headers: { authorization: `Bearer ${adminToken}` } })
      ).json()) as { bots: { id: string; status: string }[] };
      status = list.bots.find((b) => b.id === bot.id)?.status ?? "pending";
    }
    expect(status).toBe("active");
  });

  it("binding flow: create code, simulate inbound, deliver message via bot", async () => {
    const user = (await (
      await fetch(`${baseUrl}/api/v1/users`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ username: "bob" }),
      })
    ).json()) as { id: string };

    const bot = (await (
      await fetch(`${baseUrl}/api/v1/bots`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          channel: "console",
          accountId: "bob-console",
          credentials: {},
        }),
      })
    ).json()) as { id: string };

    const binding = (await (
      await fetch(`${baseUrl}/api/v1/bindings`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, botId: bot.id }),
      })
    ).json()) as { code: string };

    const inbound = await fetch(`${baseUrl}/api/v1/channels/console/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: "bob-console",
        externalId: "bob-openid-1234",
        displayName: "Bob",
        text: `BIND ${binding.code}`,
      }),
    });
    expect(inbound.ok).toBe(true);
    const inboundData = (await inbound.json()) as { action: string; userId: string };
    expect(inboundData.action).toBe("bound");
    expect(inboundData.userId).toBe(user.id);

    // Subscribe Bob and publish — the console adapter should be called.
    await fetch(`${baseUrl}/api/v1/subscriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: user.id, topic: "ops" }),
    });
    const pub = await fetch(`${baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ topic: "ops", body: "hello bob" }),
    });
    expect(pub.ok).toBe(true);
  });

  it("agent endpoint: openclaw-style chat completion streams a reply", async () => {
    // Create a user + console bot, pre-bind an identity so the endpoint can
    // skip the openclaw `directory peers` lookup.
    const user = (await (
      await fetch(`${baseUrl}/api/v1/users`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ username: "carol" }),
      })
    ).json()) as { id: string };
    const bot = (await (
      await fetch(`${baseUrl}/api/v1/bots`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, channel: "console", accountId: "carol-console", credentials: {} }),
      })
    ).json()) as { id: string };
    app.store.upsertIdentity(user.id, "console", "carol-console", "carol-openid", "Carol", bot.id);

    // Simulate openclaw posting an inbound "/whoami" as an OpenAI chat completion.
    const res = await fetch(`${baseUrl}/v1/acct/console/carol-console/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${app.agentToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "msgcenter",
        stream: true,
        messages: [{ role: "user", content: "[console Carol 12:00] Carol: /whoami" }],
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
    // The reply should contain the username (from /whoami).
    expect(text).toContain("carol");
  });

  it("agent endpoint rejects a bad token", async () => {
    const res = await fetch(`${baseUrl}/v1/acct/console/carol-console/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("ntfy-style POST /:topic accepts raw bodies", async () => {
    const res = await fetch(`${baseUrl}/disk-alerts`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-title": "test" },
      body: "disk full",
    });
    expect(res.ok).toBe(true);
    const m = (await res.json()) as { topic: string; body: string };
    expect(m.topic).toBe("disk-alerts");
    expect(m.body).toBe("disk full");
  });
});
