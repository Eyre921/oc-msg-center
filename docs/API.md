# API 速查

> **认证**：除特别说明外，所有 `/api/v1/*` 端点都需要 `Authorization: Bearer <TOKEN>`。
> Token 来源：
> - 通过 `POST /api/v1/login` 拿到的 session token
> - 通过 `POST /api/v1/tokens` 申请的长期 token
> - 部署期 `MSGCENTER_ADMIN_TOKEN`（管理员）

## 公开 / 客户端友好端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/healthz` | 健康检查 |
| `POST` | `/:topic` | 发布消息（ntfy 风格，body 可为 raw / json） |
| `GET` | `/:topic/sse` | Server-Sent Events 订阅 |
| `GET` | `/:topic/ws` | WebSocket 订阅 |
| `GET` | `/:topic/json` | 新行分隔 JSON 订阅 |
| `GET` | `/file/:id/:filename` | 公开下载附件 |

支持的请求头（POST `/:topic`，ntfy 兼容）：

| Header | 说明 |
|--------|------|
| `X-Title` | 消息标题 |
| `X-Priority` | 1–5 |
| `X-Tags` | 逗号分隔标签 |
| `X-Click` | 点击跳转 URL |
| `X-Attachment` | 已上传附件的 id |

## JSON 发布

`POST /api/v1/publish`

```jsonc
{
  "topic": "incidents",        // 必填二选一
  "group": "oncall-sre",       // 必填二选一（按分组群发）
  "title": "🔥 Prod down",
  "body": "primary lost quorum",
  "priority": 5,
  "tags": ["prod", "db"],
  "click": "https://dashboard/…",
  "attachmentId": "att_xxx",
  "channels": ["qqbot"]        // 强制只发到这些渠道（覆盖订阅偏好）
}
```

## 附件

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/files` | multipart/form-data，字段名 `file` |
| `POST` | `/api/v1/files/raw` | 原始字节；`X-Filename` 头给文件名 |

返回 `{ id, filename, size, contentType, url }`。把 `id` 放进发布请求的 `attachmentId`。

## 管理员

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/login` | 用户名+密码换 token |
| `GET` | `/api/v1/me` | 当前主体、身份、订阅、分组 |
| `GET` `POST` `DELETE` | `/api/v1/users[…]` | 用户 CRUD |
| `GET` `POST` `DELETE` | `/api/v1/groups[…]` | 分组 CRUD |
| `POST` `DELETE` | `/api/v1/groups/:id/members[…]` | 成员管理 |
| `POST` `DELETE` | `/api/v1/subscriptions` | 订阅分配 |
| `POST` `GET` | `/api/v1/bindings` `GET /api/v1/bindings/:code` | 绑定流程 |
| `GET` `POST` `DELETE` | `/api/v1/webhooks` | 出站 webhook |
| `GET` `POST` `DELETE` | `/api/v1/tokens` | API token |
| `GET` | `/api/v1/topics`  `/api/v1/channels` | 元信息 |

## 入站

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/channels/:id/inbound` | 桥接 sidecar 上报反向事件 |
