# 任务拆解（可并行）：团队流程编排融合版

本文是 `EXECUTION-PLAN.md` 的执行层拆解，面向“多人并行开发 + 快速合并”。

适用前提：继续使用现有 **团队流程编排主链**（`handleClaudeTurnComplete` -> `decideWorkflowTaskStage`），本拆解只做增量融合。

---

## 并行任务总览

| 任务 | 目标 | 预计工时 | 依赖 | 产出 |
|------|------|----------|------|------|
| T1 契约与类型 | 冻结 verdict 契约，统一字段与版本 | 0.5 天 | 无 | schema/type 文档与示例 |
| T2 解析模块化 | 验收解析真源在 `acceptanceVerdict.ts`（`App.tsx` 不堆正则）；补 schema 门闸与单测 | 1 天 | T1 | `acceptanceVerdict.ts` + 测试 |
| T3 编排接线与事件化 | 在团队流程编排入口接入门闸与 verdict 事件 | 1～1.5 天 | T1 + T2 | `App.tsx` + `appendTaskEvent` 扩展 |
| T4 展示与回归 | 时间线可见、回归脚本、开关验证 | 0.5～1 天 | T3 | UI 展示与测试清单 |
| T5 Tool/Structured 接入 | 按默认主路径接入 Tool Call/Structured Output（3A），Extractor 仅兜底 | 1～2 天 | T2 + T3 | D1 主路径落地与回退策略 |

---

## T1：契约与类型

### 范围

- 新增 `verdict-payload.schema.json`（或 zod/TS type 等价方案）
- 明确字段：
  - `schemaVersion`
  - `workflowAcceptanceVerdict` (`approve` / `reject`)
  - `taskId`
  - `nodeId`
  - `rationale?`

### 文件建议

- `design/llm-structured-decision-pipeline/verdict-payload.schema.json`
- `design/llm-structured-decision-pipeline/EXECUTION-PLAN.md`（引用说明）

### 验收

- [ ] 契约字段与 `composeDispatchInput` 示例一致。
- [ ] 明确“系统仅采纳校验通过 payload”。

---

## T2：解析模块化（保持团队流程不变）

### 范围

- **`src/services/workflow/acceptanceVerdict.ts` 为解析真源**（已实现）：导出 `inferAcceptanceDecisionFromOutput`、`WORKFLOW_ACCEPTANCE_VERDICT_KEY`、`AcceptanceDecision` 等；所有验收文本解析逻辑只维护于此文件。
- **schema 门闸已实现**：`parseAcceptanceVerdictPayload(...)`、`validateWorkflowAcceptanceVerdictPayload(...)`、`resolveAcceptanceVerdictWithGate(...)` 已落在同一文件（先 schema、后 inferred 回退）。
- **`workflowGraphRuntime.ts` 不再持有解析实现**：仅 `import` 派发提示所需的 `WORKFLOW_ACCEPTANCE_VERDICT_KEY`，并对 `inferAcceptanceDecisionFromOutput` / 类型 / 常量做 **re-export**，避免旧路径 import 断裂。

### 文件建议

- `src/services/workflow/acceptanceVerdict.ts`（真源）
- `src/services/workflowGraphRuntime.ts`（图运行时 + **仅 re-export**，无重复解析体）
- `src/services/workflow/acceptanceVerdict.test.ts`（若当前无测试框架，则先补手测清单）

### 验收

- [x] 解析模块单测覆盖：合法 JSON、裸值、解析失败（`src/services/workflow/acceptanceVerdict.test.ts`）。
- [x] `App.tsx` 不再直接堆叠解析正则（改为 `resolveAcceptanceVerdictWithGate(...)`）。

---

## T3：团队流程编排接线 + 事件化

### 范围（关键）

