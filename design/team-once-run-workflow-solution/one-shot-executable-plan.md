# @团队入队后按工作流自动流转：一次性落地方案

## 1. 目标与范围

本方案用于一次性实现以下闭环能力（前端主导，复用现有服务）：

1. 会话输入框中命中 `@团队` 时，消息先进入待办任务队列，不直接执行。
2. 队列调度器在团队空闲时自动消费队首，创建团队任务并启动工作流。
3. 每个阶段按团队自定义编排执行：
   - 输入 = 原任务信息 + 强约束阶段任务；
   - 若启用上阶段成果验收评判，附加强约束评判标准。
4. Claude 执行完成后自动判定验收结论：
   - 通过 -> 前进下一阶段；
   - 驳回 -> 回退到上一阶段（由图上的 `else` 边决定）。
5. 到达结束节点后，标记本次团队任务完成并写入可追溯事件。

非目标（本次不做）：

- 新建后端服务；不改动 Rust 端任务数据结构。
- 新增复杂权限系统。

## 2. 现有能力复用清单

已存在能力，可直接复用：

- 队列模型与 UI：
  - `src/types.ts` -> `PendingExecutionTask`
  - `src/hooks/usePendingTaskQueue.ts`
  - `src/components/ClaudeSessions/PendingTaskQueuePanel.tsx`
- 队列目标识别：
  - `src/utils/pendingQueueExecutor.ts` -> `inferPendingQueueTargetFromPrompt`
- 团队工作流运行时（图状态与派发模板）：
  - `src/services/workflowGraphRuntime.ts`
  - `createWorkflowRuntimeState`
  - `advanceWorkflowGraph`
  - `composeDispatchInput`
- 验收结论从助手输出推断（**解析真源**，与上图运行时分离）：
  - `src/services/workflow/acceptanceVerdict.ts` -> `inferAcceptanceDecisionFromOutput`（`workflowGraphRuntime.ts` 仅 **re-export** 同名符号以保持兼容 import）
- 团队任务服务：
  - `src/services/workflowTasks.ts`
- 自动流转入口：
  - `src/App.tsx` -> `handleComposerExecute` + `handleClaudeTurnComplete`

## 3. 一次性实施步骤（按顺序执行）

### Step A：统一入口策略（@团队只入队）

修改点：

- `src/components/ClaudeChatInput/ComposerRegion`（通过 `onEnqueueAsPendingTask` 路径）
- `src/components/ClaudeSessions/ClaudeChat.tsx`（发送行为收敛）

执行规则：

1. 命中 `targetType === "team"` 时，不调用 `onExecute` 直发。
2. 固定写入待办队列项：
   - `targetType: "team"`
   - `targetWorkflowId`
   - `targetWorkflowName`
   - `executorLabel: 团队:<name>`
3. 给用户即时反馈：`已加入团队待办队列`。

完成判定：

- `@团队` 输入后，消息只出现在待办队列，不立即创建 `workflow_task`。

---

### Step B：队列消费器改造为“团队启动器”

修改点：

- `src/components/ClaudeSessions/ClaudeChat.tsx` 的 `dispatchPendingTask`

执行规则（队首为 team 时）：

1. 校验团队是否发布（published）：
   - 若非 published，提示并阻塞该队列项（保持队列不丢）。
2. 团队空闲时（`isTeamIdle`）：
   - `createWorkflowTask(...)`
   - 读取对应图：`getWorkflowGraph({ workflowId })`
   - `createWorkflowRuntimeState(graph)`
   - `advanceWorkflowGraph(...startContent=task.content)` 获取首个 dispatch
3. 发送自动执行消息（保持现有前缀协议）：
   - `# 团队流程自动执行`
   - 节点信息
   - `dispatch.input`
4. 写入 runtime snapshot 事件，便于时间线可追踪。

完成判定：

- 队首 team 任务可在团队空闲时自动拉起，且第一阶段能自动开始执行。

---

### Step C：阶段输入强约束模板固化

修改点：

- `src/services/workflowGraphRuntime.ts` -> `composeDispatchInput`

模板要求：

1. 基础部分：
   - 任务标题/原始任务内容摘要
   - 上阶段产出摘要（有则带上）
2. 强约束阶段任务：
   - 来自 `employeePrompt`
3. 验收开启时附加：
   - `通过标准`（conditionIfPrompt）
   - `驳回标准`（conditionElsePrompt）
   - 强制结论尾标（二选一）：
     - `验收结论：通过`
     - `验收结论：驳回`

完成判定：

- 所有团队派发消息均遵守统一模板，验收节点输出可稳定解析。

---

### Step D：验收结果自动推进与回退

修改点：

- `src/App.tsx` -> `handleClaudeTurnComplete`

执行规则：

1. 当前节点是 `approval`：
   - 先 `inferAcceptanceDecisionFromOutput(output)`（实现见 `src/services/workflow/acceptanceVerdict.ts`；勿在 `App.tsx` 内复制解析逻辑）
   - 解析到：
     - pass -> `decideWorkflowTaskStage(...approved)`
     - reject -> `decideWorkflowTaskStage(...rejected)`
   - 再 `advanceWorkflowGraph` 按 `if/else` 边推进
