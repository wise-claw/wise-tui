# 员工与团队进度监控：文件级改造清单

本文档给出“具体到文件”的改造落地项，按依赖顺序组织，便于直接实施。

## 0. 目标产物

- 左侧栏新增监控面板（员工 + 团队）；
- 右侧新增详情抽屉（员工详情 / 团队详情）；
- 聚合逻辑集中在新 hook，避免把业务判断塞进展示组件。

---

## 1. 新增文件

## 1.1 `src/types.ts`

新增监控面板相关类型（建议放在现有 Workflow/Session 类型后）：

- `MonitorStatus = "in_progress" | "idle"`
- `EmployeeMonitorItem`
  - `employeeId`
  - `name`
  - `agentType`
  - `status`
  - `previewText`
  - `activeTaskId?`
  - `sessionId?`
  - `updatedAt`
- `TeamMonitorItem`
  - `workflowId`
  - `workflowName`
  - `status`
  - `previewText`
  - `activeTaskId?`
  - `currentEmployeeId?`
  - `currentEmployeeName?`
  - `currentStageIndex?`
  - `stageCount?`
  - `progressText`
  - `updatedAt`
- `MonitorStats`
  - `activeEmployees`
  - `employeesInProgress`
  - `employeesIdle`
  - `teamsTotal`
  - `teamsInProgress`
  - `teamsIdle`
- `MonitorDrawerTarget`
  - `{ type: "employee"; employeeId: string }`
  - `{ type: "team"; workflowId: string }`

## 1.2 `src/hooks/useMonitorOverview.ts`

新增聚合 hook，输入现有 App 状态，输出：

- `employeeMonitorItems: EmployeeMonitorItem[]`
- `teamMonitorItems: TeamMonitorItem[]`
- `stats: MonitorStats`
- `lookup`（详情抽屉快速查询索引）

核心函数拆分建议：

- `buildEmployeeMonitorItems(...)`
- `buildTeamMonitorItems(...)`
- `resolvePreviewText(...)`
- `resolveCurrentEmployee(...)`
- `makeProgressText(...)`

## 1.3 `src/components/ProgressMonitorPanel/index.tsx`

新增左侧监控面板组件：

- Props 建议：
  - `employeeItems`
  - `teamItems`
  - `stats`
  - `onOpenEmployeeDetail(employeeId)`
  - `onOpenTeamDetail(workflowId)`
- 员工区、团队区分块渲染；
- 列表项支持点击、hover tooltip、空态文案。

## 1.4 `src/components/ProgressMonitorPanel/index.css`

新增样式：

- 命名遵循 `.app-` 前缀；
- 状态标签 `--in-progress` / `--idle`；
- 单行省略、紧凑布局、深浅色 token 兼容。

## 1.5 `src/components/ProgressMonitorDrawer/index.tsx`

新增右侧详情抽屉组件：

- Props 建议：
  - `open`
  - `target`
  - `onClose`
  - `employeeItems/teamItems`
  - `workflowTasks`
  - `workflowTaskEventsByTaskId`
  - `workflowRuntimeSnapshotsByTaskId`
  - `taskPendingEmployeesByTaskId`
  - `sessions`
  - `employees`
  - `workflowTemplates`
- 按 target 分支渲染员工详情/团队详情；
- 默认展示最近 20 条，支持“加载更多”。

## 1.6 `src/components/ProgressMonitorDrawer/index.css`

新增详情样式：

- 抽屉头部信息、分区标题、时间线块、消息块；
- 内容溢出滚动控制；
- Tag/文本颜色全部使用 Ant token 变量。

---

## 2. 修改现有文件

## 2.1 `src/App.tsx`

### 状态新增

- `const [monitorDrawerOpen, setMonitorDrawerOpen] = useState(false);`
- `const [monitorDrawerTarget, setMonitorDrawerTarget] = useState<MonitorDrawerTarget | null>(null);`

### 逻辑新增

- 调用 `useMonitorOverview(...)` 获取 `employeeMonitorItems/teamMonitorItems/stats`；
- 新增打开详情方法：
  - `openEmployeeMonitorDetail(employeeId)`
  - `openTeamMonitorDetail(workflowId)`
- 关闭详情方法：`closeMonitorDrawer()`

### 渲染接入

- 给 `LeftSidebar` 追加 props（面板展示数据 + 点击回调）；
- 在主布局挂载 `ProgressMonitorDrawer`。

## 2.2 `src/components/LeftSidebar.tsx`

### Props 扩展

- `employeeMonitorItems?`
- `teamMonitorItems?`
- `monitorStats?`
- `onOpenEmployeeMonitorDetail?`
- `onOpenTeamMonitorDetail?`

### 结构改造

- 在项目列表容器之后插入 `<ProgressMonitorPanel />`；
- 保持现有项目/仓库/员工结构不受影响；
- 当侧栏折叠时不渲染监控面板（或最小化占位，二选一，建议不渲染）。

## 2.3 `src/components/ClaudeSessions/index.css`（可选）

仅在需要与现有 Drawer 统一样式时调整公共 token 类，不改业务结构。

---

## 3. 可选增强（非 MVP 必需）

## 3.1 `src/utils/monitorPreview.ts`（可选新增）

提取文本归一化与截断逻辑，避免重复实现。

## 3.2 `src/components/WorkflowRuntimeViewer/index.tsx`（可选）

若团队详情需要更完整流程图可视化，复用该组件并增加只读紧凑模式。

---

## 4. 代码实施顺序（建议）

1. 先补 `types.ts` 新类型；
2. 实现 `useMonitorOverview.ts` 并写最小单元函数（哪怕当前项目无测试，也要保证纯函数可独立验证）；
3. 实现 `ProgressMonitorPanel` 静态渲染；
4. App 接入聚合数据并传给 LeftSidebar；
5. 实现 `ProgressMonitorDrawer`；
6. 回到 LeftSidebar 插入面板并打通点击；
7. 统一样式细节与空态；
8. 手工回归。

---

## 5. 手工回归清单（落地时必跑）

- 左侧显示：
  - 有员工/有团队/无数据三种场景；
  - 状态切换是否实时刷新；
  - 文本截断与 tooltip 是否正确。
- 详情抽屉：
  - 员工条目点击后详情正确；
  - 团队条目点击后“当前处理员工 + 阶段进度 + 最近事件”正确；
  - 关闭后再打开目标切换正确。
- 主题：
  - 深色/浅色模式视觉可读性；
  - Tag、边框、背景是否使用 token 变量。
- 兼容：
  - 快照缺失、会话为空、模板缺失时是否有兜底文案。

---

## 6. 风险与应对

- 风险：状态来源多，容易判定冲突  
  应对：所有状态判定收敛在 `useMonitorOverview.ts`，组件只读结果。

- 风险：聚合计算导致重渲染偏多  
  应对：`useMemo` + map 索引 + 预览字符串预裁剪。

- 风险：团队“当前处理员工”不稳定  
  应对：明确优先级（pendingEmployees > latestEvent > fallback）。

---

## 7. 完成定义（文件级）

满足以下即视为该改造完成：

- 新增文件已创建并接入：
  - `src/hooks/useMonitorOverview.ts`
  - `src/components/ProgressMonitorPanel/index.tsx`
  - `src/components/ProgressMonitorPanel/index.css`
  - `src/components/ProgressMonitorDrawer/index.tsx`
  - `src/components/ProgressMonitorDrawer/index.css`
- `src/types.ts` 类型补齐；
- `src/App.tsx` 与 `src/components/LeftSidebar.tsx` 接入完成；
- 手工回归项全部通过。

