# 可执行方案：LLM 决策 → 工作流分支（Wise 落地）

本文在 `README.md` 架构原则之上，给出 **可按迭代交付** 的任务清单、验收标准与仓库内落点。执行顺序建议自上而下；每阶段结束应可独立演示或回滚。
方案默认前提：**不替换现有团队流程编排**，而是在当前 `App.tsx` 中围绕 `handleClaudeTurnComplete`、`decideWorkflowTaskStage`、`appendTaskEvent` 的路径上增量接入。

**前置阅读**：同目录 `README.md`；`design/workflow/workflow-event-contract.md`。

**与现状对齐**：下文「目标」表中的**目标列**仍是演进方向，不是「未打勾即不可用」。**当前已落地**的重点在 **团队任务执行链**：`handleClaudeTurnComplete` 绑定任务 → `task` / `approval`（含 `acceptance_enabled`）上 **`acceptanceVerdict.ts` 新方案门闸**（解析成功写 `verdict_submitted` 再 `decide`，失败写 `verdict_unresolved` 且不自动推进）→ `advanceWorkflowGraph` → **runtime 快照**；正文侧配合更长文本合并以降低截断。Schema 强校验、payload 哈希/幂等、Extractor 或 Tool、`wise.workflow.verdict.mode` 等按各阶段清单**迭代补齐**。

---

## 目标（可度量）

| 指标 | 当前基线 | 目标 |
|------|-----------|------|
| 验收自动推断 | 依赖正文解析 + 启发式 | **结构化 payload 校验通过** 后才调用 `decideWorkflowTaskStage` |
| 长文失效 | 尾窗/正则边界 | **决策与长文解耦**（tool 或二次短调用或仅认约束 JSON） |
| 可审计 | 部分在 runtime snapshot | **显式 verdict 事件**（`workflow_acceptance_verdict_submitted` / `workflow_acceptance_verdict_unresolved`，payload 含 schemaVersion、hash） |
| 团队流程融合 | 解析逻辑内联在回合完成回调 | **保持团队流程编排主干不变**，仅在验收决策入口增加契约门闸与事件化 |

---

## 与现有团队流程编排融合（关键约束）

1. **主编排不变**：继续由现有团队流程推进节点；本方案不引入第二套状态机。
2. **接入点固定**：仅在 `handleClaudeTurnComplete` 的验收判断段增加「结构化解析 + 校验 + 事件」。
3. **推进动作不变**：阶段推进仍走 `decideWorkflowTaskStage`，但前置条件从“启发式文本命中”升级为“契约校验通过”。
4. **可回滚**：通过 `wise.workflow.verdict.mode` 功能开关切回当前策略，避免影响团队流程日常使用。

---

## 现有代码映射表（按文件/函数）

| 目标 | 当前入口（现状） | 融合改造点（保持团队流程编排主干） |
|------|------------------|----------------------------------|
| 回合完成触发 | `src/App.tsx` -> `handleClaudeTurnComplete` | 在该函数内新增“结构化 verdict 门闸”调用，不改团队流程推进主链 |
| 文本决策解析 | **`src/services/workflow/acceptanceVerdict.ts`**（真源：`inferAcceptanceDecisionFromOutput` 及内部结构化/启发式解析） | `src/services/workflowGraphRuntime.ts` **仅再导出**同名 API（`inferAcceptanceDecisionFromOutput`、`WORKFLOW_ACCEPTANCE_VERDICT_KEY`、`AcceptanceDecision`）以保持旧 import 路径可用；**禁止**在 runtime 内再复制一套解析实现 |
| 阶段推进 | `src/services/workflowTasks.ts` -> `decideWorkflowTaskStage`（在 `App.tsx` 多处调用） | 调用点不换，只把触发前置条件改为“schema 校验通过” |
| 事件落库 | `src/services/workflowTasks.ts` -> `appendTaskEvent` | 新增 verdict 事件类型与 payload（P2），与现有 runtime snapshot 事件并行；事件名与 `src/constants/workflowEvents.ts` 保持一致 |
| 运行时展示 | `src/components/ClaudeSessions/WorkflowTaskTimeline.tsx` | 增加 verdict 事件展示（可选），便于审计与复盘 |
| 输出文本来源 | `src/services/claudeSessionState.ts` + `src/App.tsx` | 继续使用“更长文本优先”策略，仅作为解析输入，不直接决定分支 |

### 按映射执行顺序（建议）

