# FCC Trace 文件契约（Wise 读取）

Wise 通过 Tauri 命令 `list_fcc_traces` 扫描：

```text
~/.fcc/logs/server.log          # FCC 运行时 TRACE 行（主数据源，按 request_id 聚合）
~/.fcc/traces/<YYYY-MM-DD>/*.json
~/.fcc/traces/**/*.jsonl
```

`server.log` 中关注 `event`：`api.request.received`（`snapshot` → 请求体）、`provider.request.sent`（`body` → 上游）、`api.response.stream_completed`（流式元数据 → 响应摘要）。

## 单条记录 JSON 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 否 | 缺省为文件名 + 序号 |
| `timestampMs` | number | 是 | Unix 毫秒 |
| `method` | string | 否 | 默认 `POST` |
| `path` | string | 否 | 默认 `/v1/messages` |
| `statusCode` | number | 否 | HTTP 状态 |
| `durationMs` | number | 否 | 耗时 |
| `model` | string | 否 | 模型 id |
| `requestPreview` | string | 否 | 请求体摘要（建议 ≤24KB） |
| `responsePreview` | string | 否 | 响应体摘要 |
| `sessionHint` | string | 否 | Claude `session_id` 片段，用于过滤 |
| `anthropicRequestId` | string | 否 | 请求 id |
| `upstreamPreview` | string | 否 | FCC→上游摘要；有则生成 `fcc_upstream` 链路节点 |

文件可为 **单个对象**、**对象数组**，或 **JSONL**（每行一条）。

## 示例

```json
{
  "id": "trace-001",
  "timestampMs": 1716451200000,
  "method": "POST",
  "path": "/v1/messages",
  "statusCode": 200,
  "durationMs": 3200,
  "model": "claude-sonnet-4-20250514",
  "sessionHint": "abcd1234",
  "requestPreview": "{\"model\":\"...\"}",
  "responsePreview": "{\"type\":\"message\",...}"
}
```

## IPC

```typescript
listFccTraces({ sinceMs?, limit?, sessionHint? }): FccTraceEntry[]
```

`sessionHint` 与 `sessionHint` / `anthropicRequestId` 字段做子串匹配。