2. 解析不到（模糊输出）：
   - 不推进流程；
   - 写事件 `workflow_runtime_decision_pending_manual`；
   - 保持时间线人工“通过/退回”可操作。

完成判定：

- 验收节点可自动前进或回退；不确定结论时可人工接管，不会误流转。

---

### Step E：结束节点闭环完成

修改点：

- `src/App.tsx`（自动流转末端）

执行规则：

1. `advanceWorkflowGraph` 返回 `completed=true` 时：
   - 调用 `endWorkflowTask({ taskId, reason: "到达结束节点自动完成" })`
   - 写 `workflow_runtime_completed` 事件
2. 刷新任务状态、事件、待审批人列表。

完成判定：

- 到达 end 节点后，任务状态变为 completed，队列继续消费下一项。

## 4. 一次性提测脚本（手工）

### 用例 1：@团队先入队

1. 在会话输入：`@团队A 完成某功能开发`。
2. 预期：仅进入待办队列，不立刻执行。

### 用例 2：自动启动第一阶段

1. 点击“发送下一项”或等待自动调度。
2. 预期：创建团队任务，第一阶段员工收到自动执行 prompt。

### 用例 3：验收驳回回退

1. 在验收节点输出中包含：`验收结论：驳回`。
2. 预期：流程沿 `else` 回退到上一阶段并继续派发。

### 用例 4：验收通过前进

1. 输出：`验收结论：通过`。
2. 预期：进入下一阶段。

### 用例 5：结束节点完成

1. 执行到 `end`。
2. 预期：任务状态 completed，时间线可见 completed 事件。

## 5. 风险与兜底

1. 验收语义漂移导致无法解析：
   - 兜底：人工审批按钮 + pending_manual 事件。
2. 团队未发布被误调度：
   - 兜底：调度前校验 published，不满足则提示并阻塞队首。
3. 队首阻塞影响吞吐：
   - 兜底：保留置顶/删除/编辑，支持人工处理卡点项。

## 6. 交付定义（DoD）

满足以下即视为一次性方案落成并可上线：

1. `@团队` 全量走入队，不直发。
2. 队列可自动拉起团队任务并启动第一阶段。
3. 阶段输入严格包含强约束任务；验收节点附带评判标准。
4. 自动判定可稳定触发通过/驳回流转；无法判定可人工处理。
5. 到结束节点自动完成任务并写入可追踪事件。
6. 五个提测用例全部通过。

## 7. 当前实现进度（已落地）

以下能力已在代码中实现并通过构建：

1. 团队发布态门禁：
   - 队首任务目标团队未 `published` 时，阻塞调度。
   - 队列面板显示阻塞态文案：`团队未发布，无法调度`。
2. 未发布团队可操作引导：
   - 点击“发送下一项”命中未发布团队时，弹确认框。
   - 支持一键进入团队配置页面进行发布。
3. 结束节点自动完成：
   - 自动流转与人工审批流转两条路径上，到达结束节点均自动调用 `endWorkflowTask` 完成闭环。
4. `@团队` 入队可见反馈：
   - 发送时识别为团队目标后，提示 `已加入团队待办队列`。
5. 开发态链路追踪（可开关）：
   - 通过 `localStorage["wise.workflow.trace"] = "1"` 开启日志。
   - 统一前缀：`[wise-workflow-trace]`。

## 8. 联调操作手册（并行开发可直接执行）

### 8.1 开启追踪日志

在前端控制台执行：

```js
localStorage.setItem("wise.workflow.trace", "1");
```

关闭：

```js
localStorage.removeItem("wise.workflow.trace");
```

### 8.2 关键日志观察点

1. 队列消费：
   - `queue.dispatch.consume`
   - `queue.dispatch.blocked_unpublished`
2. 团队启动：
   - `team.dispatch.bootstrap.start`
   - `team.dispatch.bootstrap.next`
3. 验收判定：
   - `team.decision.auto`
   - `team.decision.pending_manual`
4. 流转推进：
   - `team.advance.next`
   - `team.advance.manual_decision`
5. 任务完成：
   - `team.complete.auto`
   - `team.complete.manual_decision`

### 8.3 一轮完整联调最小步骤

1. 发送 `@团队X` 任务，确认只入队（出现入队提示）。
2. 点击“发送下一项”：
   - 若团队未发布，应弹出引导并保持队列项不丢。
   - 发布后再次发送，应进入团队执行。
3. 执行到验收节点：
   - 输出 `验收结论：驳回`，观察回退。
   - 再输出 `验收结论：通过`，观察前进。
4. 到结束节点：
   - 任务自动 completed。
   - 日志出现 `team.complete.*`。

## 9. 并行分工建议（剩余项）

1. 前端 A：继续增强 UI 引导（阻塞队首高亮、快捷跳转发布团队）。
2. 前端 B：补充 runtime 事件细粒度展示（decision pending manual 的显式标记）。
3. 联调/QA：按 8.3 脚本做 3 轮回归（含员工/团队混排队列场景）。