1. ~~`workflowGraphRuntime.ts` 解析逻辑抽离~~（**已完成**）：验收文本解析唯一实现在 `workflow/acceptanceVerdict.ts`；`workflowGraphRuntime.ts` 只负责图推进与 `composeDispatchInput`，并对 verdict API 做 re-export。
2. `App.tsx::handleClaudeTurnComplete` 从 **`acceptanceVerdict.ts`** 取解析结果（解析失败则不自动推进；与 verdict 事件写入配合）。
3. `workflowTasks.ts::appendTaskEvent` 扩展 verdict 事件；`App.tsx` 在推进前先写 verdict 事件。
4. `WorkflowTaskTimeline.tsx` 增加 verdict 事件读展示（如需 UI 可观测）。

---

## 阶段 P0：契约冻结（0.5～1 天）

**交付物**

1. 在 `design/workflow/` 或本目录新增 **`verdict-payload.schema.json`**（或 TypeScript `type` + zod 定义二选一），字段最小集：
   - `schemaVersion: number`
   - `workflowAcceptanceVerdict: "approve" | "reject"`（与现有 `WORKFLOW_ACCEPTANCE_VERDICT_KEY` 对齐）
   - `taskId`, `nodeId`（或 `workflowTaskId` + `graphNodeId`，与现有运行时一致）
   - `rationale?: string`
2. 文档中写明：**仅当校验通过时** 才视为「系统可采纳的 verdict」。

**验收**

- [ ] Schema 有版本号；README 中示例与 schema 字段一致。
- [ ] 与 `composeDispatchInput` 中写给模型的示例 **字面键名一致**（避免 approve/reject 与 pass 混用未文档化）。

**落点**：仅文档 + 可选 `src/types/` 下小类型导出（若选 TS 为真源）。

---

## 阶段 P1：解析与分支解耦（1～2 天）

**问题（历史）**：`App.tsx` 中 `handleClaudeTurnComplete` 曾内联「取 output → 解析 → 自动 `decideWorkflowTaskStage`」。

**交付物（当前与后续）**

1. **`src/services/workflow/acceptanceVerdict.ts`（已实现为真源）**：导出 `inferAcceptanceDecisionFromOutput`、`WORKFLOW_ACCEPTANCE_VERDICT_KEY`、`AcceptanceDecision` 等；内部为 **约束 JSON 围栏** → **键名就近扫描** → **显式中文句** → **弱信号尾窗** 的组合（均为模块内私有实现，无第二份拷贝）。
2. **schema 门闸（已落地）**：已新增 `parseAcceptanceVerdictPayload(...)` / `validateWorkflowAcceptanceVerdictPayload(...)` / `resolveAcceptanceVerdictWithGate(...)`；流程为先 schema 校验（含 `taskId/nodeId` 绑定）后 inferred 回退。
3. `App.tsx` 从 **`acceptanceVerdict.ts`** 调用 `resolveAcceptanceVerdictWithGate(...)`，**禁止**在路由层再堆一套验收正则；并在 verdict 事件中记录 `acceptanceGate`。
4. 保留现有 `mergeAssistantPlainTextPreferLonger` 作为 **input 拼接策略**；解析失败路径明确：**不写 decide、打 trace log**（已有 `logWorkflowTrace` 可扩展）。

**验收**

- [x] `bun run build` 通过。
- [x] 单元测试：已覆盖 `parseAcceptanceVerdictPayload` / `resolveAcceptanceVerdictWithGate` 的核心路径（合法围栏 JSON、裸 approve 推断、解析失败），测试文件 `src/services/workflow/acceptanceVerdict.test.ts`。

**落点**：`src/App.tsx` + **`src/services/workflow/acceptanceVerdict.ts`**（真源）；`src/services/workflowGraphRuntime.ts` 仅 **re-export** 与派发模板共用的 `WORKFLOW_ACCEPTANCE_VERDICT_KEY` 等，**不得**再维护重复的解析函数体。

---

## 阶段 P2：显式事件 + 幂等键（2～3 天）

**交付物**

1. 在 `appendTaskEvent` 使用的 `eventType` 中新增两类：**`workflow_acceptance_verdict_submitted`**、**`workflow_acceptance_verdict_unresolved`**（名称与后端/DB 枚举对齐；若 Rust 侧枚举需同步，单列子任务）。
2. Payload 建议（与当前实现对齐）：
   ```json
   {
     "schemaVersion": 1,
     "taskId": "…",
     "graphNodeId": "…",
     "nodeId": "…",
     "workflowAcceptanceVerdict": "approve",
     "acceptanceGate": "schema",
     "source": "claude_turn_complete",
     "payloadSha256": "sha256(output)",
     "correlationId": "taskId|nodeId|payloadSha256"
   }
   ```
