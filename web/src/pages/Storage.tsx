import { motion } from "framer-motion";
import {
  HardDrive,
  Image as ImageIcon,
  FileText,
  Unlink,
  Trash2,
  Download,
  Eraser,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageLoader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api, getToken } from "@/lib/api";
import { cn, fmtBytes, fmtTime } from "@/lib/utils";

interface Stats {
  total: { count: number; bytes: number };
  images: { count: number; bytes: number };
  files: { count: number; bytes: number };
  orphans: { count: number; bytes: number };
  oldest: number | null;
  newest: number | null;
  config: { attachmentsDir: string; attachmentMaxBytes: number; attachmentTtlSeconds: number };
}

interface Att {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  ownerId: string | null;
  ownerName: string | null;
  referenced: boolean;
  createdAt: number;
  url: string;
}

interface Rule {
  type?: "image" | "file";
  olderThanDays?: number;
  minSizeMb?: number;
  orphan?: boolean;
  q?: string;
}

export function Storage() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Att[]>([]);
  const [total, setTotal] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // filter / cleanup rule
  const [type, setType] = useState<"" | "image" | "file">("");
  const [olderThanDays, setOlderThanDays] = useState("");
  const [minSizeMb, setMinSizeMb] = useState("");
  const [orphan, setOrphan] = useState(false);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<{ count: number; bytes: number } | null>(null);

  function rule(): Rule {
    return {
      type: type || undefined,
      olderThanDays: olderThanDays ? Number(olderThanDays) : undefined,
      minSizeMb: minSizeMb ? Number(minSizeMb) : undefined,
      orphan: orphan || undefined,
      q: q.trim() || undefined,
    };
  }

  function queryString(): string {
    const r = rule();
    const p = new URLSearchParams();
    if (r.type) p.set("type", r.type);
    if (r.olderThanDays != null) p.set("olderThanDays", String(r.olderThanDays));
    if (r.minSizeMb != null) p.set("minSizeMb", String(r.minSizeMb));
    if (r.orphan) p.set("orphan", "true");
    if (r.q) p.set("q", r.q);
    p.set("limit", "200");
    return p.toString();
  }

  async function load() {
    try {
      const [s, list] = await Promise.all([
        api<Stats>("GET", "/api/v1/storage/stats"),
        api<{ items: Att[]; total: number; bytes: number }>(
          "GET",
          `/api/v1/storage/attachments?${queryString()}`,
        ),
      ]);
      setStats(s);
      setItems(list.items);
      setTotal(list.total);
      setBytes(list.bytes);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-filter on rule change (debounced-ish via effect)
  useEffect(() => {
    const t = setTimeout(() => {
      setPreview(null);
      load();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, olderThanDays, minSizeMb, orphan, q]);

  const hasRule = Boolean(rule().type || rule().olderThanDays != null || rule().minSizeMb != null || rule().orphan || rule().q);

  async function doPreview() {
    setBusy(true);
    try {
      const r = await api<{ count: number; bytes: number }>("POST", "/api/v1/storage/cleanup", {
        ...rule(),
        dryRun: true,
      });
      setPreview({ count: r.count, bytes: r.bytes });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function doCleanup() {
    const count = preview?.count ?? total;
    if (!confirm(`确认删除符合条件的 ${count} 个文件？此操作不可恢复。`)) return;
    setBusy(true);
    try {
      const r = await api<{ deleted: number; bytes: number }>("POST", "/api/v1/storage/cleanup", rule());
      toast(`已清理 ${r.deleted} 个文件，释放 ${fmtBytes(r.bytes)}`, "success");
      setPreview(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(id: string) {
    if (!confirm("删除该文件？")) return;
    try {
      await api("DELETE", `/api/v1/storage/attachments/${id}`);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  function resetRule() {
    setType("");
    setOlderThanDays("");
    setMinSizeMb("");
    setOrphan(false);
    setQ("");
    setPreview(null);
  }

  if (loading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="文件存储"
        subtitle="所有收发的图片与文件永久保存在服务器，可按规则手动清理"
        actions={
          <Button variant="secondary" size="sm" onClick={() => load()}>
            <RefreshCw size={14} /> 刷新
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<HardDrive size={16} />} label="总文件" value={`${stats?.total.count ?? 0}`} sub={fmtBytes(stats?.total.bytes ?? 0)} />
        <StatCard icon={<ImageIcon size={16} />} label="图片" value={`${stats?.images.count ?? 0}`} sub={fmtBytes(stats?.images.bytes ?? 0)} />
        <StatCard icon={<FileText size={16} />} label="其他文件" value={`${stats?.files.count ?? 0}`} sub={fmtBytes(stats?.files.bytes ?? 0)} />
        <StatCard icon={<Unlink size={16} />} label="未被引用" value={`${stats?.orphans.count ?? 0}`} sub={fmtBytes(stats?.orphans.bytes ?? 0)} tone={stats?.orphans.count ? "warn" : "neutral"} />
      </div>

      <div className="mt-3 text-[12px] text-faint">
        保留策略：<span className="font-medium text-muted">永久保存</span>
        {stats && stats.config.attachmentTtlSeconds > 0 ? `（自动过期 ${Math.round(stats.config.attachmentTtlSeconds / 86400)} 天）` : "（不自动删除，仅手动清理）"}
        ，单文件上限 {fmtBytes(stats?.config.attachmentMaxBytes ?? 0)}。
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* cleanup rules */}
        <Card className="h-fit">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <Eraser size={15} className="text-faint" />
            <span className="text-[14px] font-semibold">清理规则</span>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <Label>类型</Label>
              <Select value={type} onChange={(e) => setType(e.target.value as "" | "image" | "file")}>
                <option value="">全部类型</option>
                <option value="image">仅图片</option>
                <option value="file">仅其他文件</option>
              </Select>
            </div>
            <div>
              <Label>早于（天）</Label>
              <Input type="number" min={0} placeholder="如 30" value={olderThanDays} onChange={(e) => setOlderThanDays(e.target.value)} />
            </div>
            <div>
              <Label>大于（MB）</Label>
              <Input type="number" min={0} placeholder="如 10" value={minSizeMb} onChange={(e) => setMinSizeMb(e.target.value)} />
            </div>
            <div>
              <Label>文件名包含</Label>
              <Input placeholder="关键字" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" checked={orphan} onChange={(e) => setOrphan(e.target.checked)} className="h-3.5 w-3.5 accent-ink" />
              仅清理未被任何消息引用的文件
            </label>

            {preview && (
              <div className="rounded-md border border-warn/30 bg-[#fef3da]/50 px-3 py-2 text-[12.5px] text-[#9a6700]">
                将删除 <b>{preview.count}</b> 个文件，释放 <b>{fmtBytes(preview.bytes)}</b>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <Button variant="secondary" size="sm" disabled={busy || !hasRule} onClick={doPreview}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : null} 预览
              </Button>
              <Button variant="danger" size="sm" disabled={busy || !hasRule} onClick={doCleanup}>
                <Trash2 size={14} /> 按规则清理
              </Button>
              {hasRule && (
                <button onClick={resetRule} className="text-[12px] text-faint hover:text-ink">
                  清空规则
                </button>
              )}
            </div>
            <p className="text-[11.5px] text-faint">不设任何规则不会清空全部文件——这是为了防止误删。</p>
          </div>
        </Card>

        {/* file list */}
        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <span className="text-[14px] font-semibold">
              文件列表 {hasRule && <span className="text-faint">（符合规则 {total} 个 · {fmtBytes(bytes)}）</span>}
            </span>
          </div>
          {items.length === 0 ? (
            <EmptyState icon={<HardDrive size={26} />} title="没有匹配的文件" hint="收发的图片和文件会自动保存到这里。" />
          ) : (
            <div className="divide-y divide-border">
              {items.map((a) => (
                <Row key={a.id} a={a} onDelete={() => deleteOne(a.id)} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className={cn("flex items-center gap-1.5 text-[12px] font-medium", tone === "warn" ? "text-[#9a6700]" : "text-faint")}>
        {icon} {label}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold tracking-tight">{value}</div>
      <div className="text-[12px] text-faint">{sub}</div>
    </Card>
  );
}

function Row({ a, onDelete }: { a: Att; onDelete: () => void }) {
  const isImage = a.contentType.startsWith("image/");
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 px-5 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-subtle">
        {isImage ? (
          <img src={`${a.url}?token=${getToken()}`} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText size={16} className="text-faint" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{a.filename}</span>
          {!a.referenced && <Badge tone="warn">未引用</Badge>}
        </div>
        <div className="truncate text-[11.5px] text-faint">
          {fmtBytes(a.size)} · {a.ownerName ?? "无归属"} · {fmtTime(a.createdAt)}
        </div>
      </div>
      <a
        href={`${a.url}?token=${getToken()}`}
        target="_blank"
        rel="noreferrer"
        title="下载"
        className="rounded-md p-1.5 text-faint hover:bg-subtle hover:text-ink"
      >
        <Download size={15} />
      </a>
      <button onClick={onDelete} title="删除" className="rounded-md p-1.5 text-faint hover:bg-subtle hover:text-danger">
        <Trash2 size={15} />
      </button>
    </motion.div>
  );
}
