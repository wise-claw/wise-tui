# 数字员工需求实现文档

单席位生理 + 公司级编制。**实现与验收以本文为准。**

不删除现有后端：attended 会话、仓库 cron、工作流图、反馈闭环、员工表、进度监控一律包裹进 Hub / Channel / Automation / Artifact。

---

## 1. 目标

把 `employees` 从「派发别名」做成可值班的席位，并在其上做成最小公司：编制、邮箱任务、按任务选拓扑。

验收一句话：

- 单席位：有章程、双模身份、静默心跳、可巩固记忆、事件可叫醒、隔离工位、可验收交付、跨界面同一套守卫、可停用计量。
- 公司：按任务选拓扑、活写成说明书、状态机管单、可认领可拒收、卡住改计划、终态干净可追踪。

## 2. 非目标

- 不把员工内部信做成 IM，也不默认镜像到钉钉/飞书。
- 不把开会当默认拓扑；不给无说明书的活扩编。
- 不为邮件/日历先铺触发。
- 不自动合并 PR。
- 不在单席位 Pulse / Heartbeat 未落地前开全员互通。
- 不把 Heartbeat 与 Sleeptime 合成一次 LLM 调用。
- 不为每种工具新建「员工」；工具工人挂在席位上临时拉起。

## 3. 现网锚点（只包裹）

| 能力 | 锚点 |
|------|------|
| 花名册 | `employees` 表、`EmployeeItem`、`src/services/employees.ts`、`EmployeeConfigModal` |
| 交棒 | `useWorkflowTeamAutomation` → `dispatchTeamStepToEmployeeSession` |
| 人类呼叫 | Composer `@员工`、待执行队列 |
| 定时 | `useScheduledClaudeTaskRunner`（主窗口 ~45s，关窗即停） |
| 观察 | `ProgressMonitorPanel` / `useMonitorOverview` |
| 记忆文件 | `ClaudeMemoryPanel`；`sessionMessagesMemory` 是 UI 堆上限，不是认知记忆 |
| 反思 | `sessionFeedbackLoop`（改配置，不改员工记忆） |
| 浏览器 | wise-browse / Stagehand / CUA |
| HITL | `notificationHub` 权限 / 提问 |

## 4. 需求

编号 `S` = 单席位，`C` = 公司。每条须可测。

### 4.1 单席位

| ID | 需求 | 落点 |
|----|------|------|
| S1 | 员工有章程：职责、禁区、技能、命名 I/O、成功标准 | Hub |
| S2 | Delegated（权限继承授权人）与 Ambient（权限=员工安全档）分账；失败分别问授权人 / 章程 | Hub |
| S3 | 时钟五档分离，且在 Rust：Pulse / Tick / Heartbeat / Sleeptime / Mission | Automation |
| S4 | Heartbeat：默认 30min、工作时段外跳过、对方 busy 让路、无事 `NO_REPLY`、不建任务记录 | Automation |
| S5 | Sleeptime 空闲巩固记忆，不占用对话 | Hub |
| S6 | 记忆可跨会话检索；禁止把 transcript 当记忆 | Hub |
| S7 | Tick 订阅 Channel / Git / 需求停滞 / 任务完成；续跑绑定原工作区 | Automation |
| S8 | 审议：计划可见；决策为做 / 问 / 等；主动性 `never` / `suggest` / `act-within-authority` | Hub |
| S9 | 一任务一隔离工位（worktree / sandbox）；终端与浏览器过程可回放 | Automation |
| S10 | 交付物为 PR / 文件 / 录像 / 命名输出；未测过不交卷 | Artifact |
| S11 | 会话、Channel、监控、API 共用同一章程与守卫 | Channel |
| S12 | 启用 / 停用、额度、决策审计；评测看交付成功率 | Artifact |

### 4.2 公司级

| ID | 需求 | 落点 |
|----|------|------|
| C1 | 编制：部门 / 团队 / 汇报线 / Agent Card（技能、忙闲、安全档） | Hub |
| C2 | 邮箱默认开 Task，不是往会话塞 prompt | Automation |
| C3 | Task 态：`submitted` → `working` → `input-required` \| `auth-required` → `completed` \| `rejected` \| `failed` \| `canceled`。终态不可复活，重做新 `taskId` | Automation |
| C4 | `request` 必须带说明书（目标、完成条件、输出、禁区、边界、预算），缺项 `rejected` | Automation |
| C5 | 言外行为：`request` / `consult` / `inform` / `handoff` / `escalate` / `reject` | Automation |
| C6 | 现有工作流图保留为**顺序图**默认交付拓扑；交接适配为 `handoff` Task | Automation |
| C7 | 子代理：压缩结果只回调用方。队友：独立席位、可互信、人可直连 | Hub |
| C8 | 共享看板：`pending` → `in_progress` → `completed`；依赖未完成不能领；认领加锁 | Hub |
| C9 | 编排-工人：工人互不可见，只回压缩摘要；另开校验关 | Automation |
| C10 | 卡住改账本再派，不盲重放同一 prompt；失败从检查点续 | Automation |
| C11 | 每封信标注名义：`obo` 或 `ambient` | Hub |
| C12 | 跨员工追踪用 span（路由 / LLM / 工具 / taskId），不记聊天全文 | Artifact |
| C13 | 简单查询禁止扩编；多员工仅用于高价值可并行活 | Automation |
| C14 | 高风险队友先 plan，批准后再改代码 | Artifact |
| C15 | 内部信默认不出 Channel；仅 `escalate` 到真人或站会摘要出站 | Channel |

