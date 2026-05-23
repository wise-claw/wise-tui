# 执行计划：会话全链路数据观测

分三阶段交付；每阶段可独立验收。依赖 [ARCHITECTURE.md](./ARCHITECTURE.md) 的关联键与数据源定义。

---

## Phase 1 — 统一时间线与导出（不依赖 FCC 改动）

**目标**：在现有工作轨迹与 JSONL 基础上，提供可导出的、带关联键的完整 **Claude 侧** 链路包；明确标注 HTTP 层「未观测」。

### 1.1 任务清单

| ID | 任务 | 层 | 验收 |
|----|------|-----|------|
| P1-1 | 定义 `SessionLinkRecord` 类型（`src/types/` 或 `src/types/sessionLink.ts`） | FE | 类型审查通过 |
| P1-2 | 实现 `buildSessionLinkRecords(messages, jsonlLines?)` 纯函数 | FE | 单测：user → tool → tool_result → assistant 顺序与 turnIndex |
| P1-3 | 合并 `parseTrajectoryJsonlSupplemental` 与消息事件，去重排序 | FE | 与 `buildTrajectorySequenceModel` 事件数一致或为其超集 |
| P1-4 | 合成 `api_request` 标记为 `observed: false` 或 `source: "inferred"` | FE | 轨迹/UI 虚线或文案「未捕获 HTTP」 |
| P1-5 | Tauri `export_session_link_bundle(claudeSessionId, repositoryPath, opts)` | Tauri | 返回 JSON 文件路径或字符串 |
| P1-6 | 工作轨迹抽屉：「导出链路包」按钮 + 元数据/全文模式 | FE | 导出文件可被 jq 解析 |
| P1-7 | 文档：分析期如何用 LLM 代理上游=FCC 临时抓 HTTP（链至 README） | Doc | README 链接有效 |

### 1.2 非目标（Phase 1）

- FCC trace IPC
- 第四泳道 FCC→上游

### 1.3 DoD

- [ ] 任选一会话可导出 JSON，含 ≥1 个 `user_input` 与 `tool_use`/`tool_result`
- [ ] 导出中 HTTP 层记录带 `observed: false`（若未开 LLM 代理且无 FCC trace）
- [ ] `bun test` 覆盖 `buildSessionLinkRecords` 核心路径

---

## Phase 2 — FCC HTTP trace 接入（FCC 直连）

**目标**：Claude → FCC 的 HTTP 进入统一时间线，并可与轮次/tool 对齐。

**前置**：与 [free-claude-code](https://github.com/jiaolong1021/free-claude-code) 约定 trace 契约（见 ARCHITECTURE §4.1）。若上游暂无 API，Wise 侧可先实现 **文件 tail** 解析 `~/.fcc/traces/`。

### 2.1 任务清单

| ID | 任务 | 层 | 验收 |
|----|------|-----|------|
| P2-0 | FCC 侧：trace 写入（文件或 Admin API） | FCC | 单次 `/v1/messages` 可查到 trace 条目 |
| P2-1 | `parse_fcc_trace_file` / `list_fcc_traces` Tauri 命令 | Tauri | 单测 + 手工：发一条 Claude 请求后出现 trace |
| P2-2 | `buildSessionLinkRecords` 合并 FCC traces，填充 `httpTraceId` | FE | 时间窗对齐单测 |
| P2-3 | 工作轨迹：真实 `http_request` / `http_response` 节点替换推断 REQUEST | FE | FCC 运行且对齐 settings 时可见 body 摘要 |
| P2-4 | 导出包 `sources.fccTraceCount > 0` | FE | 导出含 HTTP 记录且 `observed: true` |
| P2-5 | FCC 未运行 / 无 trace：降级文案与文档链接 | FE | 不报错，显示「启用 FCC trace」提示 |

### 2.2 DoD

- [ ] FCC 直连（未开 Wise LLM 代理）下，工作轨迹可见至少一条真实 HTTP 节点
- [ ] 同会话导出 JSON 中 HTTP 与 tool_use 可通过 `turnIndex` 或时间窗关联
- [ ] 不破坏现有 `apply_free_claude_code_claude_settings` 流程

---

## Phase 3 — 链路分析视图（产品化）

**目标**：面向数据链路分析的筛选、折叠、对比与可选 FCC→上游 层。

### 3.1 任务清单

| ID | 任务 | 验收 |
|----|------|------|
| P3-1 | 按轮次折叠时间线（手风琴：输入 → 工具 DAG → HTTP） | 单轮可展开/收起 |
| P3-2 | 过滤器：仅工具 / 仅错误 / 仅 HTTP / 含 hook | 过滤后导出一致 |
| P3-3 | 侧栏指标：轮次耗时、工具次数、HTTP 次数、估算 token（若 trace 提供） | 与会话列表无性能回归 |
| P3-4 | （可选）第四泳道或节点 detail 展示 FCC→upstream | FCC 提供 upstream 摘要时可见 |
| P3-5 | 与 `claude_code_usage` 交叉链接（同 session 费用） | 从轨迹跳转用量 popover |

### 3.2 DoD

- [ ] 产品/研发可用同一视图完成「从输入到模型请求」的排障故事（内部 demo）
- [ ] 大 JSONL tail（8k 行）下抽屉打开 < 2s（目标，可后续优化）

---

## 风险登记

| 风险 | 缓解 |
|------|------|
| FCC 无 trace API 延期 | Phase 1 先交付；Phase 2 用 LLM 代理作临时方案并文档化 |
| Claude JSONL 格式变更 | 解析器版本字段 + 宽松 unknown 行保留 |
| 导出含敏感信息 | 默认截断 + 导出确认 Modal |
| 时间窗对齐 HTTP 不准 | 优先对接 `anthropicRequestId`；UI 标明「推断关联」 |

---

## 建议排期（人周估算，供排期参考）

| 阶段 | 估算 | 依赖 |
|------|------|------|
| Phase 1 | 1–2 人周 | 无 |
| Phase 2 | 1–2 人周（Wise）+ FCC 侧 | P2-0 |
| Phase 3 | 1–2 人周 | Phase 2 建议完成 |

---

## 评审检查项

- [ ] 是否坚持 FCC 直连为生产默认（是 → 必须 Phase 2）
- [ ] trace 契约由 Wise fork FCC 还是上游合并
- [ ] 统一入口：仅扩展工作轨迹 vs 新建「链路分析」顶栏（默认前者）
