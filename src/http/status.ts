import type { FastifyInstance } from "fastify";
import { adminOnly, getApp, handleError } from "./helpers.ts";
import { now } from "../util/time.ts";

/**
 * System status / health for the monitoring dashboard. Answers the operator's
 * first question — "why can't messages get through?" — by surfacing the
 * embedded openclaw gateway, every bot's live state, delivery success/failure,
 * and a derived self-check that names whatever is blocking send/receive.
 */
export function registerStatusRoutes(server: FastifyInstance): void {
  server.get("/api/v1/status", async (req, reply) => {
    try {
      adminOnly(req);
      const app = getApp(req);
      const store = app.store;

      const gateway = app.supervisor
        ? app.supervisor.status()
        : { enabled: false, running: false, pid: null, restarts: 0 };

      // Every bot, enriched with owner + whether a real identity is bound yet.
      const bots = store.listAllBots().map((b) => {
        const identity = store.getIdentityForBot(b.id);
        return {
          id: b.id,
          channel: b.channel,
          accountId: b.accountId,
          label: b.label,
          status: b.status,
          owner: store.getUser(b.userId)?.username ?? null,
          bound: Boolean(identity?.externalId),
          lastSeenAt: b.lastSeenAt,
        };
      });
      const activeBots = bots.filter((b) => b.status === "active").length;
      const boundBots = bots.filter((b) => b.bound).length;
      const erroredBots = bots.filter((b) => b.status === "error").length;

      const day = now() - 24 * 60 * 60;
      const deliveries = store.deliveryStats(day);
      const recentFailures = store.recentFailedDeliveries(8);

      // Delivery channels (adapters) actually registered in this instance.
      const channels = app.registry.ids();
      // Does this instance route any QQ/WeChat (i.e. needs the gateway)?
      const needsGateway = channels.some((c) => c !== "console");

      // Derived self-check — each item names a concrete next step.
      type Check = { key: string; label: string; status: "ok" | "warn" | "error" | "skip"; detail: string };
      const checks: Check[] = [];

      if (needsGateway) {
        checks.push(
          gateway.enabled
            ? { key: "runtime", label: "嵌入式 openclaw 运行时", status: "ok", detail: "已启用" }
            : {
                key: "runtime",
                label: "嵌入式 openclaw 运行时",
                status: "error",
                detail: "未启用：镜像未配置 openclaw 渠道，QQ / 微信无法连接",
              },
        );
        if (gateway.enabled) {
          checks.push(
            gateway.running
              ? { key: "gateway", label: "openclaw 网关进程", status: "ok", detail: `运行中（pid ${gateway.pid}）` }
              : {
                  key: "gateway",
                  label: "openclaw 网关进程",
                  status: "error",
                  detail: "网关进程未运行，正在自动重启——稍候刷新；若持续未起，请查看容器日志",
                },
          );
        }
      }

      checks.push(
        bots.length > 0
          ? { key: "bots", label: "已配置机器人", status: "ok", detail: `${bots.length} 个` }
          : {
              key: "bots",
              label: "已配置机器人",
              status: "error",
              detail: "还没有添加任何机器人——去「用户与机器人」给同事添加 QQ / 微信机器人",
            },
      );

      if (bots.length > 0) {
        checks.push(
          activeBots > 0
            ? { key: "online", label: "机器人在线", status: "ok", detail: `${activeBots} 个在线` }
            : {
                key: "online",
                label: "机器人在线",
                status: "warn",
                detail: "机器人尚未就绪：QQ 需 AppID / Secret 正确，微信需扫码登录成功",
              },
        );
        checks.push(
          boundBots > 0
            ? { key: "bound", label: "已绑定收件人", status: "ok", detail: `${boundBots} 个已绑定` }
            : {
                key: "bound",
                label: "已绑定收件人",
                status: "warn",
                detail: "还没有人给机器人发过消息——让同事先发一条「你好」，系统会自动绑定，之后才能向他推送",
              },
        );
        if (erroredBots > 0) {
          checks.push({
            key: "errored",
            label: "异常机器人",
            status: "error",
            detail: `${erroredBots} 个机器人处于 error 状态，请检查凭据或重新添加`,
          });
        }
      }

      const order = { error: 0, warn: 1, ok: 2, skip: 3 } as const;
      const overall = checks.reduce<"ok" | "warn" | "error">((worst, c) => {
        if (c.status === "skip") return worst;
        return order[c.status] < order[worst] ? (c.status as "ok" | "warn" | "error") : worst;
      }, "ok");

      return reply.send({
        overall,
        checks,
        gateway,
        bots,
        summary: {
          users: store.countUsers(),
          bots: bots.length,
          activeBots,
          boundBots,
          channels,
        },
        deliveries: { ...deliveries, recentFailures },
        now: now(),
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
