import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageLoader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useData } from "@/lib/useData";
import { api, type ApiToken } from "@/lib/api";
import { fmtTime } from "@/lib/utils";

export function Tokens() {
  const toast = useToast();
  const { data, loading, refetch } = useData<{ tokens: ApiToken[] }>("/api/v1/tokens");
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ token: string }>("POST", "/api/v1/tokens", { label: label || null });
      setFresh(r.token);
      setLabel("");
      refetch();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  async function del(id: string) {
    await api("DELETE", `/api/v1/tokens/${id}`);
    refetch();
  }

  if (loading) return <PageLoader />;
  const tokens = data?.tokens ?? [];

  return (
    <div>
      <PageHeader title="API Token" subtitle="给脚本 / 监控系统用的推送凭据" />

      <Card className="mb-5 p-4">
        <form onSubmit={create} className="flex gap-2">
          <Input placeholder="标签（如 prometheus）" value={label} onChange={(e) => setLabel(e.target.value)} className="flex-1" />
          <Button type="submit">
            <Plus size={15} /> 生成
          </Button>
        </form>
        {fresh && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[#f7e2b5] bg-[#fef9ed] px-3 py-2.5">
            <KeyRound size={15} className="text-warn shrink-0" />
            <code className="flex-1 truncate text-[13px]">{fresh}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(fresh);
                toast("已复制", "success");
              }}
            >
              <Copy size={13} /> 复制
            </Button>
          </div>
        )}
        {fresh && <p className="mt-1.5 text-[12px] text-faint">此值仅显示一次，请立即保存。</p>}
      </Card>

      {tokens.length === 0 ? (
        <EmptyState icon={<KeyRound size={28} />} title="还没有 Token" hint="生成一个 token，脚本即可 curl 推送。" />
      ) : (
        <Card className="divide-y divide-border">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3.5">
              <span className="text-[13.5px] font-medium">{t.label || "（未命名）"}</span>
              <div className="flex gap-1">
                {t.scopes.map((s) => (
                  <Badge key={s} tone="neutral">
                    {s}
                  </Badge>
                ))}
              </div>
              <span className="ml-auto text-[12px] text-faint">
                {t.lastUsedAt ? `最近使用 ${fmtTime(t.lastUsedAt)}` : "未使用"}
              </span>
              <Button size="icon" variant="ghost" onClick={() => del(t.id)}>
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