拓扑选用（实现时写进 Task.topology，禁止运行时乱切）：

| topology | 何时 | 现网 |
|----------|------|------|
| `graph` | 质检链、强依赖编码 | 工作流 graph + snapshot |
| `orchestrator_workers` | 可并行且工人互不可见 | OMC 批量需补说明书与压缩回报 |
| `board` | 有依赖、要认领、要协商 | 待执行队列不是这张板 |
| `meeting` | 下一步取决于刚说的话 | 非默认；必须有终止器 |

## 5. 契约

前端组件不直接 `invoke`；新逻辑进 `src/services/org/*` 与 `src-tauri` 模块，不堆 `App.tsx` / `lib.rs`。

### 5.1 扩 `employees`（P0）

现有列保留。新增（JSON 列可先合一再拆）：

| 字段 | 说明 |
|------|------|
| `charter_json` | 职责、禁区、技能、命名 I/O、成功标准 |
| `identity_mode` | `delegated` \| `ambient` |
| `security_tier` | `S0` \| `S1` \| `S2` |
| `manager_employee_id` | 汇报线，可空（空则人类） |
| `department_id` | 可空 |
| `heartbeat_every_sec` | 默认 1800；`0` 关周期心跳 |
| `active_hours_json` | `{ start, end, tz }` |
| `initiative` | `never` \| `suggest` \| `act_within_authority` |
| `token_budget_daily` | 可空 |

`create_employee` / `update_employee` 向后兼容：新字段缺省。

### 5.2 新表（P0 最小）

`org_tasks`

- `id` PK
- `speech_act` `request|consult|inform|handoff|escalate|reject`
- `state` 见 C3
- `topology` 见上表，可空（handoff 默认 `graph`）
- `from_employee_id` / `to_employee_id`（人类发起则 from 空、`from_human` 真）
- `acting_as` `obo|ambient`
- `brief_json` 说明书；缺项插入前拒绝
- `parent_task_id` consult 深度用
- `workflow_task_id` / `workflow_snapshot_id` 可选，挂现有工作流
- `acting_session_id` 可选
- `checkpoint_json` P2 再用
- `ledger_json` P2 再用
- `created_at` / `updated_at`

`org_task_events`：`task_id` + `event_type` + `payload_json` + `created_at`（审计，不存思维链）。

P1 再加：`org_board_items`（依赖、认领租约）、`org_memory_entries`（scope + 检索）。

### 5.3 说明书 `brief_json`

必填：`goal`、`doneWhen`、`output`、`forbidden`、`boundary`、`budget`（`maxEmployees`、`maxToolCalls`）。缺任一 → 命令返回校验错误，不写库。

### 5.4 命令（P0 草案）

| 命令 | 作用 |
|------|------|
| `org_task_create` | 校验 brief → `submitted` |
| `org_task_get` / `org_task_list` | 按席位 / 状态 |
| `org_task_claim` | P1；P0 可跳过，由 to 直接 `working` |
| `org_task_transition` | 合法态迁移；终态禁止再迁 |
| `org_heartbeat_tick` | 内部：清该席位 inbox，无事不写 Task |
| `org_handoff_from_workflow` | 工作流下一节点 → `handoff` Task |

心跳与 Tick 的**时钟在 Rust**，前端只订阅读模型。现有 `useScheduledClaudeTaskRunner` 改为 attended 兼容路径，不删。

## 6. 模块落点

| 面 | 拥有 | 改哪里 |
|----|------|--------|
| Hub 编制台 | Card、章程、邮箱、看板、直连队友 | `EmployeeConfigModal` + `ProgressMonitorPanel` 合并为编制台，不新增顶栏入口 |
| Automation 总线 | 时钟、Task、handoff 适配、工人并行 | 新建 `src-tauri/src/org_*.rs`；`useWorkflowTeamAutomation` 交棒改走 `org_handoff_from_workflow` |
| Channel 门房 | 入站叫醒 Tick；出站仅 escalate/站会 | `remoteChannels` / 钉钉入站接到席位 inbox |
| Artifact | 命名输出、计划闸、span、成功率 | 审查抽屉 + 新 `org_task` 交付指针 |

服务层：`src/services/orgTasks.ts`、`src/services/orgEmployees.ts`（可先扩 `employees.ts`）。类型：`src/types/org.ts`，避免继续堆 `types.ts`。

