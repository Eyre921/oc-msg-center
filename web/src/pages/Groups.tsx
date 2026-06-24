import { motion } from "framer-motion";
import { Plus, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageLoader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useData } from "@/lib/useData";
import { api, type Group, type User } from "@/lib/api";

export function Groups() {
  const toast = useToast();
  const { data, loading, refetch } = useData<{ groups: Group[] }>("/api/v1/groups");
  const users = useData<{ users: User[] }>("/api/v1/users");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api("POST", "/api/v1/groups", { name: name.trim(), description: desc || null });
      setName("");
      setDesc("");
      refetch();
      toast("分组已创建", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  async function addMember(groupId: string, userId: string) {
    if (!userId) return;
    await api("POST", `/api/v1/groups/${groupId}/members`, { userId });
    refetch();
  }
  async function removeMember(groupId: string, userId: string) {
    await api("DELETE", `/api/v1/groups/${groupId}/members/${userId}`);
    refetch();
  }
  async function delGroup(g: Group) {
    if (!confirm(`删除分组 ${g.name}？`)) return;
    await api("DELETE", `/api/v1/groups/${g.id}`);
    refetch();
  }

  if (loading) return <PageLoader />;
  const groups = data?.groups ?? [];

  return (
    <div>
      <PageHeader title="分组" subtitle="把同事编成组，按组群发或整组订阅频道" />

      <Card className="mb-5 p-4">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <Input placeholder="分组名（如 oncall-sre）" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-[160px]" />
          <Input placeholder="描述（可选）" value={desc} onChange={(e) => setDesc(e.target.value)} className="flex-1 min-w-[160px]" />
          <Button type="submit">
            <Plus size={15} /> 创建分组
          </Button>
        </form>
      </Card>

      {groups.length === 0 ? (
        <EmptyState icon={<UsersRound size={28} />} title="还没有分组" hint="创建一个分组，把同事加进来。" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g, i) => {
            const candidates = (users.data?.users ?? []).filter((u) => !g.members.find((m) => m.id === u.id));
            return (
              <motion.div key={g.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Card className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[14.5px] font-semibold">{g.name}</div>
                      {g.description && <div className="text-[12.5px] text-muted">{g.description}</div>}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => delGroup(g)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  <div className="my-3 flex flex-wrap gap-1.5">
                    {g.members.length === 0 && <span className="text-[13px] text-faint">空分组</span>}
                    {g.members.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-subtle px-2 py-0.5 text-[12.5px]">
                        {m.username}
                        <button onClick={() => removeMember(g.id, m.id)} className="text-faint hover:text-danger">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Select
                      defaultValue=""
                      onChange={(e) => {
                        addMember(g.id, e.target.value);
                        e.target.value = "";
                      }}
                      className="flex-1"
                    >
                      <option value="">＋ 添加成员…</option>
                      {candidates.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.username}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
