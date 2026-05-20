# 指挥台 API 契约（草案）

本文定义 v3 实施的第一版 TypeScript / 存储契约。实现位置建议：`src/command/`。

---

## 1. FocusContext

```ts
// src/hooks/useFocusContext.ts

export type FocusContext =
  | { level: "command" }
  | { level: "workspace"; projectId?: string; repoId?: number }
  | { level: "work-item"; missionId: string }
  | { level: "gate"; gateId: string }
  | { level: "assignment"; assignmentId: string };

export interface FocusContextApi {
  focus: FocusContext;
  setFocus: (next: FocusContext) => void;
  focusCommand: () => void;
  focusWorkspace: (p: { projectId?: string; repoId?: number }) => void;
  focusWorkItem: (missionId: string) => void;
  focusGate: (gateId: string) => void;
  focusAssignment: (assignmentId: string) => void;
}
```

**规则**

- 默认 `{ level: "command" }`
- `focusGate` 时右栏应加载 Gate 的 `assignmentId`
- 左栏选中 workspace 时调用 `focusWorkspace`，但不取消 pending Gate 的 GateBar 展示

---

## 2. Gate

```ts
// src/command/types.ts

import type { PermissionRequest, QuestionRequest } from "../types";

export type GateKind = "question" | "permission" | "blocker";
export type GateStatus = "pending" | "answered" | "expired" | "failed";

export interface GateSource {
  missionId: string;
  assignmentId: string;
  repositoryId: number;
  repositoryName: string;
  sessionId: string;
  agentName?: string;
  employeeId?: string;
}

export interface BlockerPayload {
  title: string;
  message: string;
  actions: Array<{
    id: string;
    label: string;
    kind: "retry" | "reassign" | "skip" | "abort";
  }>;
}

export interface Gate {
  id: string;
  kind: GateKind;
  status: GateStatus;
  source: GateSource;
  payload: QuestionRequest | PermissionRequest | BlockerPayload;
  createdAt: number;
  updatedAt: number;
}

export type GateAnswer =
  | { kind: "question"; selectedOptions: string[]; freeText?: string }
  | { kind: "permission"; approved: boolean }
  | { kind: "blocker"; actionId: string };
```

---

## 3. gateHub

```ts
// src/command/gateHub.ts

export interface GateHub {
  /** 全局 pending 列表，按 createdAt ASC（可扩展优先级） */
  listPending(): Gate[];

  get(gateId: string): Gate | null;

  /**
   * 从会话桶 ingest 到全局队列。
   * 由 useClaudeSessions / 流解析在 question|permission 到达时调用。
   */
  ingestFromSession(sessionId: string): void;

  /**
   * 用户在中栏答题。
   * 内部：notificationHub.markRequestAnswered + stdin/resume + assignment status
   */
  resolve(gateId: string, answer: GateAnswer): Promise<void>;

  /** 进程结束等场景 */
  expireForSession(sessionId: string, reason: string): void;

  subscribe(listener: () => void): () => void;

  getVersion(): number;
}

export const gateHub: GateHub;
```

### ingest 规则

1. 从 `notificationHub.getDockSlice(sessionId)` 读取 `questionRequest` / `permissionRequest`
2. 从 session metadata 读取 `missionId`, `assignmentId`, `repositoryId`
3. 若缺 `missionId`：Gate 仍创建，`source.missionId = "unassigned"`，UI 显示「未归属」
4. 同 `assignmentId` + 同题干 `question.id` 或 content hash → 不重复 ingest

### resolve 规则

1. 校验 `status === "pending"`
2. 委托现有 `useClaudeSessions` 的 question/permission submit 路径
3. `mission_upsert_agent_assignment` → `status: "running"`（若此前为 `waiting_gate`）
4. 可选：`recordTrellisRuntimeEvent({ eventKind: "gate.resolved", ... })`

---

## 4. dispatchIntent

```ts
// src/command/dispatch.ts

import type { AtMention } from "../services/atMentionDispatch";

export interface DispatchIntent {
  text: string;
  mentions: AtMention[];
  projectId?: string;
  /** 如 builtin:prd-split */
  assistantId?: string;
}

export interface DispatchResult {
  missionId: string;
  intentText: string;
  assignments: Array<{
    assignmentId: string;
    repositoryId: number;
    sessionId?: string;
  }>;
}

export async function dispatchIntent(
  intent: DispatchIntent,
  ctx: DispatchContext,
): Promise<DispatchResult>;
```

### DispatchContext（注入）

