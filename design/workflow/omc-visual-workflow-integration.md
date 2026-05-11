# Wise 融合 oh-my-claudecode 的完整可执行方案

## 1. 文档目标与范围

本文定义 Wise 将 `oh-my-claudecode`（下称 OMC）能力可视化融合到单会话窗口，并与现有任务拆分能力打通为完整开发流程的端到端方案。目标不是 MVP，而是可分阶段落地、可验收、可运维的生产级方案。

范围包含：

- 单会话窗口内的流程可视化、状态管理、人机协作交互
- 任务拆分结果到执行编排的自动对接
- OMC 能力适配层（模板、流程、子代理、多回合执行）
- 质量门禁（验证、评审、发布前置条件）
- 数据持久化、可观测性、失败恢复、权限与安全治理

不包含：

- 重写现有 Claude 消息协议或替换现有会话基础设施
- 新建独立后端服务（默认沿用 Tauri + 本地文件持久化）

---

## 2. 现状基线（与现有代码对齐）

当前 Wise 已具备关键能力基础：

1. **会话与消息渲染**
   - `ClaudeSession`、`ClaudeMessage`、`MessagePart` 体系已可承载 `tool_use`、`reasoning`、`text`
   - `MessagePartsDisplay` 已可展示 `Task` 等工具调用信息

2. **人机控制信号**
   - `streamIngest` 已能识别并处理 `permission` / `user_question`
   - 已有 Permission/Question 的 UI 交互回传机制

3. **任务拆分与结构化模型**
   - `SplitResult`、`TaskItem`、`dependencies`、`flowStatus`、`executionStatus` 等核心字段已存在
   - 已支持 PRD -> 任务列表的结构化输出

4. **Claude Code 能力管理**
   - 已有 MCP、Skills、Hooks、Subagents 配置面板
   - Subagent 可创建/编辑/覆盖管理

结论：无需推翻现有架构，应采用“增量增强 + 适配层”策略。

---

## 3. 产品目标（最终态）

在单会话窗口中，用户可以完成完整开发闭环：

1. 导入需求并拆分任务
2. 自动选择流程模板（OMC 模式）
3. 执行任务（可并行、可暂停、可人工接管）
4. 自动收集验证证据（构建、测试、检查）
5. 通过质量门禁后进入评审与交付
6. 全链路可回放、可审计、可追责

关键体验目标：

- 会话中存在可视化“开发流程轨道”（Workflow Rail）
- 每个任务/阶段有明确状态、负责人、证据、下一步动作
- 用户始终可见“为什么卡住、卡在哪、如何继续”

---

## 4. 总体架构设计

### 4.1 架构分层

采用四层架构：

1. **Presentation 层（UI）**
   - `WorkflowRail`（阶段轨道）
   - `TaskExecutionBoard`（任务执行看板）
   - `StageInspector`（阶段详情抽屉）
   - `EvidencePanel`（证据面板）

2. **Orchestration 层（编排）**
   - `WorkflowEngine`（流程状态机）
   - `TaskRouter`（任务到模板/子代理路由）
   - `GateEngine`（质量门禁）
   - `RetryPolicy`（重试与退避）

3. **Adapter 层（能力接入）**
   - `OmcWorkflowAdapter`（统一封装 OMC 模式）
   - `ClaudeSessionAdapter`（写入会话、监听 stream、发控制响应）
   - `ToolEventNormalizer`（工具事件标准化）

4. **Persistence/Telemetry 层**
   - `workflow-runs` 本地持久化
   - 事件日志（stage events / task events / gate events）
   - 指标汇总（成功率、重试率、阻塞分布）

### 4.2 关键原则

- OMC 是“流程能力包”，不是新聊天入口
- 会话消息是事实来源（source of truth），流程状态由事件聚合得出
- 任何自动化动作必须支持人工中断与恢复
- 质量门禁必须基于可验证证据，不基于自然语言猜测

---

## 5. 单会话可视化方案

### 5.1 会话布局升级

在现有 `ClaudeChat` 主区新增三块：

1. **顶部：Workflow Rail**
   - 固定阶段：`拆分` -> `澄清` -> `实现` -> `验证` -> `评审` -> `交付`
   - 每阶段显示状态、耗时、负责实体（主 Agent / 子代理 / 人工）

2. **中部：原消息流（保留）**
   - 维持现有消息展示
   - 对工具调用加“阶段标签”和“任务标签”

3. **右侧（可折叠）：Stage Inspector**
   - 当前阶段输入/输出摘要
   - 失败原因、重试历史、恢复按钮
   - 证据链接（日志、测试、diff 摘要）

### 5.2 任务执行看板

在会话内增加任务看板（按 `flowStatus` 分列）：

- `todo`、`in_progress`、`blocked`、`pending_review`、`done`
- 卡片展示：任务标题、依赖、执行模板、最近一次执行结果、门禁状态
- 支持动作：开始执行、暂停、重试、人工接管、标记阻塞原因、进入下一阶段

---

## 6. 流程状态机与任务状态机

### 6.1 会话流程状态机（WorkflowStage）

