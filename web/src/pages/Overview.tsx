import { motion } from "framer-motion";
import { Hash, Inbox, Bot as BotIcon, UsersRound, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { PageLoader, Avatar } from "@/components/ui/misc";
import { useData } from "@/lib/useData";
import { timeAgo } from "@/lib/utils";
import type { User, Group, Topic, Channel, Message } from "@/lib/api";

export function Overview() {
  const users = useData<{ users: User[] }>("/api/v1/users");
  const groups = useData<{ groups: Group[] }>("/api/v1/groups");
  const topics = useData<{ topics: Topic[] }>("/api/v1/topics");
  const channels = useData<{ channels: Channel[] }>("/api/v1/channels");
  const inbox = useData<{ messages: Message[] }>("/api/v1/inbox?limit=6");

  if (users.loading || groups.loading) return <PageLoader />;

  const botCount = (users.data?.users ?? []).reduce((n, u) => n + u.bots.length, 0);
  const stats = [
    { label: "用户", value: users.data?.users.length ?? 0, icon: <UsersRound size={16} /> },
    { label: "机器人", value: botCount, icon: <BotIcon size={16} /> },
    { label: "通知频道", value: topics.data?.topics.length ?? 0, icon: <Hash size={16} /> },
    { label: "收件箱", value: inbox.data?.messages.length ?? 0, icon: <Inbox size={16} /> },
  ];

  return (
    <div>
      <PageHeader title="概览" subtitle="你的通知中心一览" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <Card className="p-4">
              <div className="flex items-center justify-between text-faint">
                <span className="text-[12px] text-muted">{s.label}</span>
                {s.icon}
              </div>
              <div className="mt-2 text-[28px] font-semibold tracking-tight tabular-nums">{s.value}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <Inbox size={15} className="text-faint" /> 最近收到
            </div>
            <span className="text-[12px] text-faint">同事发回的消息</span>
          </div>
          <div className="divide-y divide-border">
            {(inbox.data?.messages ?? []).length === 0 && (
              <div className="px-5 py-8 text-center text-[13px] text-faint">还没有收到反向消息</div>
            )}
            {(inbox.data?.messages ?? []).map((m) => (
              <div key={m.id} className="flex items-start gap-3 px-5 py-3">
                <Avatar name={m.fromUser?.username ?? m.sender ?? "?"} className="h-7 w-7 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{m.fromUser?.username ?? m.sender}</span>
                    <span className="text-[11px] text-faint">{timeAgo(m.createdAt)}</span>
                  </div>
                  <div className="truncate text-[13px] text-muted">{m.body || "（无文本）"}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="text-[14px] font-semibold">已激活渠道</div>
            <span className="text-[12px] text-faint">{channels.data?.channels.length ?? 0} 个</span>
          </div>
          <div className="p-5">
            <div className="flex flex-wrap gap-2">
              {(channels.data?.channels ?? []).map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-subtle px-2.5 py-1 text-[12.5px]"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> {c.label}
                </span>
              ))}
            </div>
            <div className="mt-5 rounded-md bg-subtle/70 border border-border p-3.5 text-[12.5px] text-muted leading-relaxed">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-ink">
                <ArrowUpRight size={13} /> 快速推送
              </div>
              <code className="text-[12px] text-ink">curl -d "hello" {location.origin}/my-topic</code>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
