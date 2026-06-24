import { Plus, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageLoader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useData } from "@/lib/useData";
import { api, type Webhook } from "@/lib/api";

export function Webhooks() {
  const toast = useToast();
  const { data, loading, refetch } = useData<{ webhooks: Webhook[] }>("/api/v1/webhooks");
  const [topic, setTopic] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/api/v1/webhooks", { topic, url, secret: secret || null });
      setTopic("");
      setUrl("");
      setSecret("");
      refetch();
      toast("Webhook 已添加", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  async function del(id: string) {
    await api("DELETE", `/api/v1/webhooks/${id}`);
    refetch();
  }

  if (loading) return <PageLoader />;
  const hooks = data?.webhooks ?? [];

  return (
    <div>
      <PageHeader title="出站 Webhooks" subtitle="某个频道有新消息时，转发 POST 到你的 URL（可选 HMAC 签名）" />

      <Card className="mb-5 p-4">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <Input placeholder="频道 / 主题" value={topic} onChange={(e) => setTopic(e.target.value)} className="w-40" />
          <Input placeholder="https://example.com/hook" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 min-w-[200px]" />
          <Input placeholder="签名密钥（可选）" value={secret} onChange={(e) => setSecret(e.target.value)} className="w-44" />
          <Button type="submit">
            <Plus size={15} /> 添加
          </Button>
        </form>
      </Card>

      {hooks.length === 0 ? (
        <EmptyState icon={<WebhookIcon size={28} />} title="还没有 Webhook" hint="给某个频道挂一个出站 URL，消息会同步推过去。" />
      ) : (
        <Card className="divide-y divide-border">
          {hooks.map((h) => (
            <div key={h.id} className="flex items-center gap-3 px-5 py-3.5">
              <Badge tone="neutral">{h.topic}</Badge>
              <code className="flex-1 truncate text-[13px] text-muted">{h.url}</code>
              {h.secret && <Badge tone="success">已签名</Badge>}
              <Button size="icon" variant="ghost" onClick={() => del(h.id)}>
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
