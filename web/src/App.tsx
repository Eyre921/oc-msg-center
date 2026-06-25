import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Sidebar, type PageId } from "@/components/Sidebar";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { Status } from "@/pages/Status";
import { InboxPage } from "@/pages/Inbox";
import { Conversations } from "@/pages/Conversations";
import { Channels } from "@/pages/Channels";
import { Compose } from "@/pages/Compose";
import { UsersPage } from "@/pages/Users";
import { Groups } from "@/pages/Groups";
import { Storage } from "@/pages/Storage";
import { Webhooks } from "@/pages/Webhooks";
import { Tokens } from "@/pages/Tokens";
import { api, clearToken, getToken } from "@/lib/api";
import { PageLoader } from "@/components/ui/misc";

const PAGES: Record<PageId, React.ComponentType> = {
  overview: Overview,
  status: Status,
  inbox: InboxPage,
  conversations: Conversations,
  compose: Compose,
  channels: Channels,
  users: UsersPage,
  groups: Groups,
  storage: Storage,
  webhooks: Webhooks,
  tokens: Tokens,
};

export default function App() {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [booting, setBooting] = useState(true);
  const [page, setPage] = useState<PageId>("overview");
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    (async () => {
      if (!getToken()) return setBooting(false);
      try {
        const me = await api<{ principal: { username: string; role: string } }>("GET", "/api/v1/me");
        setUser(me.principal);
      } catch {
        clearToken();
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    const load = () =>
      api<{ messages: unknown[] }>("GET", "/api/v1/inbox?limit=100")
        .then((r) => setInboxCount(r.messages.length))
        .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [user]);

  if (booting) return <div className="flex min-h-screen items-center justify-center"><PageLoader /></div>;
  if (!user) return <Login onLogin={setUser} />;

  const Active = PAGES[page];

  return (
    <div className="flex h-screen overflow-hidden bg-white text-ink font-sans antialiased">
      <Sidebar
        page={page}
        onNavigate={setPage}
        onLogout={() => {
          clearToken();
          setUser(null);
        }}
        username={user.username}
        inboxCount={inboxCount}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <Active />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
