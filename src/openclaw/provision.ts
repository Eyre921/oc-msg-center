import { exec } from "./exec.ts";
import type { Logger } from "../logger.ts";

/**
 * Configure openclaw so that inbound on (openclawChannel, accountId) routes to
 * msg-center's OpenAI-compatible agent endpoint.
 *
 * We do this with three CLI calls (verified against openclaw 2026.6.x):
 *   1. config patch — register a per-account model provider whose baseUrl points
 *      at /v1/acct/<channel>/<accountId> so msg-center learns who's talking.
 *   2. agents add   — create an isolated agent using that provider's model and
 *      bind it to the channel:accountId.
 *   3. gateway restart — apply.
 */
export async function configureAccountAgent(opts: {
  /** msg-center channel id (e.g. "qqbot", "weixin") — used in the callback URL path. */
  channelId: string;
  /** channel id openclaw itself knows (e.g. "qqbot", "openclaw-weixin") — used for routing. */
  openclawChannel: string;
  accountId: string;
  msgcenterPort: number;
  agentToken: string;
  configDir: string;
  log: Logger;
}): Promise<void> {
  const providerKey = providerKeyFor(opts.channelId, opts.accountId);
  const agentId = agentIdFor(opts.channelId, opts.accountId);
  const baseUrl = `http://127.0.0.1:${opts.msgcenterPort}/v1/acct/${opts.channelId}/${opts.accountId}`;

  const patch = {
    models: {
      providers: {
        [providerKey]: {
          baseUrl,
          apiKey: opts.agentToken,
          models: [{ id: "msgcenter", name: "msgcenter", api: "openai-completions" }],
        },
      },
    },
  };
  await exec("openclaw", ["config", "patch", "--stdin"], { input: JSON.stringify(patch), timeoutMs: 30_000 });

  // agents add is idempotent-ish: if the agent exists it updates the binding.
  await exec(
    "openclaw",
    [
      "agents",
      "add",
      agentId,
      "--model",
      `${providerKey}/msgcenter`,
      "--bind",
      `${opts.openclawChannel}:${opts.accountId}`,
      "--workspace",
      `${opts.configDir}/agents/${agentId}/workspace`,
      "--non-interactive",
      "--json",
    ],
    { allowFailure: true, timeoutMs: 30_000 },
  ).catch((err) => opts.log.warn({ err: (err as Error).message }, "agents add reported an issue"));
}

export async function removeAccountAgent(opts: {
  channelId: string;
  accountId: string;
}): Promise<void> {
  const agentId = agentIdFor(opts.channelId, opts.accountId);
  await exec("openclaw", ["agents", "delete", agentId], { allowFailure: true, timeoutMs: 30_000 }).catch(
    () => {},
  );
  await exec(
    "openclaw",
    ["config", "unset", `models.providers.${providerKeyFor(opts.channelId, opts.accountId)}`],
    { allowFailure: true, timeoutMs: 15_000 },
  ).catch(() => {});
}

export function providerKeyFor(channel: string, accountId: string): string {
  return `oc-${channel}-${accountId}`.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

export function agentIdFor(channel: string, accountId: string): string {
  return `msgc-${channel}-${accountId}`.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}