```ts
export interface DispatchContext {
  projects: ProjectItem[];
  repositories: Repository[];
  /** 现有 planAtMentionDispatch / executeClaudeCode 依赖 */
  spawnClaude: (/* ... */) => Promise<{ sessionId: string }>;
  upsertMission: (input: MissionUpsertInput) => Promise<{ missionId: string }>;
  upsertAssignment: (input: AssignmentUpsertInput) => Promise<{ assignmentId: string }>;
}
```

### 行为

1. `parseAtMentions(intent.text)`（已有）
2. `planAtMentionDispatch` 解析目标仓库（已有）
3. `upsertMission`：`intent_text = intent.text`，`stage = direct | splitting`
4. 每个目标仓库：`upsertAssignment` + `spawnClaude`
5. Session 创建时写入 metadata：`{ missionId, assignmentId, repositoryId }`
6. 返回 `DispatchResult`；调用方 `focusWorkItem(missionId)`

---

## 5. WorkItemFeed

```ts
// src/hooks/useWorkItemFeed.ts

export type WorkItemStatus =
  | "queued"
  | "running"
  | "waiting_gate"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface WorkItemRow {
  missionId: string;
  intentText: string;
  title: string;
  status: WorkItemStatus;
  projectId?: string;
  projectName?: string;
  pendingGateCount: number;
  runningAssignmentCount: number;
  updatedAt: number;
  createdAt: number;
}

export function useWorkItemFeed(options?: {
  projectId?: string;
  limit?: number;
}): {
  items: WorkItemRow[];
  loading: boolean;
  refresh: () => Promise<void>;
};
```

**status 推导（前端聚合，后续可下沉 DB）**

| 条件 | status |
|------|--------|
| 任一 Assignment `waiting_gate` 或 pending Gate | `waiting_gate` |
| 任一 Blocker Gate | `blocked` |
| 全部 Assignment 终态且至少一 succeeded | `succeeded` |
| 全部 failed | `failed` |
| 任一 running | `running` |
| 否则 | `queued` |

---

## 6. Assignment status（DB 枚举扩展）

现有 `mission_agent_assignments.status` 为 TEXT。新增值：

```
waiting_gate
```

写入时机：

| 事件 | status |
|------|--------|
| Gate ingest（question/permission） | `waiting_gate` |
| gateHub.resolve 成功 | `running` |
| 进程正常完成 | `succeeded` / `failed` / `cancelled`（已有） |

---

## 7. Session metadata 契约

Claude Session 创建或绑定时应写入（`session` 扩展字段或 appSettings 映射）：

```ts
interface SessionCommandMetadata {
  missionId: string;
  assignmentId: string;
  repositoryId: number;
  correlationId?: string; // 默认 = missionId
}
```

**W1 最小要求**：`gateHub.ingestFromSession` 能读到 `assignmentId` 或明确落入 `unassigned`。

---

## 8. Trellis Runtime 事件（W4+ 可选）

```ts
// eventKind 扩展
type UpstreamEventKind =
  | "gate.opened"
  | "gate.resolved"
  | "work-item.closed";

interface GateOpenedPayload {
  gateId: string;
  gateKind: GateKind;
  missionId: string;
  assignmentId: string;
  sessionId: string;
}

interface GateResolvedPayload {
  gateId: string;
  answerKind: GateAnswer["kind"];
  missionId: string;
  assignmentId: string;
}
```

---

## 9. 组件 Props（UI 边界）

```ts
// src/components/CommandSurface/index.tsx

export interface CommandSurfaceProps {
  focus: FocusContext;
  onFocusWorkItem: (missionId: string) => void;
  onFocusGate: (gateId: string) => void;
  onDispatch: (text: string) => Promise<void>;
  projects: ProjectItem[];
  repositories: Repository[];
}

// GateBar.tsx
export interface GateBarProps {
  gates: Gate[];
  activeGateId?: string;
  onResolve: (gateId: string, answer: GateAnswer) => void;
  onFocusGate: (gateId: string) => void;
}

// WorkItemFeed.tsx
export interface WorkItemFeedProps {
  items: WorkItemRow[];
  activeMissionId?: string;
  onSelect: (missionId: string) => void;
}
```

---

## 10. 测试要点

| 场景 | 断言 |
|------|------|
| ingest 双题 | `listPending().length === 2`，顺序 FIFO |
| resolve question | Gate `answered`，notificationHub 清题，assignment `running` |
| session complete | `expireForSession`，Gate `expired` |
| dispatch 双仓 | 1 missionId，2 assignments，Feed 1 行 |
| 无 mission metadata | Gate `source.missionId === "unassigned"` |

单元测试建议：`src/command/gateHub.test.ts`、`src/command/dispatch.test.ts`。
