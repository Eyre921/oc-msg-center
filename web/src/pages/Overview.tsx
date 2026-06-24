import { motion } from "framer-motion";
import { Hash, Inbox, Bot as BotIcon, UsersRound, Send, User as UserIcon, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageLoader, Avatar } from "@/components/ui/misc";
import { useData } from "@/lib/useData";
import { timeAgo } from "@/lib/utils";
import type { User, Group, Topic, Channel, Message } from "@/lib/api";

export function Overview() {
  const users = useData<{ users: User[] }>("/api/v1/users");
  const groups = useData<{ groups: Group[] }>("/api/v1/groups");
  const topics = useData<{ topics: Topic[] }>("/api/v1/topics");
  const platforms = useData<{ channels: Channel[] }>("/api/v1/channels");
  const inbox = useData<{ messages: Message[] }>("/api/v1/inbox?limit=5");
  const sent = useData<{ messages: Message[] }>("/api/v1/sent?limit=6");

  if (users.loading || groups.loading) return <PageLoader />;

  const botCount = (users.data?.users ?? []).reduce((n, u) => n + u.bots.length, 0);
  const channelCount = (topics.data?.topics ?? []).filter((t) => !t.system).length;
  const stats = [
    { label: "用户", value: users.data?.users.length ?? 0, icon: <UsersRound size={16} /> },
    { label: "机器人", value: botCount, icon: <BotIcon size={16} /> },
    { label: "通知频道", value: channelCount, icon: <Hash size={16} /> },
    { label: "分组", value: groups.data?.groups.length ?? 0, icon: <UsersRound size={16} /> },
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FeedCard
          title="最近推送"
          icon={<Send size={15} className="text-faint" />}
          hint="发出去的消息"
          empty="还没有发送过消息"
          rows={(sent.data?.messages ?? []).map((m) => ({
            key: m.id,
            avatar: m.target?.kind === "user" ? m.target.label : m.target?.label ?? m.topic,
            badge:
              m.target?.kind === "group" ? (
                <Badge tone="neutral">
                  <UsersRound size={10} /> {m.target.label}
                </Badge>
              ) : m.target?.kind === "user" ? (
                <Badge tone="neutral">
                  <UserIcon size={10} /> {m.target.label}
                </Badge>
              ) : (
                <Badge tone="accent">
                  <Hash size={10} /> {m.target?.label}
                </Badge>
              ),
            title: m.title,
            body: m.body,
            time: m.createdAt,
          }))}
        />
        <FeedCard
          title="最近收到"
          icon={<Inbox size={15} className="text-faint" />}
          hint="同事发回的消息"
          empty="还没有收到反向消息"
          rows={(inbox.data?.messages ?? []).map((m) => ({
            key: m.id,
            avatar: m.fromUser?.username ?? m.sender ?? "?",
            badge: <span className="text-[13px] font-medium">{m.fromUser?.username ?? m.sender}</span>,
            title: null,
            body: m.body,
            time: m.createdAt,
          }))}
        />
      </div>

      <Card className="mt-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="text-[14px] font-semibold">接入平台</div>
          <span className="text-[12px] text-faint">QQ / 微信 等投递通道</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-5">
          {(platforms.data?.channels ?? []).map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-subtle px-2.5 py-1 text-[12.5px]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> {c.label}
            </span>
          ))}
          <div className="ml-auto rounded-md bg-subtle/70 border border-border px-3 py-2 text-[12.5px] text-muted">
            <span className="mr-1.5 inline-flex items-center gap-1 font-medium text-ink">
              <ArrowUpRight size={12} /> 快速推送
            </span>
            <code className="text-[12px] text-ink">curl -d "hello" {location.origin}/my-topic</code>
          </div>
        </div>
      </Card>
    </div>
  );
}

function FeedCard({
  title,
  icon,
  hint,
  empty,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  hint: string;
  empty: string;
  rows: { key: string; avatar: string; badge: React.ReactNode; title: string | null; body: string; time: number }[];
}) {
  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          {icon} {title}
        </div>
        <span className="text-[12px] text-faint">{hint}</span>
      </div>
      <div className="divide-y divide-border">
        {rows.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-faint">{empty}</div>}
        {rows.map((r) => (
          <div key={r.key} className="flex items-start gap-3 px-5 py-3">
            <Avatar name={r.avatar} className="h-7 w-7 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {r.badge}
                <span className="ml-auto text-[11px] text-faint">{timeAgo(r.time)}</span>
              </div>
              {r.title && <div className="mt-0.5 truncate text-[13px] font-medium">{r.title}</div>}
              <div className="truncate text-[13px] text-muted">{r.body || "（无文本）"}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
