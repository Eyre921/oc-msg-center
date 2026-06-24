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

- **ntfy 的开发体验**，但出口是 QQ / 微信而不是 App 推送 —— 国内运维更顺手。
- **复用现成轮子**：底层走 [openclaw-qqbot](https://github.com/Eyre921/openclaw-qqbot) /
  [openclaw-weixin](https://github.com/Eyre921/openclaw-weixin) 两个插件，QQ 协议、
  iLink 长轮询、扫码登录、CDN 文件加密……这些脏活都不用 oc-msg-center 重做一遍。
- **管理员驱动的订阅模型**：用户不能自助订阅，订阅与分组分配权全在管理员手里。
  扫完码用户只看到「✅ 已绑定」，等管理员把他加进对应分组就开始收消息。
- **反向通信**：用户在 QQ / 微信里发给机器人的消息、文件、语音，会被自动回传到
  消息中心，落到该用户的 inbox 主题，前端实时显示，也能通过 webhook 转出去。
- **Markdown / 富媒体**：在 QQ 下消息会被插件渲染为 Markdown（标题、列表、代码块），
  附件直接通过 CDN 下发；微信侧自动转换为图片 / 文件消息。
- **真·一条命令上车**：`docker compose up -d`。

## 🧱 架构

```
┌──────────────────────────┐    POST /api/v1/publish     ┌────────────────────┐
│  你的报警 / 脚本 / 系统    │ ──────────────────────────▶ │   oc-msg-center    │
└──────────────────────────┘                              │  (Fastify + SQLite)│
                                                          │  - users / groups   │
   QQ / WeChat 用户  ◀───┐                                │  - topics / subs    │
       │ 扫码 / 发消息    │                                │  - SSE / WS         │
       ▼                 │                                │  - outbound webhook │
┌──────────────────────────┐  POST /send (msg)            └─────────┬──────────┘
│ openclaw-qqbot  / weixin │ ◀───────────────────────────────────────┤
│  ┌─ bridge sidecar ─┐    │  POST /inbound (reverse msg)            │
│  │  - exposes /send │    │ ───────────────────────────────────────▶ │
│  │  - forwards      │    │                                          │
│  └──────────────────┘    │                                          │
└──────────────────────────┘                                          │
                                                                      ▼
                                                          ┌──────────────────────┐
                                                          │  你的运维同事 (浏览器)│
                                                          │  /web 管理台 + 实时流│
                                                          └──────────────────────┘
```

`oc-msg-center` 本身**不与 QQ / 微信直接通信**。所有出站消息通过一个轻量的桥接 sidecar
转给 openclaw 插件，反向同理。这样：

1. 升级 QQ / 微信 协议时，更新 openclaw 插件即可，center 不用改。
2. 你可以接入除 QQ / 微信 之外的任何渠道（Slack、企微、飞书、Telegram……），只要写一个
   同构的 bridge —— 协议见 [`docs/BRIDGE.md`](docs/BRIDGE.md)。

## 🚀 快速开始（Docker，纯本地）

最快验证安装：

```bash
git clone https://github.com/Eyre921/oc-msg-center.git
cd oc-msg-center
docker compose up -d
docker compose logs msg-center -f   # 留意打印出的随机 admin 密码
```

打开 <http://localhost:2586>，用 `admin` + 日志里那串随机密码登录。
此时只有一个 console 渠道，发布消息会打到容器日志里 —— 验证流程通了。

### 接入 QQ

1. 去 [QQ 开放平台](https://q.qq.com/) 创建机器人，拿到 **AppID** 和 **AppSecret**。
2. 复制 `.env.example` 为 `.env`，填入 `QQBOT_APPID` / `QQBOT_SECRET`。
3. 编辑 `channels.json`：

   ```json
   [
     {
       "id": "qqbot",
       "label": "QQ",
       "type": "webhook",
       "sendUrl": "http://qq-bridge:7081/send",
       "sendToken": "${QQ_SEND_TOKEN}",
       "inboundToken": "${QQ_INBOUND_TOKEN}"
     }
   ]
   ```

4. 在 `docker-compose.yml` 中取消 `qq-bridge` 服务的注释。
5. `docker compose up -d` 重启。

> 💡 **关于 AppID/Secret**：这是腾讯 QQ 开放平台对官方机器人接入的硬性要求，不存在
> 「跳过」的方案 —— openclaw-qqbot 也是同样的流程。**只填一次**，写在 `.env` 里。
> 你的运维同事不需要知道这对密钥；他们只扫码即可。

### 接入微信

1. 在 `docker-compose.yml` 中取消 `weixin-bridge` 服务的注释。
2. 第一次启动：`docker compose up weixin-bridge`（前台），扫描容器日志里的二维码。
3. 凭证落盘到卷里之后，正常 `docker compose up -d` 即可。

微信端用的是 openclaw-weixin 的扫码登录方案，**没有 AppID/Secret**。

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
