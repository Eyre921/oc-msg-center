import { motion } from "framer-motion";
import { Radio } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, setToken } from "@/lib/api";

export function Login({ onLogin }: { onLogin: (user: { username: string; role: string }) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: { username: string; role: string } }>("POST", "/api/v1/login", {
        username,
        password,
      });
      setToken(r.token);
      onLogin(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grain flex min-h-screen items-center justify-center bg-subtle/40 px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white shadow-pop">
            <Radio size={20} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">登录 OC Msg Center</h1>
          <p className="mt-1 text-[13px] text-muted">运维通知中心 · 管理控制台</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-6 shadow-card">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>用户名</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </div>
            <div>
              <Label>密码</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <div className="rounded-md bg-[#fdeced] px-3 py-2 text-[13px] text-danger">{error}</div>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "登录中…" : "登录"}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-[12px] text-faint">
          首次部署的随机密码会打印在容器日志里
        </p>
      </motion.div>
    </div>
  );
}
