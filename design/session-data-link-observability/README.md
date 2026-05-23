# Claude 会话全链路数据观测（Session Data Link Observability）

本目录存放 Wise 在 **FCC（free-claude-code）直连** 场景下，从会话输入 → Claude Code 工具链 → 数据处理 → 大模型 HTTP（经 FCC/上游）的 **数据链路分析** 产品与工程方案。

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 链路分层、现有数据源、关联键模型、FCC 直连缺口与接入策略 |
| [EXECUTION-PLAN.md](./EXECUTION-PLAN.md) | 分阶段落地（统一时间线 → FCC HTTP → 分析视图）、验收标准 |
| [CURRENT-STATE.md](./CURRENT-STATE.md) | 与现有代码/路径对照表（工作轨迹、JSONL、LLM 代理、FCC 集成） |
| [LLM-PROXY-ANALYSIS.md](./LLM-PROXY-ANALYSIS.md) | 分析期用 LLM 代理上游=FCC 抓 HTTP |
| [FCC-TRACE-FORMAT.md](./FCC-TRACE-FORMAT.md) | `~/.fcc/traces/` 文件契约（Phase 2） |

## 问题陈述

产品目标：在 **不强制改用户「Claude → 本机 fcc-server 直连」习惯** 的前提下，仍能在 Wise 内 **回放、导出、分析** 整条链路，包括：

1. 用户输入与重发
2. Claude Code 协议事件（init、permission、stream-json）
3. 工具调用与结果（含 MCP / Skills / Hooks / 子代理 Task）
4. **发往 FCC 的 Anthropic 兼容 HTTP**（请求/响应摘要）
5. FCC → 上游 Provider 的转发（以 FCC 侧观测为准）

当前缺口：**第 4 层在 FCC 直连时 Wise 不在 HTTP 路径上**，无法自动关联到会话轮次。

## 与现有能力的关系

| 已有能力 | 覆盖层级 | 本方案关系 |
|----------|----------|------------|
| 会话消息 + `stream-json` 解析 | 1–3（运行时） | **保留**，作为时间线主数据源之一 |
| **工作轨迹**（`ClaudeSessionTrajectoryDrawer`） | 1–3（推断 + JSONL 补充） | **扩展**，替换合成 `api_request` 为真实 HTTP 节点 |
| `~/.claude/projects/.../*.jsonl` | 1–3（持久化事实） | **纳入**统一导出与时间线 |
| **LLM 代理**（`claude_llm_proxy`） | 4（仅经 Wise 代理时） | 分析期可选用；与直连并存需文档化 |
| **FCC 集成**（`free_claude_code`） | 安装/启停/settings | **扩展** FCC 请求日志 API 或文件契约 |
| Mission / Trellis `correlation_id` | 编排域事件 | **可选对齐**，不替代会话内 trace |

## 设计原则

1. **Claude 侧事实优先**：磁盘 JSONL + stream-json 为工具/hook 的权威来源；UI 内存消息为实时视图。
2. **HTTP 观测不伪造**：轨迹中的 `api_request` 在直连 FCC 时必须来自 FCC 日志或透明代理，禁止长期依赖「工具结果后的占位 REQUEST」。
3. **关联键显式化**：`claudeSessionId` + 轮次 + `tool_use_id` + `httpTraceId`（待建）贯穿导出与分析。
4. **不删既有路径**：LLM 代理、FCC Admin、外部抓包均保留；产品提供 **汇聚视图**，不强制单一路径。
5. **分层存储**：热数据（内存/事件）、温数据（JSONL tail）、冷数据（导出包）；HTTP trace 由 FCC 或 Wise DB 按契约写入。

## 一句话定位

> 在会话内提供 **可关联的全链路时间线**：用户与 Claude Code 的行为来自 JSONL/轨迹；模型 HTTP 来自 FCC trace（或分析期 LLM 代理）；一键导出供数据链路分析。

## 外部依赖

- [free-claude-code](https://github.com/jiaolong1021/free-claude-code)（`fcc-server`）：需在 Phase 2 约定 trace 输出形态（Admin API 或 `~/.fcc/logs/`）。
- Claude Code CLI：`stream-json` / 会话 JSONL 格式随版本演进，解析层需版本容忍。

## 状态

| 阶段 | 状态 |
|------|------|
| 方案文档（本目录） | 已定稿 |
| Phase 1 统一时间线 | **已落地**（`sessionLinkPipeline`、导出、工作轨迹导出、推断 HTTP 样式） |
| Phase 2 FCC HTTP | **Wise 侧已落地**（`list_fcc_traces` + `~/.fcc/traces/`）；FCC 写入待上游 |
| Phase 3 分析视图 | **部分落地**（轮次指标、过滤、元数据导出；用量交叉链待做） |