```text
draft -> split -> clarify -> implement -> verify -> review -> delivery -> archived
```

状态规则：

- `split` 成功且任务图有效后才能进入 `clarify`
- `implement` 期间可并发执行多个任务，但阶段完成条件为“所有必选任务 done 或豁免”
- `verify` 未通过不可进入 `review`
- `review` 未通过不可进入 `delivery`

### 6.2 任务状态机（TaskFlowStatus 扩展）

在现有 `TaskFlowStatus` 基础上增加运行维度：

- 保留：`todo` / `in_progress` / `blocked` / `pending_review` / `done` / `cancelled`
- 新增运行子状态（字段）：`runState`
  - `idle` / `queued` / `running` / `succeeded` / `failed` / `aborted`

转换约束：

- `blocked` 只能由明确 blocker 事件触发
- `done` 需要 `GateEngine` 返回通过
- `failed` 自动进入“可重试”或“需人工”分支

---

## 7. 数据模型设计

新增类型文件建议：`src/types/workflow.ts`

### 7.1 核心实体

1. `WorkflowRun`
   - `id`, `sessionId`, `repositoryPath`
   - `currentStage`, `status`, `startedAt`, `updatedAt`
   - `taskSnapshotId`, `routingPolicyId`

2. `WorkflowStageState`
   - `stage`, `status`, `owner`, `startedAt`, `endedAt`
   - `inputs`, `outputs`, `errors`, `retryCount`

3. `TaskExecutionRun`
   - `id`, `taskId`, `templateId`, `agentBinding`
   - `attempt`, `status`, `startedAt`, `endedAt`
   - `artifacts`（stdout/stderr、diff、test result）

4. `GateCheckResult`
   - `gateType`（build/test/lint/review/security）
   - `passed`, `evidenceRefs`, `message`, `checkedAt`

5. `WorkflowEvent`
   - `type`, `stage`, `taskId?`, `source`, `payload`, `timestamp`

### 7.2 持久化位置

- `~/.wise/workflows/{sessionId}/workflow-run.json`
- `~/.wise/workflows/{sessionId}/events.ndjson`
- `~/.wise/workflows/{sessionId}/task-runs/{taskId}/{runId}.json`
- `~/.wise/workflows/{sessionId}/artifacts/*`

---

## 8. OMC 能力适配设计

### 8.1 统一模板抽象

新增 `WorkflowTemplate`：

- `id`: `autopilot`, `ultraqa`, `verify`, `team`, `custom-*`
- `intent`: 适用场景标签（实现/测试/回归/重构/发布）
- `defaultSubagentType`
- `requiredGates`
- `retryPolicy`
- `handoffPolicy`

### 8.2 OmcWorkflowAdapter 职责

`src/services/omcWorkflowAdapter.ts`

职责：

1. 将任务上下文转换为 OMC 指令模板
2. 发起执行并绑定会话消息流
3. 将 `tool_use`、`permission`、`question` 转为标准事件
4. 返回结构化执行结果（成功、失败、阻塞、证据）

约束：

- 不在 UI 直接拼装 OMC 命令
- 所有流程调用都经 Adapter，便于替换实现与测试

### 8.3 路由策略（TaskRouter）

按任务属性自动映射模板：

- `size=S/M` 且依赖少：`autopilot`
- 涉及测试或回归高风险：`ultraqa`
- 发布前聚合验证：`verify`
- 并行可拆任务组：`team`

策略输入：

- `role`, `size`, `dependencies`, `sourceRequirementIds`, 代码影响范围

策略输出：

- `templateId`, `subagentType`, `gatePlan`, `priority`

---

## 9. 质量门禁与审批流

### 9.1 GateEngine 规则

阶段门禁定义：

1. **实现 -> 验证**
   - 必须有可执行变更产物（diff 或文件更新）
2. **验证 -> 评审**
   - 必须通过至少一项自动验证（build/test/lint）
3. **评审 -> 交付**
   - 必须有评审结论（通过/豁免）与风险说明

### 9.2 权限事件处理

利用现有 permission 流程，补充策略：

- 高风险操作（删除大量文件、危险 git 操作）强制人工确认
- 可配置 allowlist（低风险工具自动放行）
- 所有确认动作写入审计日志

---

## 10. 可观测性与审计

### 10.1 事件采集

统一事件总线：

- `workflow.stage.entered`
- `workflow.stage.failed`
- `task.run.started`
- `task.run.completed`
- `gate.checked`
- `permission.requested`
- `permission.resolved`

### 10.2 指标看板（本地聚合）

至少采集：

- 任务一次通过率
- 平均重试次数
- 各阶段平均耗时
- 阻塞原因 Top N
- 门禁失败分布

### 10.3 回放能力

支持从任意阶段回放：

- 输入上下文快照
- 关键工具调用序列
- 失败时的错误证据

---

## 11. 失败恢复与韧性设计

### 11.1 恢复策略

- 应用重启后根据 `workflow-run.json + events.ndjson` 恢复状态
- 若状态不一致，走 `event replay` 重新计算
- 任务执行中断后可 `resume` 或 `restart from stage`

