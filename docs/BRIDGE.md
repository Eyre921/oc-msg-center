# 桥接协议（Bridge Contract）

`oc-msg-center` 不直接和 QQ / 微信通话。它通过一个 **桥接 sidecar** 接入每种渠道。

**关键设计**：每个同事都有自己专属的机器人凭据（你自己一对 QQ + 微信，每个同事各一对），
所以桥接 sidecar 是 **每渠道一个进程**，但内部托管 **多个 bot account**。msg-center 通过
一个小小的「控制平面」把每个用户的凭据动态推送进去。

整个协议有 4 个端点。

---

## 1. 出站：center → bridge

```
POST <sendUrl>
Authorization: Bearer <sendToken>
Content-Type: application/json
```

```jsonc
{
  "target": {
    "channel": "qqbot",
    "accountId": "alice-qq",      // 哪个 bot 发出
    "externalId": "USER-OPENID"   // 谁来收（在该 bot 视角的 openid）
  },
  "message": {
    "id": "msg_xxx",
    "topic": "disk-alerts",
    "title": "🔥 Prod down",
    "body": "primary lost quorum",
    "priority": 5,
    "tags": ["prod", "db"],
    "click": "https://dashboard/…",
    "attachment": null
  }
}
```

bridge 应：
1. 调 `openclaw message send --channel <chan> --account <accountId> --target <ref> ...`。
2. 附件直接把 `attachment.url` 透传给 `--image / --file`。
3. 返回 `{ "ok": true, "remoteId": "<可选>" }`。

---

## 2. 入站：bridge → center

```
POST <baseUrl>/api/v1/channels/<channelId>/inbound
Authorization: Bearer <inboundToken>
Content-Type: application/json
```

```jsonc
{
  "accountId": "alice-qq",     // 哪个 bot 收到的
  "externalId": "USER-OPENID",
  "displayName": "张三",
  "text": "/whoami",
  "attachmentId": "att_xxx",
  "raw": { /* … */ }
}
```

响应：

```jsonc
{
  "userId": "u_xxx",
  "action": "bound|registered|command|message|ignored",
  "reply": "✅ 你已绑定…"
}
```

bridge 在拿到 `reply` 时应自己回发给同一个 `(accountId, externalId)`。

---

## 3. 控制平面：center → bridge（管理 bot 凭据）

每当管理员在 web admin 给某个同事添加 / 删除一个机器人时，msg-center 都会发：

```
POST <controlUrl>/bots
Authorization: Bearer <sendToken>
Content-Type: application/json
```

```jsonc
{
  "accountId": "alice-qq",
  "label": "Alice 的 QQ",
  "credentials": {
    "appId": "111…",          // QQ
    "secret": "abc…"
  }
}
```

bridge 应：
1. 调 `openclaw channels add --channel <chan> --account <accountId> --token "<appId>:<secret>"`。
2. 微信场景下 credentials 通常为空（用 `openclaw channels login --account` 弹 QR）。

`DELETE <controlUrl>/bots/<accountId>` 用来撤销，bridge 调相应 `openclaw channels remove`。

---

## 4. channels.json

```json
[
  {
    "id": "qqbot",
    "label": "QQ",
    "type": "webhook",
    "enabled": true,
    "sendUrl":    "http://qq-bridge:7081/send",
    "controlUrl": "http://qq-bridge:7081",
    "sendToken":    "shared-with-bridge",
    "inboundToken": "shared-with-bridge"
  },
  {
    "id": "weixin",
    "label": "微信",
    "type": "webhook",
    "enabled": true,
    "sendUrl":    "http://weixin-bridge:7082/send",
    "controlUrl": "http://weixin-bridge:7082",
    "sendToken":    "shared-with-bridge",
    "inboundToken": "shared-with-bridge"
  }
]
```

也可以用 `type: "console"` 加一个本地日志渠道用于开发。

---

## 5. 为什么要单独的桥接进程

不复用 openclaw-qqbot / openclaw-weixin 的 channel runtime 直接做协议是因为：

- **凭据隔离**：桥接 sidecar 只接受来自 msg-center 的命令；msg-center 才是凭据的
  权威源。把 AppID/Secret 写在 .env 里反而无法做到「一人一对」。
- **多账号路由**：openclaw 原生支持 multi-bot，桥接就是把这一能力暴露为 HTTP 控制面。
- **替换底层**：未来如果要从 openclaw CLI 切到其它实现（NoneBot / Mirai / 自研），只换
  bridge 就行，msg-center 一行代码不动。
