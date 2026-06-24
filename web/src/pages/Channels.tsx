import { motion } from "framer-motion";
import { Hash, Plus, UsersRound, User as UserIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageLoader } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useData } from "@/lib/useData";
import { api, type Group, type Topic, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Subscribers {
  topic: string;
  users: { id: string; username: string }[];
  groups: { id: string; name: string }[];
}

export function Channels() {
  const toast = useToast();
  const topics = useData<{ topics: Topic[] }>("/api/v1/topics");
  const users = useData<{ users: User[] }>("/api/v1/users");
  const groups = useData<{ groups: Group[] }>("/api/v1/groups");

  const [selected, setSelected] = useState<string | null>(null);
  const [subs, setSubs] = useState<Subscribers | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  // Only real, admin-managed channels — hide internal inbox-/group-/dm- topics.
  const list = (topics.data?.topics ?? []).filter((t) => !t.system);
  useEffect(() => {
    if (!selected && list.length) setSelected(list[0].name);
  }, [list, selected]);

  async function loadSubs(topic: string) {
    setSubs(await api<Subscribers>("GET", `/api/v1/topics/${encodeURIComponent(topic)}/subscribers`));
  }
  useEffect(() => {
    if (selected) void loadSubs(selected);
  }, [selected]);

  async function createChannel() {
    const name = newName.trim();
    if (!name) return;
    // A topic is created the moment it has a subscriber; until then it's just a name.
    setSelected(name);
    setSubs({ topic: name, users: [], groups: [] });
    setCreating(false);
    setNewName("");
    setAdding(true);
  }

  async function addSubscriber(kind: "user" | "group", id: string, prio: number) {
    if (!selected || !id) return;
    try {
      await api("POST", `/api/v1/topics/${encodeURIComponent(selected)}/subscribers`, {
        [kind === "user" ? "userId" : "groupId"]: id,
        minPriority: prio,
      });
      toast("已加入频道", "success");
      await loadSubs(selected);
      topics.refetch();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function removeSubscriber(kind: "user" | "group", id: string) {
    if (!selected) return;
    await api("DELETE", `/api/v1/topics/${encodeURIComponent(selected)}/subscribers`, {
      [kind === "user" ? "userId" : "groupId"]: id,
    });
    await loadSubs(selected);
    topics.refetch();
  }

  if (topics.loading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="通知频道"
        subtitle="把用户或整个分组加入频道，之后发到该频道的消息他们都会收到"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={15} /> 新建频道
          </Button>
        }
      />

      {list.length === 0 && !subs ? (
        <EmptyState
          icon={<Hash size={28} />}
          title="还没有频道"
          hint="频道就是 ntfy 里的 topic。新建一个，把同事或分组加进来，往这个频道发消息即可。"
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={15} /> 新建频道
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <div className="space-y-1">
            {list.map((t) => (
              <button
                key={t.name}
                onClick={() => setSelected(t.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13.5px] transition-colors",
                  selected === t.name ? "bg-ink/[0.04] font-medium text-ink" : "text-muted hover:bg-subtle",
                )}
              >
                <Hash size={14} className="text-faint" />
                <span className="flex-1 truncate">{t.name}</span>
                <span className="text-[11px] text-faint">{t.userSubscribers + t.groupSubscribers}</span>
              </button>
            ))}
          </div>

          {selected && (
            <motion.div key={selected} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}>
              <Card>
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="flex items-center gap-2 text-[15px] font-semibold">
                    <Hash size={15} className="text-faint" />
                    {selected}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                    <Plus size={14} /> 添加订阅者
                  </Button>
                </div>
                <div className="p-5 space-y-5">
                  <Section
                    title="分组订阅"
                    icon={<UsersRound size={14} />}
                    empty="没有分组订阅这个频道"
                    items={(subs?.groups ?? []).map((g) => ({
                      key: g.id,
                      label: g.name,
                      onRemove: () => removeSubscriber("group", g.id),
                    }))}
                  />
                  <Section
                    title="用户订阅"
                    icon={<UserIcon size={14} />}
                    empty="没有用户单独订阅这个频道"
                    items={(subs?.users ?? []).map((u) => ({
                      key: u.id,
                      label: u.username,
                      onRemove: () => removeSubscriber("user", u.id),
                    }))}
                  />
                </div>
              </Card>
            </motion.div>
          )}
        </div>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="新建频道" description="给频道起一个 url 友好的名字">
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="disk-alerts"
            value={newName}
            onChange={(e) => setNewName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button size="sm" onClick={createChannel}>
              创建并添加订阅者
            </Button>
          </div>
        </div>
      </Dialog>

      <AddSubscriberDialog
        open={adding}
        onClose={() => setAdding(false)}
        users={users.data?.users ?? []}
        groups={groups.data?.groups ?? []}
        onAdd={addSubscriber}
      />
    </div>
  );
}

function Section({
  title,
  icon,
  items,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: { key: string; label: string; onRemove: () => void }[];
  empty: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-faint">
        {icon} {title}
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-faint">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <span
              key={it.key}
              className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-subtle px-2.5 py-1 text-[13px]"
            >
              {it.label}
              <button onClick={it.onRemove} className="text-faint hover:text-danger transition-colors">
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AddSubscriberDialog({
  open,
  onClose,
  users,
  groups,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  users: User[];
  groups: Group[];
  onAdd: (kind: "user" | "group", id: string, prio: number) => Promise<void>;
}) {
  const [kind, setKind] = useState<"user" | "group">("group");
  const [id, setId] = useState("");
  const [prio, setPrio] = useState(1);

  return (
    <Dialog open={open} onClose={onClose} title="添加订阅者" description="加入后，发到此频道的消息会推送给他们">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(["group", "user"] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setId("");
              }}
              className={cn(
                "rounded-md border px-3 py-2 text-[13px] font-medium transition-all",
                kind === k ? "border-ink bg-ink/[0.03]" : "border-border hover:border-neutral-300",
              )}
            >
              {k === "group" ? "分组" : "用户"}
            </button>
          ))}
        </div>
        <Select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">— 选择{kind === "group" ? "分组" : "用户"} —</option>
          {kind === "group"
            ? groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}（{g.members.length} 人）
                </option>
              ))
            : users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
        </Select>
        <div>
          <div className="mb-1.5 text-[12px] text-muted">最低优先级</div>
          <Select value={prio} onChange={(e) => setPrio(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                ≥ {p}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!id}
            onClick={async () => {
              await onAdd(kind, id, prio);
              setId("");
              onClose();
            }}
          >
            加入频道
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