## 7. 分期

单席位 P0 与公司 P0 **同一迭代交付**（没有心跳的席位无法清信）。公司 P1/P2 不得早于单席位 P0。

### P0 · 值班席位 + 可拒收交接

**单席位**

- [ ] S1 章程字段 + 员工配置表单
- [ ] S2 `identity_mode` / `security_tier`
- [ ] S3–S4 Rust Pulse + Heartbeat（`NO_REPLY`、时段、busy 让路）
- [ ] S7 Channel / Git / 需求 → 席位 inbox（可先 inbox 事件表，后并入 `org_tasks` inform）

**公司**

- [ ] C1 Card 最小：技能展示用章程技能；忙闲沿用监控
- [ ] C2–C5 `org_tasks` + 说明书校验 + 六种 speech_act
- [ ] C6 `org_handoff_from_workflow`；失败仍留在工作流 snapshot，不丢单
- [ ] C11 `acting_as` 必填
- [ ] C15 内部 Task 不出 Channel

**不改：** 工作流画布、cron 语义、反馈神经网、OMC 批量（P1 再接工人拓扑）。

**验收**

1. 新建员工可保存章程与 `ambient`；旧员工读写兼容。
2. Heartbeat 无待办 → 无新 Task、无 Channel 消息。
3. 缺 `doneWhen` 的 `request` → 命令错误，库中无行。
4. 工作流节点推进 → 下一员工收到 `handoff` Task，`state=submitted`，brief 含上一节点输出指针。
5. 接收方 `reject` → 发起方可见原因；工作流不丢 snapshot。
6. `completed` 后再 `transition` → 错误；重做生成新 id。

**预估文件**

```
src-tauri/migrations/0xx_org_employee_charter.sql
src-tauri/migrations/0xx_org_tasks.sql
src-tauri/src/org_tasks.rs
src/types/org.ts
src/services/orgTasks.ts
src/components/EmployeeConfigModal/     章程字段
src/hooks/useWorkflowTeamAutomation.ts  handoff 适配
```

P0–P2 界面形态见 [prototype/index.html](./prototype/index.html)（编制台、邮箱 Task、缺说明书拒收、工作流交接、看板认领、心跳静默）。

### P1 · 看板与工人

- [ ] C8 看板认领 + 依赖 + 锁
- [ ] C7 人类从监控抽屉直连队友（已有抽屉则接 Task）
- [ ] C9 `topology=orchestrator_workers`：brief 切分、压缩回报、独立校验席位
- [ ] S5–S6 员工目录记忆 + Sleeptime（与 Heartbeat 分进程/分调用）
- [ ] S8 计划可见（复用 todo dock，写入 Task ledger 雏形）
- [ ] S9 一任务一 worktree 开关（复用无人值守 isolation）

**验收**

1. 两队友抢同一 `pending` → 仅一人 `in_progress`。
2. 依赖未完成 → `claim` 失败。
3. 工人回报不含另一工人原文；Lead 只收到摘要。
4. 无说明书扩 10 人 → 拒绝。
5. Sleeptime 跑时 Heartbeat 仍可 `NO_REPLY`。

### P2 · 账本、预算、观测

- [ ] C10 ledger + checkpoint 续跑
- [ ] C13 日额度；超限停 Ambient，Delegated 升级人类
- [ ] C14 计划批准闸
- [ ] C12 OTel span（taskId、from、to、state）
- [ ] S10 未测过不能 `completed`
- [ ] S11 编制台与 Channel 读同一 Card
- [ ] S12 停用员工：拒收新 Task，在途 `canceled` 或移交经理

**验收**

1. 杀进程后同 `taskId` 从 checkpoint 续，不新开空会话。
2. 卡住 → ledger 出现新计划，而非同一 prompt 重放。
3. 编制台能看到 A→B 的 Task 态，看不到思维链。
4. 简单事实题走单席位；强制 `orchestrator_workers` 且 `maxEmployees>1` 被拒。

## 8. 闸（实现断言）

写进 `org_tasks` 校验与 Heartbeat runner，不要只写在 UI：

1. 缺说明书 → reject。
2. `consult` 深度 > 2 → reject。
3. 同一 `taskId` 禁止循环 `request`。
4. Heartbeat 禁止群发、禁止新建 Mission。
5. 终态不复活。
6. `graph` 为编码默认；`meeting` 必须带 `terminator`。
7. 工人拓扑禁止工人互读全文。

## 9. 测试

- 单元：`brief` 校验、态迁移表、consult 深度、认领锁、handoff 从 workflow snapshot 映射。
- 集成（mock worker）：P0 验收 1–6；不要求真 LLM。
- Heartbeat：固定时钟，无 inbox → 零 Task 行。

## 10. 回滚

- P0 新表可留空；`handoff` 适配用开关 `org.handoff.enabled`，关则走原 `dispatchTeamStepToEmployeeSession`。
- 员工新列缺省，旧客户端忽略。
- 不改工作流图存储格式。
