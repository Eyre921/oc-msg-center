import { motion } from "framer-motion";
import { Inbox as InboxIcon, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, EmptyState, PageLoader } from "@/components/ui/misc";
import { useData } from "@/lib/useData";
import { fmtTime } from "@/lib/utils";
import type { Message } from "@/lib/api";

export function InboxPage() {
  const { data, loading, refetch } = useData<{ messages: Message[] }>("/api/v1/inbox?limit=200");

  useEffect(() => {
    const t = setInterval(refetch, 15000);
    return () => clearInterval(t);
  }, [refetch]);

  const messages = data?.messages ?? [];

  return (
    <div>
      <PageHeader
        title="收件箱"
        subtitle="同事直接发给机器人的消息，统一汇总在这里"
        actions={
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} /> 刷新
          </Button>
        }
      />
      {loading ? (
        <PageLoader />
      ) : messages.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={28} />}
          title="还没有反向消息"
          hint="当同事在 QQ / 微信 里直接给自己的机器人发消息时，会出现在这里。"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {messages.map((m, i) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="flex items-start gap-3.5 px-5 py-3.5 hover:bg-subtle/50 transition-colors"
              >
                <Avatar name={m.fromUser?.username ?? m.sender ?? "?"} className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium">{m.fromUser?.username ?? m.sender ?? "未知"}</span>
                    {m.tags
                      .filter((t) => t !== "inbound")
                      .map((t) => (
                        <Badge key={t} tone="neutral">
                          {t}
                        </Badge>
                      ))}
                    <span className="ml-auto text-[11.5px] text-faint">{fmtTime(m.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] text-ink/90">
                    {m.body || <span className="text-faint">（无文本，可能是文件/媒体）</span>}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
