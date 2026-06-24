<div align="center">

# OC Msg Center

**自托管的通知中心，把 QQ / 微信 当作消息渠道。**

为运维团队（也包括你自己）做的、可一键 docker 部署的小型 ntfy 替代品。
扫码绑定 → 管理员把人加入分组 → 任何脚本/系统 `curl` 一下就能推送到所有人的 QQ / 微信。
对话回传、文件传输、Markdown 渲染、外发 Webhook、SSE/WebSocket 实时流，全部支持。

[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js->=20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## ✨ 为什么是它

- **每人一对机器人**：自己一对（QQ + 微信），每个同事各一对。msg-center 帮你统一管理
  N 副凭据 —— web UI 一个一个加，不需要谁去手抄 AppID/Secret。
- **ntfy 的开发体验**，但出口是 QQ / 微信而不是 App 推送 —— 国内运维更顺手。
- **复用现成轮子**：底层走 [openclaw-qqbot](https://github.com/Eyre921/openclaw-qqbot) /
  [openclaw-weixin](https://github.com/Eyre921/openclaw-weixin) 两个插件，QQ 协议、
  iLink 长轮询、扫码登录、CDN 文件加密…… 这些脏活都不用 oc-msg-center 重做一遍。
- **管理员驱动的订阅模型**：用户不能自助订阅；订阅、分组、机器人凭据，全由管理员分配。
  绑定完成后对方只看到「✅ 已绑定」，等管理员把他加进对应分组就开始收消息。
- **反向通信**：同事在自己的 QQ / 微信里发给机器人的消息、文件、语音，会被自动回传到
  消息中心，落到该用户的 inbox 主题，前端实时显示，也能通过 webhook 转出去。
- **Markdown / 富媒体**：在 QQ 下消息会被插件渲染为 Markdown（标题、列表、代码块），
  附件直接通过 CDN 下发；微信侧自动转换为图片 / 文件消息。
- **真·一条命令上车**：`docker compose up -d`。

## 🧱 架构

```
   ┌──────────────────  单个容器  ──────────────────────────────────┐
   │                                                                  │
   │    msg-center (Fastify + SQLite)                                 │
   │       ↑                                                          │
   │       │ 读取/管理：users · bots · groups · topics · messages    │
   │       │                                                          │
   │       ├── 出站：spawn `openclaw message send --account X ...`   │
   │       ├── 凭据：spawn `openclaw channels add --account X ...`   │
   │       └── 入站：openclaw forward-skill POST 127.0.0.1:2586     │
   │                                ↑                                 │
   │       openclaw gateway (受 msg-center 监管的子进程，崩了自动重拉)│
   │       托管 N 个 QQ accounts + N 个 微信 accounts                 │
   │                                ↑                                 │
   └────────────────────────────────│─────────────────────────────────┘
                                    │
                            Alice 的 QQ bot · Alice 的微信 bot
                            Bob 的 QQ bot   · Bob 的微信 bot
                                  ......
```

- 同事 A、B、C 各自的 QQ + 微信 机器人凭据全部由 msg-center 集中管理，互不相干。
- openclaw runtime 内嵌为子进程，msg-center 是它的 supervisor —— 崩了会按指数退避重拉。
- 凭据不放 env，全部 web UI 一个一个加，落到本地 SQLite。
- 想换底层（不用 openclaw）？看 [`docs/BRIDGE.md`](docs/BRIDGE.md) 的 webhook bridge 协议
  —— msg-center 同时支持外部 bridge 渠道类型。

## 🚀 拿来就能用

> **镜像源**：当前镜像托管在 CNB **私有** registry，需要先 `docker login docker.cnb.cool`
> （用你的 CNB 账号）。CNB 仓库公开化或镜像同步到 ghcr.io / Docker Hub 是后续 TODO。

### 方式 A：docker compose（推荐）

```bash
mkdir oc-msg-center && cd oc-msg-center
curl -O https://raw.githubusercontent.com/Eyre921/oc-msg-center/main/docker-compose.yml
docker login docker.cnb.cool         # 首次拉私有镜像
docker compose up -d
docker compose logs msg-center -f    # 留意打印出的随机 admin 密码
```

打开 <http://localhost:2586>，用 `admin` + 日志里那串随机密码登录即可。

### 方式 B：单容器 `docker run`

```bash
docker login docker.cnb.cool
docker run -d --name oc-msg-center \
  -p 2586:2586 \
  -v msgcenter-data:/data \
  -v openclaw-data:/root/.openclaw \
  -e MSGCENTER_ADMIN_PASSWORD=your-pw \
  --pull always \
  docker.cnb.cool/lib/clawify:latest
```

### 💾 数据持久化

| 卷 | 容器内路径 | 保存什么 |
|---|---|---|
| `msgcenter-data` | `/data` | SQLite 数据库（用户/分组/订阅/消息）、附件 |
| `qq-bridge-data` | `/root/.openclaw` | QQ 多 bot 的 token 缓存、openclaw 插件状态 |
| `weixin-bridge-data` | `/root/.openclaw` | 微信扫码登录后的会话凭据 |

升级镜像（`docker compose pull && docker compose up -d`）或重启容器不会丢数据；只有
`docker compose down -v` 才会清掉命名卷。**生产部署务必 backup 这三个卷**。

### 为同事 A 加 QQ 机器人

1. 用同事 A 的 QQ 号登录 [QQ 开放平台](https://q.qq.com/)，创建一个机器人，拿到
   **AppID** / **AppSecret**。这一步和 openclaw-qqbot 的流程完全一样，没有捷径 ——
   腾讯就是要求每个 bot 有自己的一对 key。
2. 打开 msg-center 管理台 → **用户** → 找到 A → **+ 添加机器人** → 选「QQ」→ 填一个唯一
   的 `accountId`（如 `alice-qq`） + AppID + AppSecret → 创建。
3. msg-center 会把这副凭据 POST 到 qq-bridge，bridge 调 `openclaw channels add
   --account alice-qq --token ...`，状态变为 **active**。
4. 同行 A 拿手机 QQ 把刚创建的机器人加为好友。点 **生成绑定码** → 把 8 位码发给他 ——
   他用自己 QQ 给那个 bot 发一句 `BIND XXXXXXXX`，瞬间绑定完成。

为同事 B、C…… 各重复一次，每人一对独立凭据。

### 为同事 A 加微信机器人

1. 管理台 → 用户 → A → **+ 添加机器人** → 选「微信」→ 起个 `accountId`（如 `alice-wx`）→ 创建。
2. 在 weixin-bridge 容器日志里会出现一个二维码 —— 让 A 用自己手机微信扫码登录这个专属机器人。
3. 凭据自动落盘到卷里，状态变为 **active**。生成绑定码、A 发回 `BIND XXXXXXXX` —— 完。

> 💡 微信侧没有 AppID/Secret，纯扫码登录，靠 openclaw-weixin 的 iLink 长轮询协议。

## 🧑‍💼 给运维同事用

### 让一个新同事接入

1. 登录管理台 → 「用户」 → 输入对方名字 → **生成绑定二维码**。
2. 把 8 位绑定码（或二维码截图）发给他。
3. 他在 QQ / 微信里给机器人发一句 `BIND <8位码>`，机器人立即回复欢迎语，绑定完成。
4. 在「分组」里把他加进 `oncall-sre`、`db-team` 之类的分组。从此他就会收到这些分组的
   广播。

### 发一条消息

任何脚本都能推送，**和 ntfy 兼容**：

```bash
# 简单文本，广播到主题 disk-alerts 的所有订阅者
curl -d "/var 90% used on node-3" http://msg-center:2586/disk-alerts

# 带标题 / 优先级 / 标签
curl \
  -H "X-Title: 🔥 Prod down" -H "X-Priority: 5" -H "X-Tags: prod,db" \
  -d "primary lost quorum" \
  http://msg-center:2586/incidents

# Markdown 正文 + 直接广播到一个分组（管理员功能）
curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "group": "oncall-sre",
       "title": "夜班接班",
       "body": "**值班：张三**\n\n- API 错误率 0.2%\n- 备库延迟 2s",
       "priority": 4
     }' \
     http://msg-center:2586/api/v1/publish

# 带附件（先上传，再发布带 attachmentId 的消息）
ATT=$(curl -s -H "Authorization: Bearer $TOKEN" \
        -H "X-Filename: deploy.log" \
        --data-binary @./deploy.log \
        http://msg-center:2586/api/v1/files/raw | jq -r .id)

curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"topic\":\"deploys\", \"body\":\"deploy 完成\", \"attachmentId\":\"$ATT\"}" \
     http://msg-center:2586/api/v1/publish
```

### 实时订阅（前端 / 调试 / 集成）

| 方式             | URL                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| Server-Sent      | `GET /:topic/sse`                                                      |
| WebSocket        | `GET /:topic/ws`                                                       |
| Newline-JSON     | `GET /:topic/json`（curl 友好）                                        |
| 出站 Webhook     | 管理台「Webhooks」 → 每条新消息会 POST 到你的 URL，可选 HMAC-SHA256 签名 |
| 历史回放         | `GET /api/v1/topics/:topic/messages?since=<ts>&limit=…`               |

### 反向接收（用户发回来的消息 / 文件）

用户在 QQ / 微信里直接发给机器人的任何消息（包括文件、语音、图片），都会被
- 自动转录为一条消息发布到主题 `inbox-<userId>` 上，可以在 SSE / WS / Webhook 里订阅；
- 文件附件通过 CDN 下载，落盘到 `attachments` 卷，并附在消息的 `attachmentId` 上。

斜杠指令：用户发送 `/help` `/whoami` `/subs` `/groups` 会得到只读信息回复。
**不支持自助订阅** —— 订阅由管理员统一分配，这是产品设计上的硬约束。

## ⚙️ 配置

所有配置通过环境变量。常用项：

| 环境变量 | 默认 | 说明 |
| -------- | ---- | ---- |
| `MSGCENTER_PORT` | `2586` | HTTP 监听端口 |
| `MSGCENTER_BASE_URL` | `http://localhost:2586` | 对外公开的 URL（用于 QR / 附件链接） |
| `MSGCENTER_DATA_DIR` | `./data` | SQLite 库与附件目录 |
| `MSGCENTER_ADMIN_USERNAME` | `admin` | 管理员登录名 |
| `MSGCENTER_ADMIN_PASSWORD` | (随机) | 不设则首启动生成并打印 |
| `MSGCENTER_ADMIN_TOKEN` | — | 无密码的管理员 bearer token |
| `MSGCENTER_CHANNELS_FILE` | — | 渠道配置 JSON 文件路径 |
| `MSGCENTER_CHANNELS` | — | 同上，但以 JSON 字符串内联 |
| `MSGCENTER_AUTH_PUBLISH` | `false` | 是否要求登录才能 POST `/:topic` |
| `MSGCENTER_CHANNEL_AUTO_REGISTER` | `true` | 未知用户首次发消息时自动建账 |
| `MSGCENTER_WELCOME_MESSAGE` | （内置中文） | 绑定成功后回给用户的话 |
| `MSGCENTER_MESSAGE_TTL_SECONDS` | `43200` | 消息保留 12 小时 |
| `MSGCENTER_ATTACHMENT_TTL_SECONDS` | `259200` | 附件保留 3 天 |
| `MSGCENTER_BINDING_TTL_SECONDS` | `600` | 绑定码 10 分钟过期 |
| `MSGCENTER_ATTACHMENT_MAX_BYTES` | `104857600` | 单文件 100MB |

完整 API 见 [`docs/API.md`](docs/API.md)，桥接协议见 [`docs/BRIDGE.md`](docs/BRIDGE.md)。

## 🛠️ 本地开发

```bash
npm install
npm run dev          # tsx watch
npm test             # vitest
npm run typecheck    # tsc --noEmit
```

直接运行不需要构建步骤；生产环境也是 `tsx src/index.ts` 跑 TypeScript。

## 📄 License

MIT
