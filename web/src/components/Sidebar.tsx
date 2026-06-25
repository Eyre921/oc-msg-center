import { motion } from "framer-motion";
import {
  Hash,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Radio,
  Send,
  Users,
  UsersRound,
  Webhook,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type PageId =
  | "overview"
  | "inbox"
  | "conversations"
  | "compose"
  | "channels"
  | "users"
  | "groups"
  | "webhooks"
  | "tokens";

export const NAV: { id: PageId; label: string; icon: React.ReactNode; group: string }[] = [
  { id: "overview", label: "概览", icon: <LayoutDashboard size={17} />, group: "main" },
  { id: "inbox", label: "收件箱", icon: <Inbox size={17} />, group: "main" },
  { id: "conversations", label: "对话", icon: <MessagesSquare size={17} />, group: "main" },
  { id: "compose", label: "发送消息", icon: <Send size={17} />, group: "main" },
  { id: "channels", label: "通知频道", icon: <Hash size={17} />, group: "routing" },
  { id: "users", label: "用户与机器人", icon: <Users size={17} />, group: "routing" },
  { id: "groups", label: "分组", icon: <UsersRound size={17} />, group: "routing" },
  { id: "webhooks", label: "Webhooks", icon: <Webhook size={17} />, group: "integrations" },
  { id: "tokens", label: "API Token", icon: <KeyRound size={17} />, group: "integrations" },
];

const GROUPS: { id: string; label: string }[] = [
  { id: "main", label: "工作台" },
  { id: "routing", label: "管理" },
  { id: "integrations", label: "集成" },
];

export function Sidebar({
  page,
  onNavigate,
  onLogout,
  username,
  inboxCount,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  onLogout: () => void;
  username: string;
  inboxCount?: number;
}) {
  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-subtle/60">
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-border">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-white">
          <Radio size={15} />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">OC Msg Center</div>
          <div className="text-[10px] text-faint">通知中心</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {GROUPS.map((g) => (
          <div key={g.id} className="mb-5">
            <div className="px-2.5 mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
              {g.label}
            </div>
            {NAV.filter((n) => n.group === g.id).map((n) => {
              const active = page === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => onNavigate(n.id)}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors",
                    active ? "text-ink font-medium" : "text-muted hover:text-ink hover:bg-black/[0.03]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-md bg-white shadow-card border border-border"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className={cn("relative z-10", active ? "text-ink" : "text-faint")}>{n.icon}</span>
                  <span className="relative z-10 flex-1 text-left">{n.label}</span>
                  {n.id === "inbox" && inboxCount ? (
                    <span className="relative z-10 rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {inboxCount > 99 ? "99+" : inboxCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 leading-tight">
            <div className="text-[13px] font-medium">{username}</div>
            <div className="text-[10px] text-faint">管理员</div>
          </div>
          <button
            onClick={onLogout}
            title="退出"
            className="rounded-md p-1.5 text-faint hover:bg-black/[0.04] hover:text-danger transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
