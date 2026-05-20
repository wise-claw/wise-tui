# 指挥台实施计划

本文对应 [ARCHITECTURE.md](./ARCHITECTURE.md) v3，按**每周可验收**拆分。原则：**先管线、后 UI、最后切默认 ViewMode**。

API 细节见 [API-CONTRACT.md](./API-CONTRACT.md)。

---

## 总览

| 阶段 | 周期 | 交付物 | 验收关键词 |
|------|------|--------|------------|
| W1 | 第 1 周 | gateHub 管线 + GateBar 最小条 | 跨会话 AskUserQuestion 出现在中栏 |
| W2 | 第 2 周 | FocusContext + LensPanel 初版 | 答题时右栏定位 stdout |
| W3 | 第 3 周 | WorkItemFeed + dispatch 挂钩 | 派发 → Gate → 完成 可追溯 |
| W4 | 第 4 周 | CommandSurface 定型 + 宪法同步 | 默认屏为指挥台非空白 Chat |
| W5+ | 可选 | 批量 Permission、Blocker 改派 | 产品增强 |

---

## W1 · 管线接通（UI 几乎不变）

### 目标

任意仓库的 AskUserQuestion / Permission 进入全局 Gate 队列，并在中栏可见。

### 任务

- [ ] 新建 `src/command/gateHub.ts`（委托 `notificationHub`）
- [ ] 新建 `src/command/types.ts`（`Gate`, `GateKind`, `GateAnswer`）
- [ ] Session 元数据：创建/绑定时写入 `missionId`、`assignmentId`（或从 `correlationId` 反查）
- [ ] `useClaudeSessions`：question/permission 到达时调用 `gateHub.ingestFromSession(sessionId)`
- [ ] 新建 `src/components/CommandSurface/GateBar.tsx`（最小：pending 数 + 第一题 + 答题）
- [ ] 在 `AppWorkspaceLayout` 或 `ClaudeSessions` 顶栏挂载 GateBar（不改变默认布局）

### 不改

- `notificationHub` 内核
- 默认 ViewMode（仍为 `chat`）
- 右栏 `ChatInspector`

### 验收

1. 在仓库 A 触发 AskUserQuestion → GateBar 显示，带来源仓库名  
2. 在中栏答题 → Agent 续跑，Gate 消失  
3. 仓库 B 同时出题 → GateBar 显示队列（≥2 条）  
4. 子进程结束 → 对应 Gate 变 `expired`，不可再提交  

### 涉及文件（预估）

```
src/command/gateHub.ts          [新建]
src/command/types.ts            [新建]
src/components/CommandSurface/GateBar.tsx  [新建]
src/hooks/useClaudeSessions.ts  [改]
src/AppImpl.tsx                 [改：订阅 gateHub]
```

---

## W2 · 焦点与右栏

### 目标

Gate 与 WorkItem/Assignment 可联动；右栏随焦点展示上下文。

### 任务

- [ ] `src/hooks/useFocusContext.ts` + Provider（挂于 `AppImpl`）
- [ ] `gateHub.resolve` 时更新 FocusContext（可选自动切下一 Gate）
- [ ] 左栏徽章：`useWorkspaceBadges()` 聚合 pending Gate + running Assignment
- [ ] `src/components/Inspector/LensPanel.tsx`（或重构 `ChatInspector`）
  - [ ] `focus.level === "gate"` → 题干 + stdout 片段 + diff 链接
  - [ ] `focus.level === "assignment"` → 完整 monitor + GitPanel
- [ ] 从 `ClaudeChatInput/composer-region` 抽离答题 UI 组件，供 GateBar 复用

### 验收

1. 点击 GateBar 某题 → 右栏滚动/展示对应 Agent 输出  
2. 左栏 wise 节点显示 ⚡ 计数与 GateBar 一致  
3. 答题全程不强制跳转 Chat 标签页  

---

## W3 · 工作项流

### 目标

