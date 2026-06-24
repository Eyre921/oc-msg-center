// Minimal admin UI. Talks to /api/v1/* with a token from /api/v1/login.
const state = { token: localStorage.getItem("msg_token") || null, user: null };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function setActiveTab(name) {
  $$("nav button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$("#appPane .tab").forEach((s) => (s.hidden = s.dataset.tab !== name));
  if (name === "overview") loadOverview();
  if (name === "users") loadUsers();
  if (name === "groups") loadGroups();
  if (name === "webhooks") loadHooks();
  if (name === "tokens") loadTokens();
}

async function api(method, path, body, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (state.token) headers["authorization"] = `Bearer ${state.token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !opts.noRedirect) {
    logout();
    throw new Error("未登录");
  }
  if (!res.ok) {
    let err = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      err = j.error ?? err;
    } catch {
      // not json
    }
    throw new Error(err);
  }
  return res.status === 204 ? null : res.json();
}

function logout() {
  localStorage.removeItem("msg_token");
  state.token = null;
  state.user = null;
  $("#nav").hidden = true;
  $("#appPane").hidden = true;
  $("#loginPane").hidden = false;
}

async function tryAutoLogin() {
  if (!state.token) return;
  try {
    const me = await api("GET", "/api/v1/me", undefined, { noRedirect: true });
    state.user = me.principal;
    showApp();
  } catch {
    logout();
  }
}

function showApp() {
  $("#loginPane").hidden = true;
  $("#appPane").hidden = false;
  $("#nav").hidden = false;
  setActiveTab("overview");
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await api("POST", "/api/v1/login", {
      username: fd.get("username"),
      password: fd.get("password"),
    });
    state.token = r.token;
    state.user = r.user;
    localStorage.setItem("msg_token", state.token);
    showApp();
  } catch (err) {
    alert("登录失败：" + err.message);
  }
});

$$("nav button[data-tab]").forEach((b) => b.addEventListener("click", () => setActiveTab(b.dataset.tab)));
$("#logoutBtn").addEventListener("click", logout);

async function loadOverview() {
  const box = $("#overviewBox");
  box.innerHTML = "loading…";
  const health = await fetch("/healthz").then((r) => r.json());
  const [users, groups, channels] = await Promise.all([
    api("GET", "/api/v1/users"),
    api("GET", "/api/v1/groups"),
    api("GET", "/api/v1/channels"),
  ]);
  box.innerHTML = `
    <div class="tile"><div class="k">用户</div><div class="v">${users.users.length}</div></div>
    <div class="tile"><div class="k">分组</div><div class="v">${groups.groups.length}</div></div>
    <div class="tile"><div class="k">已激活渠道</div><div class="v">${channels.channels.length}</div></div>
    <div class="tile"><div class="k">已绑定身份</div><div class="v">${users.users.reduce((n, u) => n + u.identities.length, 0)}</div></div>
  `;
  const sample = window.location.origin;
  $$("code").forEach((c) => { c.textContent = c.textContent.replace("{{base}}", sample); });
}

async function loadUsers() {
  const data = await api("GET", "/api/v1/users");
  const tbody = $("#usersTable tbody");
  tbody.innerHTML = "";
  for (const u of data.users) {
    const tr = document.createElement("tr");
    const idTags = u.identities.map((i) => `<span class="tag">${i.channel}: ${i.externalId.slice(0, 12)}…</span>`).join("");
    const groupTags = (u.groups || []).map((g) => `<span class="tag">${g}</span>`).join("");
    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${u.role}</td>
      <td>${idTags || '<span class="muted">未绑定</span>'}</td>
      <td>${groupTags || '<span class="muted">无</span>'}</td>
      <td>
        <button data-act="bind" data-id="${u.id}">生成绑定二维码</button>
        <button class="danger" data-act="del" data-id="${u.id}">删除</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === "del" && confirm("确认删除该用户？")) {
      await api("DELETE", `/api/v1/users/${id}`);
      loadUsers();
    }
    if (act === "bind") {
      const r = await api("POST", "/api/v1/bindings", { userId: id });
      renderBinding(r);
    }
  };
}

$("#newUserForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const username = fd.get("username");
  try {
    const r = await api("POST", "/api/v1/bindings", { username });
    renderBinding(r);
    loadUsers();
    e.target.reset();
  } catch (err) {
    alert(err.message);
  }
});

function renderBinding(r) {
  $("#bindBox").innerHTML = `
    <div class="qr">
      <img src="${r.qr}" alt="QR" />
      <div>
        <div>👤 用户：<b>${r.username}</b></div>
        <div>📜 让对方在 QQ / 微信 中向机器人发送：</div>
        <code>${r.sampleMessage}</code>
        <div class="muted">绑定码 ${Math.round((r.expiresAt * 1000 - Date.now()) / 60000)} 分钟内有效。绑定成功后机器人会回复欢迎语。</div>
      </div>
    </div>`;
}

async function loadGroups() {
  const [groupsResp, usersResp] = await Promise.all([
    api("GET", "/api/v1/groups"),
    api("GET", "/api/v1/users"),
  ]);
  const box = $("#groupsBox");
  box.innerHTML = "";
  for (const g of groupsResp.groups) {
    const div = document.createElement("div");
    div.className = "group-card";
    const memberTags = g.members.map((m) => `
      <span class="tag">
        ${m.username}
        <a href="#" data-act="rm" data-g="${g.id}" data-u="${m.id}" style="color:var(--danger);margin-left:4px;">×</a>
      </span>`).join("");
    const userOpts = usersResp.users
      .filter((u) => !g.members.find((m) => m.id === u.id))
      .map((u) => `<option value="${u.id}">${u.username}</option>`)
      .join("");
    div.innerHTML = `
      <h3>${g.name} <button class="danger" data-act="delgroup" data-g="${g.id}">删除分组</button></h3>
      <div class="muted">${g.description ?? ""}</div>
      <div class="members">${memberTags || '<span class="muted">空</span>'}</div>
      <form class="add" data-g="${g.id}">
        <select name="userId" required><option value="">添加成员…</option>${userOpts}</select>
        <button>添加</button>
      </form>`;
    box.appendChild(div);
  }
  box.onclick = async (e) => {
    const a = e.target.closest("[data-act]");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.act === "rm") {
      await api("DELETE", `/api/v1/groups/${a.dataset.g}/members/${a.dataset.u}`);
      loadGroups();
    } else if (a.dataset.act === "delgroup" && confirm("确认删除该分组？")) {
      await api("DELETE", `/api/v1/groups/${a.dataset.g}`);
      loadGroups();
    }
  };
  box.onsubmit = async (e) => {
    if (!e.target.matches("form.add")) return;
    e.preventDefault();
    const userId = new FormData(e.target).get("userId");
    if (!userId) return;
    await api("POST", `/api/v1/groups/${e.target.dataset.g}/members`, { userId });
    loadGroups();
  };
}

$("#newGroupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("POST", "/api/v1/groups", {
      name: fd.get("name"),
      description: fd.get("description") || null,
    });
    e.target.reset();
    loadGroups();
  } catch (err) {
    alert(err.message);
  }
});

$("#publishForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const targetType = fd.get("targetType");
  const target = fd.get("target");
  const payload = {
    title: fd.get("title") || null,
    body: fd.get("body"),
    priority: Number(fd.get("priority")),
    tags: (fd.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
  };
  if (targetType === "group") payload.group = target;
  else payload.topic = target;
  try {
    const r = await api("POST", "/api/v1/publish", payload);
    $("#publishResult").textContent = `✅ 已发送 msg id=${r.id} → 主题 ${r.topic}`;
  } catch (err) {
    $("#publishResult").textContent = "❌ " + err.message;
  }
});

async function loadHooks() {
  const data = await api("GET", "/api/v1/webhooks");
  const tbody = $("#hooksTable tbody");
  tbody.innerHTML = "";
  for (const h of data.webhooks) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${h.topic}</td><td><code>${h.url}</code></td><td>${h.secret ? "✓" : "—"}</td>
      <td><button class="danger" data-id="${h.id}">删除</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    await api("DELETE", `/api/v1/webhooks/${b.dataset.id}`);
    loadHooks();
  };
}
$("#newHookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await api("POST", "/api/v1/webhooks", {
    topic: fd.get("topic"),
    url: fd.get("url"),
    secret: fd.get("secret") || null,
  });
  e.target.reset();
  loadHooks();
});

async function loadTokens() {
  const data = await api("GET", "/api/v1/tokens");
  const tbody = $("#tokensTable tbody");
  tbody.innerHTML = "";
  for (const t of data.tokens) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t.label ?? ""}</td><td>${t.scopes.join(", ")}</td>
      <td>${t.lastUsedAt ? new Date(t.lastUsedAt * 1000).toLocaleString() : "未使用"}</td>
      <td><button class="danger" data-id="${t.id}">吊销</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    await api("DELETE", `/api/v1/tokens/${b.dataset.id}`);
    loadTokens();
  };
}
$("#newTokenForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const r = await api("POST", "/api/v1/tokens", { label: fd.get("label") || null });
  $("#newTokenOut").textContent = `🔑 ${r.token}  （此值仅显示一次）`;
  e.target.reset();
  loadTokens();
});

let streamEs = null;
$("#streamForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const topic = new FormData(e.target).get("topic");
  if (streamEs) streamEs.close();
  streamEs = new EventSource(`/${encodeURIComponent(topic)}/sse?token=${state.token}`);
  const out = $("#streamOut");
  out.textContent = `→ 监听 ${topic} …\n`;
  streamEs.addEventListener("message", (ev) => {
    try {
      const m = JSON.parse(ev.data);
      out.textContent += `[${new Date(m.createdAt * 1000).toLocaleTimeString()}] ${m.title ?? ""}\n${m.body}\n---\n`;
    } catch {
      out.textContent += ev.data + "\n";
    }
  });
});

tryAutoLogin();
