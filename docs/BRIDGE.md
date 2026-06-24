# 桥接协议（Bridge Contract）

`oc-msg-center` 不直接和任何 IM 平台说话。每个渠道（QQ、微信、未来的 Slack / 飞书 / 自研系统）
都通过一个 **桥接 sidecar** 接入。桥接对外暴露 HTTP，对内调用具体平台的 SDK / CLI。

只要满足下面这两个 HTTP 端点，任何东西都能成为一个渠道。

---

## 1. 出站：center → bridge

`oc-msg-center` 决定要发消息时，会 POST 到桥接的 `sendUrl`：

```
POST <sendUrl>
Authorization: Bearer <sendToken>   ← 由 channels.json 中 sendToken 决定
Content-Type: application/json
```

请求体：

```jsonc
{
  "target": {
    "channel": "qqbot",
    "externalId": "OPENID-OF-RECIPIENT"
  },
  "message": {
    "id": "msg_xxx",
    "topic": "disk-alerts",
    "title": "🔥 Prod down",         // 可空
    "body": "primary lost quorum",   // 可空，可含 Markdown
    "priority": 5,
    "tags": ["prod", "db"],
    "click": "https://dashboard/…",  // 可空
    "attachment": null               // 或 { id, filename, contentType, size, url }
  }
}
```

桥接应：

1. 把 `message` 翻译成具体平台的消息（QQ 走 openclaw-qqbot 的 `message send`，微信同理）。
2. 若 `attachment.url` 不为空，先下载附件（msg-center 已经把文件挂在公网 URL 上）再以图片 /
   文件方式发送。Bridge 可以直接把 URL 透传给底层支持 URL 发送的接口。
3. 返回 `200 OK`：

   ```json
   { "ok": true, "remoteId": "platform-side message id (optional)" }
   ```

   或返回 `200` 带 `{ "ok": false, "error": "…" }`，center 会把这条投递记为失败。

如果桥接 20 秒内不响应，center 视为失败。

---

## 2. 入站：bridge → center

桥接每观察到一条 QQ / 微信用户发来的消息（含文本、文件、语音…）就 POST：

```
POST  <MSGCENTER_BASE_URL>/api/v1/channels/<channelId>/inbound
Authorization: Bearer <inboundToken>   ← 由 channels.json 中 inboundToken 决定
Content-Type: application/json
```

请求体：

```jsonc
{
  "externalId": "OPENID-OF-SENDER",
  "displayName": "张三",            // 可空
  "text": "/whoami",                // 可空
  "attachmentId": "att_xxx",        // 如果有文件，先 POST 到 /api/v1/files/raw 拿到 id
  "raw": { /* 原始事件，可选，仅供 debug */ }
}
```

响应：

```jsonc
{
  "userId": "u_xxx",                // 已知用户 / 新注册用户
  "action": "bound|registered|command|message|ignored",
  "reply": "✅ 你已绑定…"            // 若不为空，桥接应该把 reply 回发给 externalId
}
```

桥接的责任：

1. 上传附件：若用户发来了文件，先 `POST /api/v1/files/raw`（带 `X-Filename` 头与
   原始字节）拿到 `id`，把它放进 `attachmentId`。
2. 转发文本 + attachmentId。
3. 如果响应里 `reply` 字段非空，把它当作机器人对该用户的回复发回去（可调用自己的
   `/send` 出站逻辑实现）。

---

## 3. channels.json

部署侧用这份配置告诉 center「我有哪些桥接」：

```json
[
  {
    "id": "qqbot",
    "label": "QQ",
    "type": "webhook",
    "enabled": true,
    "sendUrl": "http://qq-bridge:7081/send",
    "sendToken": "share-this-with-the-bridge",
    "inboundToken": "share-this-with-the-bridge"
  },
  {
    "id": "weixin",
    "label": "微信",
    "type": "webhook",
    "enabled": true,
    "sendUrl": "http://weixin-bridge:7082/send",
    "sendToken": "…",
    "inboundToken": "…"
  }
]
```

也可用 `type: "console"` 跑一个本地打印渠道，方便开发时观察出站 payload。

---

## 4. 既然已经有 openclaw-qqbot / openclaw-weixin，为什么还要桥接？

`openclaw-qqbot` / `openclaw-weixin` 是 OpenClaw runtime 的渠道插件，假设你跑了一个完整
的 OpenClaw 进程。桥接 sidecar 解决的是「**把 OpenClaw 的 channel runtime 暴露成一个稳定
的 HTTP 契约**」—— 这样 msg-center 不需要：

- 依赖 OpenClaw SDK 的具体版本与内部 API；
- 关心 QQ open-platform AppID/Secret / 微信扫码 / token 刷新；
- 重新实现一遍 CDN 上传 / Ed25519 验签 / SILK 转码。

如果你的部署里**已经有一个独立的 OpenClaw 进程**（带 qqbot + weixin 渠道），直接把
桥接 sidecar 指向那个进程的 RPC / 自定义 HTTP 即可，不必跑两份。
