import { motion } from "framer-motion";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Server,
  Bot as BotIcon,
  Send,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

type CheckStatus = "ok" | "warn" | "error" | "skip";

interface StatusData {
  overall: "ok" | "warn" | "error";
  checks: { key: string; label: string; status: CheckStatus; detail: string }[];
  gateway: { enabled: boolean; running: boolean; pid: number | null; restarts: number };
  bots: {
    id: string;
    channel: string;
    accountId: string;
    label: string | null;
    status: "pending" | "active" | "disabled" | "error";
    owner: string | null;
    bound: boolean;
    lastSeenAt: number | null;
  }[];
  summary: { users: number; bots: number; activeBots: number; boundBots: number; channels: string[] };
  deliveries: { delivered: number; failed: number; recentFailures: { channel: string; error: string | null; createdAt: number }[] };
  now: number;
}

const CHANNEL_LABEL: Record<string, string> = { qqbot: "QQ", weixin: "微信", console: "控制台" };

export function Status() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api<StatusData>("GET", "/api/v1/status"));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <PageLoader />;
  if (!data) return <div className="text-[13px] text-danger">加载失败：{err}</div>;

  return (
    <div>
      <PageHeader
        title="系统状态"
        subtitle="网关、机器人在线情况与消息投递监控"
        actions={
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={14} /> 刷新
          </Button>
        }
      />

      <OverallBanner overall={data.overall} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* self-check */}
          <Card>
            <div className="border-b border-border px-5 py-3.5 text-[14px] font-semibold">收发自检</div>
            <div className="divide-y divide-border">
              {data.checks.filter((c) => c.status !== "skip").map((c) => (
                <div key={c.key} className="flex items-start gap-3 px-5 py-3">
                  <CheckIcon status={c.status} />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium">{c.label}</div>
                    <div className="text-[12.5px] text-faint">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* bots */}
          <Card>
            <div className="border-b border-border px-5 py-3.5 text-[14px] font-semibold">
              机器人 <span className="text-faint">（{data.summary.activeBots}/{data.summary.bots} 在线）</span>
            </div>
            {data.bots.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-faint">
                还没有机器人。去「用户与机器人」给同事添加 QQ / 微信机器人。
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.bots.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-5 py-3">
                    <BotIcon size={16} className="shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13.5px] font-medium">
                        {b.owner ?? "—"}
                        <span className="text-faint">·</span>
                        <span className="text-muted">{CHANNEL_LABEL[b.channel] ?? b.channel}</span>
                      </div>
                      <div className="truncate text-[12px] text-faint">
                        {b.accountId}
                        {b.lastSeenAt ? ` · ${timeAgo(b.lastSeenAt)}活跃` : ""}
                      </div>
                    </div>
                    {b.bound ? (
                      <Badge tone="neutral">已绑定</Badge>
                    ) : (
                      <Badge tone="warn">未绑定</Badge>
                    )}
                    <BotStatusBadge status={b.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* gateway */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Server size={15} className="text-faint" /> openclaw 网关
            </div>
            {!data.gateway.enabled ? (
              <Badge tone="neutral" dot>未启用</Badge>
            ) : data.gateway.running ? (
              <div className="space-y-1.5">
                <Badge tone="success" dot>运行中</Badge>
                <div className="text-[12px] text-faint">pid {data.gateway.pid}</div>
                {data.gateway.restarts > 0 && (
                  <div className="text-[12px] text-faint">已重启 {data.gateway.restarts} 次</div>
                )}
              </div>
            ) : (
              <Badge tone="danger" dot>未运行</Badge>
            )}
          </Card>

          {/* deliveries */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Send size={15} className="text-faint" /> 24 小时投递
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[22px] font-semibold tracking-tight text-[#137333]">{data.deliveries.delivered}</div>
                <div className="text-[12px] text-faint">成功</div>
              </div>
              <div>
                <div className={cn("text-[22px] font-semibold tracking-tight", data.deliveries.failed ? "text-danger" : "")}>
                  {data.deliveries.failed}
                </div>
                <div className="text-[12px] text-faint">失败</div>
              </div>
            </div>
            {data.deliveries.recentFailures.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                <div className="text-[11.5px] font-medium text-faint">最近失败</div>
                {data.deliveries.recentFailures.slice(0, 5).map((f, i) => (
                  <div key={i} className="text-[11.5px] text-muted">
                    <span className="text-faint">{CHANNEL_LABEL[f.channel] ?? f.channel}：</span>
                    {f.error ?? "未知错误"}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function OverallBanner({ overall }: { overall: "ok" | "warn" | "error" }) {
  const map = {
    ok: { tone: "bg-[#e6f4ea] border-[#cdebd6] text-[#137333]", icon: <CheckCircle2 size={18} />, text: "系统正常，可以正常收发消息" },
    warn: { tone: "bg-[#fef3da] border-[#f7e2b5] text-[#9a6700]", icon: <AlertTriangle size={18} />, text: "部分项目待完成，请按下方自检处理后即可收发" },
    error: { tone: "bg-[#fdeced] border-[#f6d3d5] text-[#c0292e]", icon: <XCircle size={18} />, text: "当前无法收发消息，请按下方自检处理" },
  }[overall];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-center gap-2.5 rounded-lg border px-4 py-3 text-[13.5px] font-medium", map.tone)}
    >
      {map.icon}
      {map.text}
    </motion.div>
  );
}

function CheckIcon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[#137333]" />;
  if (status === "warn") return <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[#9a6700]" />;
  return <XCircle size={17} className="mt-0.5 shrink-0 text-danger" />;
}

function BotStatusBadge({ status }: { status: "pending" | "active" | "disabled" | "error" }) {
  const map = {
    active: { tone: "success" as const, label: "在线" },
    pending: { tone: "warn" as const, label: "待就绪" },
    error: { tone: "danger" as const, label: "异常" },
    disabled: { tone: "neutral" as const, label: "已停用" },
  }[status];
  return <Badge tone={map.tone} dot>{map.label}</Badge>;
}
