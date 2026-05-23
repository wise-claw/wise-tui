# 现状基线（与仓库代码对齐）

本文记录 **2026-05** 时 Wise 已具备的观测能力，作为全链路方案的起点。实现前应以代码为准复核路径。

---

## 1. 链路分层与代码映射

| 层级 | 数据内容 | 主要代码 / 路径 | 可见性 |
|------|----------|-----------------|--------|
| L1 会话输入 | 用户 prompt、编辑重发 | `ClaudeChat` / `useClaudeSessions`；`buildSequenceEventsFromMessages` → `user_input` | UI 气泡 + 工作轨迹 |
| L2 Claude 协议 | init、permission、stream 事件 | `streamIngest.ts`、`claudeStreamRuntime.ts`；Hub 权限/提问 | 部分进 Hub；JSONL 更全 |
| L3 工具调用 | tool_use / tool_result | `claudeStreamAssembler.ts`、`parseClaudeSessionJsonlLines` | 气泡 + 轨迹 `TOOL_USE` / `TOOL_RESULT` |
| L4 Hooks / 子代理 | hook_response、Task | `parseTrajectoryJsonlSupplemental`；`ClaudeSessionTrajectoryDrawer` 子代理下钻 | 轨迹 + JSONL tail |
| L5 模型 HTTP → FCC | `/v1/messages` 等 | Claude 读 `~/.claude/settings.json` → `ANTHROPIC_BASE_URL` | **直连时 Wise 不可见** |
| L6 FCC → 上游 | Provider 调用 | `fcc-server`；Wise 仅 `open_free_claude_code_admin` | FCC Admin UI |

---

## 2. FCC 直连机制（Wise 侧）

- 配置：`~/.fcc/.env`（`PORT`、`ANTHROPIC_AUTH_TOKEN`、`MODEL` 等）
- 同步命令：`apply_free_claude_code_claude_settings` → 写入 `~/.claude/settings.json` 的 `env`
- 子进程：`configure_claude_child_process` 合并 env + `--settings` 临时文件
- 状态：`get_free_claude_code_status`（`proxyBaseUrl`、`claudeSettingsAligned` 等）

相关模块：

- `src-tauri/src/free_claude_code.rs`
- `src-tauri/src/claude_config_dir.rs`
- `src/services/freeClaudeCode.ts`
- `src/components/ClaudeSessions/FreeClaudeCodePanel.tsx`

**Wise 不代理 FCC 流量**，也 **无** `list_fcc_requests` 类 IPC。

---

## 3. 工作轨迹（半条链路）

入口：会话快捷操作 **「工作轨迹」** → `ClaudeSessionTrajectoryDrawer`。

- 事件模型：`src/utils/claudeSessionTrajectorySequence.ts`（`SequenceEventKind`）
- 三泳道：`user` | `claude_code` | `model`
- 磁盘补充：`loadClaudeSessionJsonl` tail 约 8000 行 → `parseTrajectoryJsonlSupplemental`

**局限**：

- `api_request` 为 **推断节点**（上一条为 tool_result 用户消息时插入），非真实 HTTP。
- 与 FCC 请求 **无 ID 关联**。

---

## 4. 会话 JSONL（Claude 侧事实源）

路径：`~/.claude/projects/<encoded>/<sessionId>.jsonl`

- 加载：`load_claude_session_jsonl`（`src-tauri/src/claude_commands/disk_sessions.rs`）
- 前端解析：`src/utils/claudeSessionJsonl.ts`
- 轨迹抽屉与「后台执行详情」等共用 tail 策略

包含：user/assistant 消息块、tool_result、部分 system/hook 行；**一般不包含** 完整 HTTP body。

---

## 5. LLM 代理（仅经 Wise 代理时可见 HTTP）

- 后端：`src-tauri/src/claude_llm_proxy.rs`（转发 + `ClaudeLlmProxyRecord`）
- 前端：`LlmProxyTrafficPanel`、`claudeLlmProxyStore`
- 注入：监听开启时 `claude_spawn_anthropic_base_url_override()` → 子进程 `ANTHROPIC_BASE_URL` 指向 Wise 本地端口；上游可配置为 `http://127.0.0.1:8082`（FCC）

**与 FCC 直连互斥**：settings 已指向 FCC 且未开 LLM 代理时，Claude 直连 FCC，代理面板无 HTTP 记录（仅有 `stream-json` stdout 兜底片段，见 `streamJsonLlmProxyIngest.ts`）。

---

## 6. 其它相关观测

| 能力 | 说明 |
|------|------|
| `claude_external_ingest` | 外部 CLI 会话 JSONL 解析（hooks、子代理生命周期） |
| `claude_code_usage` | 本机 JSONL 用量统计（ccusage 对齐），非 per-request trace |
| Trellis `correlation_id` | Mission/编排事件，非 Claude 会话 HTTP |
| `workflow.trace` localStorage | 工作流调试 trace，与会话链路独立 |

---

## 7. 缺口摘要（方案要补齐）

1. **L5 HTTP**：FCC 直连无 Wise 侧记录。
2. **关联键**：`messageId` / `tool_use_id` 与 HTTP trace 未打通。
3. **汇聚 UI**：轨迹、JSONL、LLM 代理、FCC 分属不同入口。
4. **导出**：无标准「会话链路包」格式供外部分析工具消费。

详见 [ARCHITECTURE.md](./ARCHITECTURE.md) 与 [EXECUTION-PLAN.md](./EXECUTION-PLAN.md)。