- 接入点固定在 `App.tsx::handleClaudeTurnComplete`
- 流程变更为：
  1. 读取 output（保留“更长文本优先”）
  2. 调用 **`src/services/workflow/acceptanceVerdict.ts`** 的解析 API（当前为 `resolveAcceptanceVerdictWithGate`：先 schema 门闸，后 inferred 回退）
  3. 解析成功 -> 先 `appendTaskEvent(verdict_submitted)` -> 再 `decideWorkflowTaskStage`
  4. 解析失败 -> 不自动推进，写 `verdict_unresolved` 事件 / 日志 / 系统提示（与实现保持一致）

### 文件建议

- `src/App.tsx`
- `src/services/workflowTasks.ts`（eventType 扩展）
- `src/types.ts` / `src/types/workflow.ts`（如需补事件类型）

### 验收

- [ ] 团队流程主干未替换，仍由现有节点推进逻辑驱动。
- [x] 同一轮重复 completion 不会二次推进（前端 `correlationId` + `payloadSha256` + 事件查重 guard）。
- [x] 后端幂等去重已落地（`src-tauri/migrations/011_task_event_acceptance_idempotency.sql` + `append_task_event` 冲突回收返回既有事件）。
- [x] `bun run build` 通过。

---

## T4：展示与回归

### 范围

- `WorkflowTaskTimeline` 增加 verdict 事件可见性（可选但推荐）
- 加一份回归脚本：通过/驳回/失败/长文/重复事件
- 增加 feature flag 验证：`wise.workflow.verdict.mode`

### 文件建议

- `src/components/ClaudeSessions/WorkflowTaskTimeline.tsx`
- `design/llm-structured-decision-pipeline/manual-test-script.md`（可新建）

### 验收

- [ ] 时间线可定位 verdict 事件（至少日志可查）。
- [ ] 关闭开关后行为回到当前线上策略。

---
## T5：Tool/Structured 默认接入（3A）

### 范围

- 在团队验收节点优先接入 **Tool Call / Structured Output**，使 verdict 从机器可读参数进入门闸。
- 仅在 3A 当前不可用时，保留 3B Extractor 兜底（不替代 3A）。
- 保持现有团队编排主链：`handleClaudeTurnComplete` -> `appendTaskEvent` -> `decideWorkflowTaskStage` -> `advanceWorkflowGraph`。

### 文件建议

- `src/services/claudeStreamRuntime.ts`（如需接收 tool/structured 结果）
- `src/hooks/useClaudeSessions.ts`（完成回调 payload 扩展）
- `src/App.tsx`（优先消费 tool/structured verdict，再回退既有门闸）
- `src/services/workflow/acceptanceVerdict.ts`（对齐 payload 解析与校验）

### 验收

- [ ] 能走 Tool/Structured 主路径时，不依赖正文推断即可稳定通过/驳回。
- [ ] 主回复 >100k 场景下仍稳定出 verdict（3A 优先，3B 仅兜底）。
- [ ] 失败回退策略明确：3A 不可用时才启用 3B，不影响已落地幂等与事件化。

---

## 并行协作建议（避免冲突）

- 开发 A：T1 + T2（契约/解析）
- 开发 B：T3（App 接线/事件）
- 开发 C：T4（UI 与回归）
- 开发 D：T5（Tool/Structured 主路径接入）

合并顺序建议：
1. PR-1（T1）  
2. PR-2（T2，依赖 PR-1）  
3. PR-3（T3，依赖 PR-1/2）  
4. PR-4（T4，依赖 PR-3）  
5. PR-5（T5，依赖 PR-2/3，建议在 PR-4 后合并）

---

## 风险与回滚

- 若 T3 引起误判：切 `wise.workflow.verdict.mode=heuristic` 快速回滚策略。
- 若事件枚举不兼容：先落前端兼容层，Rust/DB 枚举独立迁移 PR。
- 若长文仍偶发失败：仅在 `approval + acceptance_enabled` 节点启用二次短调用（不全局开启）。

---

## Done 标准（本拆解）

- [ ] 五个任务至少完成 T1～T3 并上线验证一条真实团队流程；T5 按默认主路径逐步接入。
- [ ] 文档与代码映射一致，关键入口函数有注释说明“为何在此处做门闸”。
