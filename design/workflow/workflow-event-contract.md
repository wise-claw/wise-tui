# Wise Workflow 事件协议契约

## 1. 目标

定义 Wise 在“任务拆分 + OMC 流程执行 + 单会话可视化”场景下的统一事件协议，确保：

- 编排引擎、UI、持久化之间解耦
- 事件可重放（event replay）恢复流程状态
- 所有关键动作可审计、可追踪、可定位

---

## 2. 设计原则

1. **事件是事实，不是视图**
   - 状态由事件推导，不允许 UI 直接写最终状态。

2. **强幂等**
   - 同一事件可重复消费，不造成副作用放大。

3. **可回放**
   - 任意时刻可通过 `events.ndjson` 重建流程状态。

4. **可扩展**
   - 新增事件类型不破坏旧消费者（未知事件应忽略）。

---

## 3. 事件信封（Envelope）

所有事件使用统一结构：

```ts
export interface WorkflowEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string; // UUID
  eventType: WorkflowEventType;
  schemaVersion: 1;
  sessionId: string;
  workflowRunId: string;
  repositoryPath: string;
  timestamp: number; // epoch ms
  source: EventSource;
  correlationId?: string; // 跨事件链路关联（如一次任务执行）
  causationId?: string; // 由哪个事件触发
  payload: TPayload;
}
```

`EventSource`：

```ts
export type EventSource =
  | "ui"
  | "workflow_engine"
  | "task_router"
  | "omc_adapter"
  | "gate_engine"
  | "claude_stream"
  | "system";
```

---

## 4. 事件类型总览

```ts
export type WorkflowEventType =
  // Workflow 生命周期
  | "workflow.created"
  | "workflow.resumed"
  | "workflow.completed"
  | "workflow.failed"
  // Stage 生命周期
  | "stage.entered"
  | "stage.progressed"
  | "stage.succeeded"
  | "stage.failed"
  | "stage.retried"
  // Task 路由与执行
  | "task.routed"
  | "task.queued"
  | "task.run.started"
  | "task.run.progressed"
  | "task.run.succeeded"
  | "task.run.failed"
  | "task.run.aborted"
  | "task.status.changed"
  // Gate
  | "gate.check.started"
  | "gate.check.completed"
  | "gate.check.failed"
  // 人机协同
  | "permission.requested"
  | "permission.responded"
  | "question.requested"
  | "question.responded"
  | "human.takeover.started"
  | "human.takeover.ended"
  // 团队流程验收判定
  | "workflow_acceptance_verdict_submitted"
  | "workflow_acceptance_verdict_unresolved"
  // 工具与证据
  | "tool.call.started"
  | "tool.call.completed"
  | "tool.call.failed"
  | "artifact.recorded"
  // 恢复与系统
  | "recovery.started"
  | "recovery.completed"
  | "recovery.failed";
```

---

## 5. 关键 Payload 契约

## 5.1 Workflow 事件

### `workflow.created`

```ts
{
  currentStage: "split" | "clarify" | "implement" | "verify" | "review" | "delivery";
  status: "running";
  taskSnapshotId: string;
  routingPolicyId?: string;
}
```

### `workflow.completed`

```ts
{
  finalStage: "delivery";
  durationMs: number;
  summary: string;
}
```

---

## 5.2 Stage 事件

### `stage.entered`

```ts
{
  stage: WorkflowStage;
  owner: "system" | "agent" | "human";
  reason?: string;
}
```

### `stage.failed`

```ts
{
  stage: WorkflowStage;
  errorCode: string;
  message: string;
  retryable: boolean;
}
```

---

## 5.3 Task 路由与执行事件

### `task.routed`

```ts
{
  taskId: string;
  templateId: "autopilot" | "ultraqa" | "verify" | "team" | string;
  subagentType?: string;
  gatePlan: GateType[];
  priority: number;
  rationale: string[];
}
```

### `task.run.started`

```ts
{
  taskId: string;
  taskRunId: string;
  attempt: number;
  templateId: string;
  agentBinding: {
    mode: "main_agent" | "subagent";
    subagentType?: string;
    model?: string;
  };
}
```

### `task.run.failed`

```ts
{
  taskId: string;
  taskRunId: string;
  attempt: number;
  errorCode: string;
  message: string;
  retryable: boolean;
  blockerType?: "dependency" | "permission" | "environment" | "logic" | "unknown";
}
```

### `task.status.changed`

```ts
{
  taskId: string;
  from: "todo" | "in_progress" | "blocked" | "pending_review" | "done" | "cancelled";
  to: "todo" | "in_progress" | "blocked" | "pending_review" | "done" | "cancelled";
  reason: string;
}
```

---

## 5.4 Gate 事件

### `gate.check.completed`

```ts
{
  taskId?: string; // 阶段级 gate 可为空
  gateType: "build" | "test" | "lint" | "review" | "security";
  passed: boolean;
  durationMs: number;
  evidenceRefs: string[]; // artifact id 列表
  message?: string;
}
```

---

## 5.5 人机协同事件

### `permission.requested`

```ts
{
  requestId: string;
  taskId?: string;
  tool: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
}
```

### `permission.responded`

```ts
{
  requestId: string;
  response: "allow_once" | "allow_always" | "deny";
  responder: "human";
  latencyMs: number;
}
```