### 11.2 重试策略

- 默认指数退避：`30s -> 2m -> 5m`
- 上限 3 次，超过后转人工决策
- 重试必须附带“新的上下文或策略变化”

### 11.3 降级策略

- OMC 适配不可用时，回退到基础 Claude 会话执行模式
- 门禁引擎不可用时，标记“人工审核必需”

---

## 12. 安全与治理

1. **命令治理**
   - 统一命令白名单与风险分级
   - 禁止默认自动执行破坏性 git 命令

2. **数据治理**
   - 会话产物默认本地存储
   - 敏感信息（token、密钥）脱敏写入事件

3. **审计治理**
   - 每次权限决策保留：请求方、参数摘要、操作者、时间戳

---

## 13. 工程实施计划（非 MVP，完整实施）

### Phase 0：设计冻结与契约定义（1 周）

- 完成数据模型与事件协议评审
- 完成 `WorkflowTemplate` 与 `TaskRouter` 策略定义
- 产出接口契约文档与测试用例清单

交付物：

- `design/omc-visual-workflow-integration.md`（本文）
- `design/workflow-event-contract.md`
- `design/workflow-api-contract.md`

### Phase 1：编排内核（2 周）

- 实现 `WorkflowEngine`、`GateEngine`、`RetryPolicy`
- 完成持久化读写与恢复逻辑
- 打通事件总线与事件回放

交付物：

- `src/services/workflow/*`
- 单元测试覆盖状态机与门禁规则

### Phase 2：OMC 适配层（2 周）

- 实现 `OmcWorkflowAdapter` 与 `TaskRouter`
- 接入模板库（autopilot / ultraqa / verify / team）
- 接入现有 permission/question 协议

交付物：

- `src/services/omcWorkflowAdapter.ts`
- `src/services/taskRouter.ts`
- 集成测试（模拟工具事件与失败场景）

### Phase 3：会话可视化与交互（2 周）

- 实现 `WorkflowRail`、`TaskExecutionBoard`、`StageInspector`、`EvidencePanel`
- 将阶段标签与任务标签注入消息展示层
- 支持手动接管、重试、阶段回退

交付物：

- `src/components/Workflow/*`
- 交互 E2E 用例

### Phase 4：质量闭环与发布（1~2 周）

- 完成门禁策略与风险提示
- 完成指标聚合与故障诊断面板
- 发布前压测与回归

交付物：

- 发布清单
- 运维手册
- 回归报告

总周期：8~9 周。

---

## 14. 测试与验收标准

### 14.1 功能验收

- 可以从任务拆分结果一键进入完整流程执行
- 单会话内可见阶段轨道、任务状态、证据链
- 支持失败重试、人工接管、恢复继续

### 14.2 稳定性验收

- 应用崩溃恢复后，流程状态一致性 >= 99%
- 连续 50 任务执行无致命中断

### 14.3 质量验收

- 门禁漏检率为 0（按定义规则）
- 所有 `done` 任务均有证据记录

### 14.4 可观测性验收

- 任一失败任务可在 3 分钟内定位到阶段与工具调用证据

---

## 15. 风险与应对

1. **风险：OMC 模式变更导致兼容问题**
   - 应对：Adapter 层版本化 + 能力探测 + 回退策略

2. **风险：自动化执行过强引发误操作**
   - 应对：高风险操作强制人工 Gate

3. **风险：事件风暴导致 UI 卡顿**
   - 应对：事件批处理与虚拟化渲染

4. **风险：任务状态与消息状态不一致**
   - 应对：事件重放重建状态，禁止直接改写最终态

---

## 16. 推荐代码落点

建议新增目录：

- `src/types/workflow.ts`
- `src/services/workflow/engine.ts`
- `src/services/workflow/gateEngine.ts`
- `src/services/workflow/eventStore.ts`
- `src/services/workflow/replay.ts`
- `src/services/omcWorkflowAdapter.ts`
- `src/services/taskRouter.ts`
- `src/components/Workflow/WorkflowRail.tsx`
- `src/components/Workflow/TaskExecutionBoard.tsx`
- `src/components/Workflow/StageInspector.tsx`
- `src/components/Workflow/EvidencePanel.tsx`

建议改造现有目录：

- `src/components/ClaudeSessions/*`（注入阶段/任务标签）
- `src/notifications/streamIngest.ts`（事件标准化扩展）
- `src/hooks/usePrdTaskSplit.ts`（拆分后自动触发 route 预计算）

---

## 17. 执行决策建议

为避免长期分支漂移，建议按阶段提交：

1. 先提交“类型 + 事件协议 + 状态机”骨架
2. 再提交“OMC 适配 + 路由策略”
3. 再提交“UI 可视化与交互”
4. 最后提交“门禁 + 观测 + 恢复”

每阶段都要求：

- 可运行
- 可回滚
- 可测试

这套方案可以在保持现有 Wise 架构稳定的同时，把 OMC 融合成“会话内可见、流程可控、质量可证”的完整开发系统。

