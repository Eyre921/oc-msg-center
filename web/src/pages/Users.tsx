import { motion } from "framer-motion";
import { Bot as BotIcon, Plus, QrCode, Trash2, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Avatar, EmptyState, PageLoader, StatusDot } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useData } from "@/lib/useData";
import { api, type Channel, type User } from "@/lib/api";

export function UsersPage() {
  const toast = useToast();
  const { data, loading, refetch } = useData<{ users: User[] }>("/api/v1/users");
  const channels = useData<{ channels: Channel[] }>("/api/v1/channels");

  const [newName, setNewName] = useState("");
  const [botFor, setBotFor] = useState<User | null>(null);
  const [bind, setBind] = useState<{ qr: string; sampleMessage: string; username: string } | null>(null);
  const [qrSession, setQrSession] = useState<string | null>(null);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api("POST", "/api/v1/users", { username: newName.trim() });
      setNewName("");
      refetch();
      toast("已创建用户", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function genBind(u: User, botId?: string) {
    const r = await api<{ qr: string; sampleMessage: string; username: string }>("POST", "/api/v1/bindings", {
      userId: u.id,
      botId,
    });
    setBind(r);
  }

  async function delUser(u: User) {
    if (!confirm(`删除用户 ${u.username}？其名下机器人也会一并删除。`)) return;
    await api("DELETE", `/api/v1/users/${u.id}`);
    refetch();
  }
  async function delBot(id: string) {
    if (!confirm("删除该机器人？")) return;
    await api("DELETE", `/api/v1/bots/${id}`);
    refetch();
  }

  if (loading) return <PageLoader />;
  const users = data?.users ?? [];

  return (
    <div>
      <PageHeader
        title="用户与机器人"
        subtitle="每位同事拥有自己的 QQ / 微信 机器人，凭据在这里集中管理"
      />

      <Card className="mb-5 p-4">
        <form onSubmit={createUser} className="flex gap-2">
          <Input
            placeholder="新用户名（内部识别用）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1"
          />
          <Button type="submit">
            <UserPlus size={15} /> 创建用户
          </Button>
        </form>
      </Card>

      {users.length === 0 ? (
        <EmptyState icon={<UserPlus size={28} />} title="还没有用户" hint="先创建一个用户，再为他添加机器人。" />
      ) : (
        <div className="space-y-3">
          {users.map((u, i) => (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.2) }}
            >
              <Card className="p-4">
                <div className="flex items-start gap-3.5">
                  <Avatar name={u.username} className="h-9 w-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14.5px] font-semibold">{u.username}</span>
                      {u.role === "admin" && <Badge tone="accent">管理员</Badge>}
                      {u.groups.map((g) => (
                        <Badge key={g} tone="neutral">
                          {g}
                        </Badge>
                      ))}
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {u.bots.length === 0 && (
                        <p className="text-[13px] text-faint">还没有机器人</p>
                      )}
                      {u.bots.map((b) => (
                        <div key={b.id} className="flex items-center gap-2 text-[13px]">
                          <StatusDot status={b.status} />
                          <span className="font-medium">{b.channel}</span>
                          <span className="text-faint">/ {b.accountId}</span>
                          {b.label && <span className="text-muted">· {b.label}</span>}
                          <Badge tone={b.status === "active" ? "success" : b.status === "error" ? "danger" : "warn"}>
                            {b.status}
                          </Badge>
                          <button
                            onClick={() => genBind(u, b.id)}
                            className="ml-1 inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                          >
                            <QrCode size={12} /> 绑定码
                          </button>
                          <button
                            onClick={() => delBot(b.id)}
                            className="text-faint hover:text-danger transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setBotFor(u)}>
                      <Plus size={14} /> 添加机器人
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => delUser(u)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <AddBotDialog
        user={botFor}
        channels={channels.data?.channels ?? []}
        onClose={() => setBotFor(null)}
        onCreated={(needsQr, sessionId) => {
          setBotFor(null);
          refetch();
          if (needsQr && sessionId) setQrSession(sessionId);
        }}
      />

      <Dialog open={!!bind} onClose={() => setBind(null)} title="扫码绑定" description="让对方用自己的机器人发送下面的绑定码">
        {bind && (
          <div className="flex flex-col items-center gap-3">
            <img src={bind.qr} alt="QR" className="h-44 w-44 rounded-lg border border-border" />
            <div className="text-center">
              <div className="text-[13px] text-muted">
                让 <b>{bind.username}</b> 给自己的机器人发送：
              </div>
              <code className="mt-1 inline-block rounded-md bg-subtle px-3 py-1.5 text-[14px] font-semibold">
                {bind.sampleMessage}
              </code>
              <p className="mt-2 text-[12px] text-faint">
                提示：私人机器人首次发任意消息即可自动认主，绑定码用于显式绑定。
              </p>
            </div>
          </div>
        )}
      </Dialog>

      <WeChatQrDialog session={qrSession} onClose={() => setQrSession(null)} onDone={refetch} />
    </div>
  );
}

function AddBotDialog({
  user,
  channels,
  onClose,
  onCreated,
}: {
  user: User | null;
  channels: Channel[];
  onClose: () => void;
  onCreated: (needsQr: boolean, sessionId?: string) => void;
}) {
  const toast = useToast();
  const [channel, setChannel] = useState("qqbot");
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [wxMode, setWxMode] = useState<"qr" | "import">("qr");
  const [wxToken, setWxToken] = useState("");
  const [wxBaseUrl, setWxBaseUrl] = useState("https://ilinkai.weixin.qq.com");
  const [wxUserId, setWxUserId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setChannel(channels[0]?.id ?? "qqbot");
      setAccountId(`${user.username}-${channels[0]?.id ?? "bot"}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
      setLabel("");
      setAppId("");
      setSecret("");
    }
  }, [user, channels]);

  async function submit() {
    if (!user) return;
    setBusy(true);
    try {
      const credentials: Record<string, unknown> = {};
      if (channel === "qqbot") {
        credentials.appId = appId;
        credentials.secret = secret;
      } else if ((channel.includes("weixin") || channel.includes("wx")) && wxMode === "import") {
        credentials.token = wxToken.trim();
        if (wxBaseUrl.trim()) credentials.baseUrl = wxBaseUrl.trim();
        if (wxUserId.trim()) credentials.userId = wxUserId.trim();
      }
      const r = await api<{ needsQrScan?: boolean; loginSessionId?: string }>("POST", "/api/v1/bots", {
        userId: user.id,
        channel,
        accountId,
        label: label || null,
        credentials,
      });
      toast("机器人已创建", "success");
      onCreated(!!r.needsQrScan, r.loginSessionId);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const isQQ = channel === "qqbot";
  const isWx = channel.includes("weixin") || channel.includes("wx");

  return (
    <Dialog open={!!user} onClose={onClose} title={`为 ${user?.username ?? ""} 添加机器人`}>
      <div className="space-y-4">
        <div>
          <Label>渠道</Label>
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}（{c.id}）
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>accountId（唯一）</Label>
            <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} />
          </div>
          <div>
            <Label>标签（可选）</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Alice 的 QQ" />
          </div>
        </div>

        {isQQ && (
          <div className="grid grid-cols-2 gap-3 rounded-md bg-subtle/60 p-3">
            <div>
              <Label>QQ AppID</Label>
              <Input value={appId} onChange={(e) => setAppId(e.target.value)} />
            </div>
            <div>
              <Label>QQ AppSecret</Label>
              <Input value={secret} onChange={(e) => setSecret(e.target.value)} />
            </div>
            <p className="col-span-2 text-[12px] text-faint">
              在 q.qq.com 为该同事创建机器人，复制 AppID / AppSecret 粘到这里。
            </p>
          </div>
        )}
        {isWx && (
          <div className="rounded-md bg-subtle/60 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["qr", "import"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWxMode(m)}
                  className={`rounded-md border px-3 py-2 text-[12.5px] font-medium transition-all ${
                    wxMode === m ? "border-ink bg-white shadow-card" : "border-border hover:border-neutral-300"
                  }`}
                >
                  {m === "qr" ? "扫码登录" : "导入会话"}
                </button>
              ))}
            </div>
            {wxMode === "qr" ? (
              <p className="text-[12px] text-muted">保存后会弹出二维码，让对方用自己的微信扫码登录。</p>
            ) : (
              <div className="space-y-2">
                <div>
                  <Label>会话 token</Label>
                  <Input value={wxToken} onChange={(e) => setWxToken(e.target.value)} placeholder="xxxx@im.bot:0600..." />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>baseUrl</Label>
                    <Input value={wxBaseUrl} onChange={(e) => setWxBaseUrl(e.target.value)} />
                  </div>
                  <div>
                    <Label>userId（可选）</Label>
                    <Input value={wxUserId} onChange={(e) => setWxUserId(e.target.value)} placeholder="o9cq...@im.wechat" />
                  </div>
                </div>
                <p className="text-[12px] text-faint">
                  粘贴已导出的微信会话，accountId 会自动按 token 推导，无需扫码。
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={busy || !accountId} onClick={submit}>
            {busy ? "创建中…" : "创建机器人"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function WeChatQrDialog({
  session,
  onClose,
  onDone,
}: {
  session: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [buffer, setBuffer] = useState("");
  const [status, setStatus] = useState("pending");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!session) return;
    setBuffer("等待 openclaw 输出二维码…");
    setStatus("pending");
    const poll = async () => {
      try {
        const r = await api<{ status: string; buffer: string; exitCode: number | null }>(
          "GET",
          `/api/v1/bots/login-sessions/${encodeURIComponent(session)}`,
        );
        setBuffer(r.buffer || "（暂无输出）");
        setStatus(r.status);
        if (r.status !== "pending") {
          if (timer.current) clearInterval(timer.current);
          if (r.status === "ok") {
            onDone();
            setTimeout(onClose, 1500);
          }
        }
      } catch {
        /* keep polling */
      }
    };
    void poll();
    timer.current = window.setInterval(poll, 1500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return (
    <Dialog open={!!session} onClose={onClose} title="微信扫码登录" description="让对方用手机微信扫描下方二维码">
      <pre className="max-h-[55vh] overflow-auto rounded-md bg-white p-3 text-[8px] leading-[8px] text-black border border-border">
        {buffer}
      </pre>
      <div className="mt-3 flex items-center justify-between">
        <Badge tone={status === "ok" ? "success" : status === "failed" ? "danger" : "warn"} dot>
          {status === "ok" ? "登录成功" : status === "failed" ? "登录失败" : "等待扫码"}
        </Badge>
        <Button size="sm" variant="secondary" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Dialog>
  );
}
