import { motion } from "framer-motion";
import { MessagesSquare, Paperclip, Send, File as FileIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Avatar, EmptyState, PageLoader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useData } from "@/lib/useData";
import { api, getToken, type User } from "@/lib/api";
import { cn, fmtTime } from "@/lib/utils";

interface ConvMessage {
  id: string;
  direction: "in" | "out";
  title: string | null;
  body: string;
  createdAt: number;
  sender: string | null;
  attachment: { id: string; filename: string; contentType: string; size: number; url: string } | null;
}

export function Conversations() {
  const users = useData<{ users: User[] }>("/api/v1/users");
  const [selected, setSelected] = useState<string | null>(null);

  // Colleagues to chat with. Admins are operators, not chat targets — but if the
  // operator bound a bot to their own admin account (e.g. to test), surface them
  // too, otherwise the thread would be invisible.
  const list = (users.data?.users ?? []).filter((u) => u.role !== "admin" || u.bots.length > 0);
  useEffect(() => {
    if (!selected && list.length) setSelected(list[0].id);
  }, [list, selected]);

  if (users.loading) return <PageLoader />;

  return (
    <div>
      <PageHeader title="对话" subtitle="查看每位同事的消息记录，并直接通过机器人和他聊天" />
      {list.length === 0 ? (
        <EmptyState icon={<MessagesSquare size={28} />} title="还没有用户" hint="先在「用户与机器人」里创建用户并绑定机器人。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]" style={{ height: "calc(100vh - 200px)" }}>
          <div className="space-y-1 overflow-y-auto">
            {list.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelected(u.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  selected === u.id ? "bg-ink/[0.04]" : "hover:bg-subtle",
                )}
              >
                <Avatar name={u.username} className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{u.username}</div>
                  <div className="truncate text-[11.5px] text-faint">
                    {u.bots.length ? u.bots.map((b) => b.channel).join(" · ") : "未绑定机器人"}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {selected && <Thread userId={selected} username={list.find((u) => u.id === selected)?.username ?? ""} />}
        </div>
      )}
    </div>
  );
}

function Thread({ userId, username }: { userId: string; username: string }) {
  const toast = useToast();
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(scroll = false) {
    try {
      const r = await api<{ messages: ConvMessage[] }>("GET", `/api/v1/users/${userId}/conversation?limit=200`);
      setMessages(r.messages);
      if (scroll) setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    load(true);
    const t = setInterval(() => load(false), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setSending(true);
    try {
      let attachmentId: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await api<{ id: string }>("POST", "/api/v1/files", fd, { raw: true });
        attachmentId = up.id;
      }
      await api("POST", "/api/v1/publish", { user: userId, body: text, attachmentId });
      setText("");
      setFile(null);
      await load(true);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Avatar name={username} className="h-7 w-7" />
        <span className="text-[14px] font-semibold">{username}</span>
        <span className="ml-auto text-[11.5px] text-faint">通过其机器人对话</span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-subtle/30 px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-faint">还没有消息。在下面发一条试试。</div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </div>

      <form onSubmit={send} className="border-t border-border p-3">
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-subtle px-2.5 py-1.5 text-[12.5px]">
            <FileIcon size={13} className="text-faint" />
            <span className="flex-1 truncate">{file.name}</span>
            <button type="button" onClick={() => setFile(null)} className="text-faint hover:text-danger">移除</button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button type="button" size="icon" variant="ghost" onClick={() => fileRef.current?.click()} title="附件">
            <Paperclip size={16} />
          </Button>
          <Input
            placeholder={`给 ${username} 发消息…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={sending || (!text.trim() && !file)}>
            <Send size={15} /> 发送
          </Button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ m }: { m: ConvMessage }) {
  const out = m.direction === "out";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex", out ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[72%] rounded-2xl px-3.5 py-2 text-[13.5px] shadow-sm",
          out ? "bg-ink text-white rounded-br-sm" : "bg-white border border-border rounded-bl-sm",
        )}
      >
        {m.title && <div className="mb-0.5 text-[12px] font-semibold opacity-90">{m.title}</div>}
        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
        {m.attachment && (
          <a
            href={`${m.attachment.url}?token=${getToken()}`}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]",
              out ? "bg-white/15" : "bg-subtle",
            )}
          >
            {m.attachment.contentType.startsWith("image/") ? (
              <img src={m.attachment.url} alt={m.attachment.filename} className="max-h-40 rounded" />
            ) : (
              <>
                <FileIcon size={13} /> {m.attachment.filename}
              </>
            )}
          </a>
        )}
        <div className={cn("mt-1 text-[10.5px]", out ? "text-white/55" : "text-faint")}>{fmtTime(m.createdAt)}</div>
      </div>
    </motion.div>
  );
}