中栏增加 WorkItemFeed；派发指令创建可列表追踪的 WorkItem。

### 任务

- [ ] Migration `028_command_surface.sql`：`mission_runs.intent_text`, `focus_correlation_id`
- [ ] `src/command/dispatch.ts`：`dispatchIntent()` 包装 `planAtMentionDispatch` + mission upsert
- [ ] `src/hooks/useWorkItemFeed.ts`：列表 `mission_runs`
- [ ] `src/components/CommandSurface/WorkItemFeed.tsx`
- [ ] `src/components/CommandSurface/CommandBar.tsx`（从 composer 抽离 @mention 输入）
- [ ] Assignment 写入 `waiting_gate` / 恢复 `running`（Gate open/resolve 钩子）

### 验收

1. CommandBar 输入 `@wise 做 X` → Feed 出现新 WorkItem  
2. 执行中 → 状态 `running`；出 Gate → `waiting_gate`；答完 → `running` → `succeeded`  
3. 点击 Feed 行 → `focusWorkItem(missionId)` → 右栏展示该 Mission 摘要  

---

## W4 · 指挥台定型

### 目标

默认 Operator 视图为 Command Surface；Chat/Mission 经 inspect 进入。

### 任务

- [ ] `AppWorkspaceLayout`：中栏默认渲染 `CommandSurface`（WorkItemFeed + GateBar + CommandBar）
- [ ] `useViewMode`：新增 `command` kind；`DEFAULT_VIEW_MODE` → `{ kind: "command" }`
- [ ] Chat：`inspect { tool: "session", sessionId }`；入口在 WorkItem / 左栏仓库
- [ ] Mission：`inspect { tool: "mission", missionId }`；PRD 拆分入口保留
- [ ] Permission 批量批准（同 repo + 同 tool pattern）
- [ ] Gate 超时 → `wiseNotificationIngest` 桌面通知
- [ ] 更新 `.trellis/spec/guides/agent-harness-architecture.md` §3–§4、§6

### 验收

1. 冷启动默认见 WorkItemFeed + GateBar，而非「发送消息开始对话」  
2. 从左栏打开仓库会话 → inspect 叠层，三栏仍可见  
3. PRD 拆分 → inspect.mission，完成后 WorkItem 状态更新  
4. 宪法文档与实现一致（Reviewer 对照 checklist）  

---

## W5+ · 增强（可选）

- [ ] Blocker Gate：失败 → 改派 / 跳过 / 重跑  
- [ ] `gate.opened` / `gate.resolved` / `work-item.closed` 写入 `trellis_runtime_events`  
- [ ] WorkItem 与 `NotificationInboxPanel` 非阻塞通知合并展示策略  
- [ ] Standalone 升格后历史 WorkItem `project_id` 回填  
- [ ] Mission 画布选中任务 ↔ FocusContext `assignment` 双向同步  

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Session 无 missionId，Gate 无法归属 | W1 强制：派发时写 metadata；无 metadata 的 Gate 进「未归属」队列并打标 |
| 双处答题（GateBar + 旧 composer） | W2 起仓库 composer 的 question dock 改为「已在中栏处理」或只读镜像 |
| AppImpl 状态继续膨胀 | FocusContext 单点；gateHub 独立模块；CommandSurface 子组件化 |
| 与 05-18 CockpitSurface 迁移冲突 | Mission/助手走 inspect；CommandSurface 与 CockpitSurface 并行，不删 MissionControl 内核 |

---

## Definition of Done（全方案）

- [ ] 所有 blocking 交互只在中栏 GateBar 完成  
- [ ] 任意 Gate 可追溯到 `missionId` + `assignmentId` + `sessionId`  
- [ ] FocusContext 驱动右栏，无静态三件套混排  
- [ ] 派发 → 执行 → Gate → resolve → 终态 全链路在 WorkItemFeed 可见  
- [ ] 宪法文档已更新并通过架构 Review  