3. **幂等（已落地前后端双保险）**：同一 `(taskId, graphNodeId, correlationId)` 或 `payloadSha256` 重复提交时，不二次 `decideWorkflowTaskStage`。前端已做 guard；后端已通过 `011_task_event_acceptance_idempotency.sql` + `append_task_event` 约束冲突回收实现幂等返回。

**验收**

- [x] 时间线 / `WorkflowTaskTimeline` 可展示该事件（含 verdict 与 unresolved 事件）。
- [x] 前端已加入同轮重复 completion 幂等 guard（`correlationId` + `payloadSha256` + 事件查重），可避免二次阶段推进。
- [x] 后端已补唯一约束 + 冲突回收（`011` migration + `append_task_event` 幂等返回），跨进程重放不重复落同类 verdict 事件。

**落点**：`src/services/workflowTasks.ts`（`appendTaskEvent` 类型扩展）、`src/App.tsx`（写入时机/前端幂等 guard）、`src-tauri/migrations/011_task_event_acceptance_idempotency.sql`、`src-tauri/src/lib.rs::append_task_event`（约束冲突幂等回收）。

---

## 阶段 P3：决策与长文解耦（可选，3～5 天）

**优先级（默认 3A，3B 仅兜底）**

| 方案 | 优先级 | 适用 | 主要改动 |
|------|------|------|----------|
| **3A Tool Call / Structured Output** | **默认** | Claude API/通道可接工具参数或结构化输出 | Hook/CLI 侧接收 tool args（或结构化结果）并直过 schema 门闸；宿主只读机器可读参数驱动 `decide` |
| **3B 二次短调用 Extractor** | **兜底** | 暂时无法稳定接 Tool/Structured Output | 在 `handleClaudeTurnComplete` 末尾：若门闸失败且 `acceptance_enabled`，再发起一次极短 prompt（仅附「全文末 8k 字符」+ 固定指令）只收 JSON；有超时与次数上限 |

**验收**

- [ ] 主回复长度 **> 100k** 的 fixture 下，3A（Tool/Structured）可稳定产出 verdict；无法接 3A 时，3B 兜底同样稳定。
- [ ] 费用与延迟在文档中记录 **上限策略**（如每月 cap、仅验收节点启用）。

**落点**：`src/App.tsx`、可能 `src/services/claudeStreamRuntime.ts` / Tauri invoke 封装。

---

## 阶段 P4：默认安全策略 + 运维（1 天）

**交付物**

1. **解析失败**：不自动通过；选项：`idle` + 系统消息「需人工验收」或进入现有时间线「待操作」。
2. **功能开关**：如 `localStorage` 或应用设置 `wise.workflow.verdict.mode = heuristic|structured_only|structured_plus_extractor`。
3. **观测**：关键路径 `console` 或统一 logger 字段：`taskId`, `nodeId`, `schemaVersion`, `parseOk`, `latencyMs`。

**验收**

- [ ] 开关关闭时行为与线上一致（回归）。
- [ ] 失败路径用户可见说明，不出现静默卡死。

---

## 依赖与风险

| 风险 | 缓解 |
|------|------|
| Tauri / DB 事件枚举不同步 | P2 先改 TS 与文档，Rust 迁移单 PR |
| Vitest 未配置 | P1 末行加 `vitest` + `bun test` 一条 CI；或暂缓测试仅清单验收 |
| 二次调用成本 | 仅 `approval` + `acceptance_enabled` 节点启用 |

---

## 建议排期（单人粗略）

| 周 | 内容 |
|----|------|
| W1 | P0 + P1 + P2（核心可上线：事件 + 幂等 + 解析模块） |
| W2 | P3（若要做）+ P4 |

---

## 完成定义（Definition of Done）

- [ ] 至少 **P0～P2** 合并后，验收节点在「仅结构化 verdict」模式下可端到端跑通一条团队流程。
- [ ] 设计目录本方案与 `workflow-event-contract.md` 互链已更新（若新增 eventType，契约文档追加一节）。

---

## 立即下一步（复制到 issue 即可）

1. 开 issue：`feat(workflow): acceptance verdict schema + parse module + verdict event`。
2. 子任务：P0 schema 文件 → P1 **`acceptanceVerdict.ts`（解析真源）** + App 接线 → P2 eventType + 幂等 → P3 **3A Tool/Structured 默认接入**（3B 仅兜底）。
3. PR 拆分：文档与类型 → 纯解析模块 → App 与事件（避免单 PR 过大）。
