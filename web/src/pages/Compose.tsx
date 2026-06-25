import { motion } from "framer-motion";
import { Send, User as UserIcon, UsersRound, Hash } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useData } from "@/lib/useData";
import { api, type Group, type Topic, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

type Target = "user" | "group" | "channel";

const TARGETS: { id: Target; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "user", label: "指定用户", icon: <UserIcon size={16} />, hint: "直接发给某个同事的全部机器人" },
  { id: "group", label: "分组", icon: <UsersRound size={16} />, hint: "群发给分组里的所有成员" },
  { id: "channel", label: "通知频道", icon: <Hash size={16} />, hint: "发给订阅了该频道的用户和分组" },
];

const PRIORITIES = [
  { v: 1, label: "1 · 最低" },
  { v: 2, label: "2 · 低" },
  { v: 3, label: "3 · 默认" },
  { v: 4, label: "4 · 高" },
  { v: 5, label: "5 · 紧急" },
];

export function Compose() {
  const toast = useToast();
  const users = useData<{ users: User[] }>("/api/v1/users");
  const groups = useData<{ groups: Group[] }>("/api/v1/groups");
  const topics = useData<{ topics: Topic[] }>("/api/v1/topics");

  const [target, setTarget] = useState<Target>("user");
  const [value, setValue] = useState("");
  const [channelName, setChannelName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState(3);
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let attachmentId: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await api<{ id: string }>("POST", "/api/v1/files", fd, { raw: true });
        attachmentId = up.id;
      }
      const payload: Record<string, unknown> = {
        title: title || null,
        body,
        priority,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        attachmentId,
      };
      if (target === "user") payload.user = value;
      else if (target === "group") payload.group = value;
      else payload.topic = channelName;
      const r = await api<{ id: string; topic: string }>("POST", "/api/v1/publish", payload);
      toast(`已发送 · ${r.topic}`, "success");
      setBody("");
      setTitle("");
      setTags("");
      setFile(null);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const canSend = body.trim() && (target === "channel" ? channelName.trim() : value);

  return (
    <div>
      <PageHeader title="发送消息" subtitle="选择对象，立即推送到 QQ / 微信" />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <form onSubmit={send} className="space-y-5 p-6">
            <div>
              <Label>发送对象</Label>
              <div className="grid grid-cols-3 gap-2">
                {TARGETS.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => {
                      setTarget(t.id);
                      setValue("");
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2.5 text-left transition-all",
                      target === t.id
                        ? "border-ink bg-ink/[0.03] shadow-card"
                        : "border-border hover:border-neutral-300",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      <span className={target === t.id ? "text-ink" : "text-faint"}>{t.icon}</span>
                      {t.label}
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-faint">{TARGETS.find((t) => t.id === target)?.hint}</p>
            </div>

            <div>
              {target === "user" && (
                <>
                  <Label>选择用户</Label>
                  <Select value={value} onChange={(e) => setValue(e.target.value)}>
                    <option value="">— 选择一位同事 —</option>
                    {users.data?.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              {target === "group" && (
                <>
                  <Label>选择分组</Label>
                  <Select value={value} onChange={(e) => setValue(e.target.value)}>
                    <option value="">— 选择一个分组 —</option>
                    {groups.data?.groups.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}（{g.members.length} 人）
                      </option>
                    ))}
                  </Select>
                </>
              )}
              {target === "channel" && (
                <>
                  <Label>频道名</Label>
                  <Input
                    list="topic-list"
                    placeholder="如 disk-alerts"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                  />
                  <datalist id="topic-list">
                    {topics.data?.topics
                      .filter((t) => !t.system)
                      .map((t) => (
                        <option key={t.name} value={t.name} />
                      ))}
                  </datalist>
                </>
              )}
            </div>

            <div>
              <Label>标题（可选）</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="🔥 Prod 告警" />
            </div>
            <div>
              <Label>正文 · 支持 Markdown</Label>
              <Textarea
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="**数据库主库失联**&#10;- 节点 node-3&#10;- 时间 12:04"
              />
            </div>
            <div>
              <Label>标签（逗号分隔，可选）</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="prod, db" />
            </div>
            <div>
              <Label>附件（可选，图片/文件）</Label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-[13px] text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-subtle file:px-3 file:py-1.5 file:text-[13px] file:text-ink hover:file:bg-neutral-100"
              />
            </div>

            <Button type="submit" disabled={!canSend || busy} className="w-full">
              <Send size={15} /> {busy ? "发送中…" : "发送"}
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-2 text-[13px] font-semibold">优先级</div>
            <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {PRIORITIES.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-[12px] text-faint">订阅者可按最低优先级过滤，紧急消息不会被静音。</p>
          </Card>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="p-5 bg-subtle/40">
              <div className="mb-2 text-[13px] font-semibold">预览</div>
              <div className="rounded-md border border-border bg-white p-3.5">
                {title && <div className="mb-1 text-[13.5px] font-semibold">{title}</div>}
                <div className="whitespace-pre-wrap break-words text-[13px] text-muted">
                  {body || "在左侧输入正文…"}
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