### `question.responded`

```ts
{
  requestId: string;
  answers: string[];
  customAnswer?: string;
  responder: "human";
}
```

---

## 5.6 工具与证据事件

### `tool.call.completed`

```ts
{
  taskId?: string;
  toolCallId: string;
  toolName: string;
  status: "completed";
  durationMs?: number;
  outputPreview?: string;
}
```

### `artifact.recorded`

```ts
{
  artifactId: string;
  taskId?: string;
  stage?: WorkflowStage;
  kind:
    | "stdout"
    | "stderr"
    | "diff"
    | "test_report"
    | "build_report"
    | "review_note"
    | "snapshot";
  path: string;
  digest?: string;
  sizeBytes?: number;
}
```

---

## 6. 状态推导规则（Reducer Contract）

必须由 reducer 消费事件推导以下对象：

- `WorkflowRunState`
- `StageStateMap`
- `TaskExecutionStateMap`
- `GateStateMap`

关键规则：

1. 收到 `stage.entered` 时，前一阶段若未结束需自动补 `endedAt`（系统闭合）
2. 收到 `task.run.started` 时，任务状态自动变为 `in_progress`（若不是终态）
3. 收到 `task.run.failed` 且 `retryable=false`，任务状态变 `blocked`
4. 收到 `gate.check.completed` 且 `passed=false`，对应阶段不可推进
5. `workflow.completed` 只能在所有必需 gate 通过后生效

---

## 7. 幂等与去重规则

1. `eventId` 全局唯一，重复 `eventId` 直接丢弃
2. 对 `task.run.*` 事件，`taskRunId + attempt` 作为自然幂等键
3. 对 `permission.responded`，同一 `requestId` 仅首个响应生效
4. 事件乱序时按 `timestamp` + 逻辑约束重排；无法重排时标记一致性告警

---

## 8. 存储格式约定

文件：`~/.wise/workflows/{sessionId}/events.ndjson`

每行一个 `WorkflowEventEnvelope` JSON：

```json
{"eventId":"...","eventType":"stage.entered","schemaVersion":1,"sessionId":"...","workflowRunId":"...","repositoryPath":"...","timestamp":1710000000000,"source":"workflow_engine","payload":{"stage":"implement","owner":"agent"}}
```

要求：

- UTF-8，无 BOM
- 单行不换行
- 写入采用 append-only

---

## 9. 版本兼容策略

1. `schemaVersion` 当前固定 `1`
2. 新字段仅追加，不删除旧字段
3. 新事件类型发布前需保证旧客户端“忽略未知事件不崩溃”
4. 破坏性变更需升级 `schemaVersion=2` 并提供迁移脚本

---

## 10. 错误码命名约定

统一格式：

`WF_<DOMAIN>_<DETAIL>`

示例：

- `WF_STAGE_INVALID_TRANSITION`
- `WF_TASK_ROUTE_FAILED`
- `WF_GATE_TIMEOUT`
- `WF_PERMISSION_DENIED`
- `WF_RECOVERY_REPLAY_FAILED`

---

## 11. 验收清单

1. 事件可用于全量状态重建，重放结果与运行态一致
2. 重复写入同一事件不会改变最终状态
3. 乱序写入场景下，关键状态（stage/task/gate）仍一致
4. 任一 `done` 任务均可回溯其 `task.run.*` 与 `gate.*` 事件链

---

## 12. 团队流程验收判定事件（补充）

与编排代码的对应关系：**验收侧新方案**（解析 → verdict 事件 → `decide` 门闸）中，从助手输出得到 `approve`/`reject` 的实现位于 `src/services/workflow/acceptanceVerdict.ts`（`inferAcceptanceDecisionFromOutput` 等）；`src/services/workflowGraphRuntime.ts` 负责图推进与 `composeDispatchInput` 派发模板，并对 verdict 相关符号做兼容 **re-export**，解析逻辑不在 runtime 内重复维护。

### `workflow_acceptance_verdict_submitted`

- 含义：验收节点已解析出结构化 verdict（approve/reject），可作为后续 `decide` 的审计依据。
- 推荐 payload 字段：
  - `schemaVersion`
  - `taskId`
  - `graphNodeId`（兼容可含 `nodeId`）
  - `currentStageIndex`
  - `workflowAcceptanceVerdict` (`approve` / `reject`)
  - `acceptanceGate`（`schema` / `inferred`）
  - `verdictSource`（`complete_payload` / `output_fallback`）
  - `correlationId`（建议 `taskId|nodeId|payloadSha256`）
  - `payloadSha256`（当前实现按助手输出正文计算）
  - `source`（如 `claude_turn_complete`）
  - `createdAt`

### `workflow_acceptance_verdict_unresolved`

- 含义：验收节点未解析出可采纳的结构化 verdict，流程应转人工或等待明确结论。
- 推荐 payload 字段：
  - `schemaVersion`
  - `taskId`
  - `graphNodeId`（兼容可含 `nodeId`）
  - `currentStageIndex`
  - `reason`（如 `parse_failed`）
  - `verdictSource`（`complete_payload` / `output_fallback`）
  - `correlationId`
  - `payloadSha256`
  - `source`
  - `createdAt`
