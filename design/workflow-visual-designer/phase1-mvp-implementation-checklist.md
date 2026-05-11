# Wise 可视化工作流设计器 Phase 1（MVP）实施任务单

## 1. 目标与边界

本阶段目标：在不改动现有任务执行引擎前提下，完成“可视化编辑 + 草稿保存 + 回显编辑”的最小闭环。

本阶段不包含：

- 图发布编译（Graph -> stages）
- 执行态图高亮
- DAG 真实运行时

交付完成定义（DoD）：

- 可在 UI 创建流程图（节点、连线、拖拽）
- 可保存为模板草稿并重新打开编辑
- 老模板可转换为基础图回显
- 无阻塞现有工作流表单模式

---

## 2. 并行分工建议

### FE-A（画布与交互）

- `WorkflowDesigner` 组件与节点渲染
- 节点/边交互（拖拽、连线、删除）
- 与 `WorkflowConfigModal` 集成

### FE-B（类型、服务、状态）

- `types.ts` 图模型类型扩展
- `services/workflowGraphs.ts` 服务封装
- 保存/加载/错误处理与表单模式切换状态

### BE（Tauri + SQLite）

- migration + repository + command
- graph_json 持久化与读取
- 基础结构校验（字段完整性）

---

## 3. 文件级任务拆解

## 3.1 FE-A 任务

1) 新增设计器组件骨架

- [ ] 新建 `src/components/WorkflowDesigner/index.tsx`
- [ ] 新建 `src/components/WorkflowDesigner/index.css`
- [ ] 在组件内接入 `@xyflow/react` 基础容器（ReactFlow + Controls + Background）

验收：
- [ ] 进入设计器后可看到画布与基础控件

2) 节点类型与渲染

- [ ] 新建 `src/components/WorkflowDesigner/nodes/StartNode.tsx`
- [ ] 新建 `src/components/WorkflowDesigner/nodes/TaskNode.tsx`
- [ ] 新建 `src/components/WorkflowDesigner/nodes/ApprovalNode.tsx`
- [ ] 新建 `src/components/WorkflowDesigner/nodes/EndNode.tsx`
- [ ] 在 `index.tsx` 注册 `nodeTypes`

验收：
- [ ] 可添加四类节点并正确显示标签

3) 交互能力

- [ ] 节点拖拽位置更新
- [ ] 连线创建（onConnect）
- [ ] 节点/边删除（键盘 Delete + 操作按钮）
- [ ] 视口缩放与拖动画布

验收：
- [ ] 节点位置、连线变化可实时反映到本地状态

4) 与配置弹窗集成

- [ ] 改造 `src/components/WorkflowConfigModal/index.tsx`
- [ ] 增加“表单模式 / 设计器模式”切换
- [ ] 设计器模式下隐藏旧阶段列表编辑区域

验收：
- [ ] 可在同一弹窗内切换两种编辑模式

## 3.2 FE-B 任务

1) 类型定义

- [ ] 在 `src/types.ts` 增加：
  - `WorkflowGraph`
  - `WorkflowGraphNode`
  - `WorkflowGraphEdge`
  - `WorkflowGraphNodeType`

验收：
- [ ] TS 严格模式无 any，类型可被前后端共享调用

2) 服务层

- [ ] 新建 `src/services/workflowGraphs.ts`
- [ ] 提供方法：
  - `getWorkflowGraph(workflowId: string)`
  - `saveWorkflowGraph(input)`
  - `validateWorkflowGraph(input)`

验收：
- [ ] 所有 invoke 调用集中在 service，不在组件中直接 invoke

3) 本地状态与草稿流程

- [ ] 在 `WorkflowConfigModal` 增加设计器草稿状态
- [ ] 打开模板时优先读取 graph，无 graph 时由线性模板转图
- [ ] 保存时提交 graph_json

验收：
- [ ] 重新打开弹窗可回显上次画布布局

4) 线性模板转图（临时适配器）

- [ ] 新建 `src/components/WorkflowDesigner/legacyAdapter.ts`
- [ ] 实现 `stagesToGraph(stages)`：
  - 自动补 start/end
  - 每个 stage 转 approval 节点
  - 相邻 stage 建立 always 边

验收：
- [ ] 历史模板进入设计器可自动可视化

## 3.3 BE 任务

1) 数据库迁移

- [ ] 新增 `src-tauri/migrations/010_workflow_graph.sql`
- [ ] 创建 `workflow_graphs` 表

建议字段：
- `workflow_id TEXT PRIMARY KEY`
- `version INTEGER NOT NULL`
- `graph_json TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'draft'`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

验收：
- [ ] 全新库与增量库均可成功迁移

2) Repository 扩展

- [ ] 修改 `src-tauri/src/wise_db.rs`
- [ ] 新增方法：
  - `get_workflow_graph(workflow_id: &str)`
  - `upsert_workflow_graph(...)`

验收：
- [ ] 可读写 graph_json，更新同 workflow_id 时覆盖

3) Tauri 命令扩展

- [ ] 修改 `src-tauri/src/lib.rs`
- [ ] 新增命令：
  - `get_workflow_graph`
  - `save_workflow_graph`
  - `validate_workflow_graph`（Phase1 做基础结构校验）
- [ ] 注册到 `invoke_handler`

验收：
- [ ] 前端可成功调用并获得稳定错误信息

---

## 4. 接口契约（Phase 1）

## 4.1 `save_workflow_graph`

输入：

```ts
{
  workflowId?: string;
  name: string;
  isDefault: boolean;
  graph: WorkflowGraph;
}
```

输出：

```ts
{
  workflow: WorkflowTemplateItem;
  graph: WorkflowGraph;
}
```

说明：
- Phase 1 可先只保存 graph 到 `workflow_graphs`
- 若 workflow 不存在则创建基础 workflow 记录

## 4.2 `get_workflow_graph`

输入：

```ts
{ workflowId: string }
```

输出：

```ts
{
  graph: WorkflowGraph | null;
}
```

## 4.3 `validate_workflow_graph`（基础版）

输入：

```ts
{ graph: WorkflowGraph }
```

输出：

```ts
{
  ok: boolean;
  errors: Array<{ code: string; message: string; nodeId?: string; edgeId?: string }>;
}
```

---

## 5. 每日排期建议（5 天）

Day 1
- FE-A：设计器容器 + 基础节点
- FE-B：类型定义 + service 脚手架
- BE：010 migration + repository 骨架

Day 2
- FE-A：连线/删除/拖拽
- FE-B：modal 集成与模式切换
- BE：save/get commands

Day 3
- FE-A：交互完善（空状态、工具栏）
- FE-B：线性模板转图适配
- BE：validate command（基础校验）

Day 4
- FE：全链路联调 + 错误提示统一
- BE：事务稳定性与异常路径修正

Day 5
- 全员：回归、文档更新、演示脚本走查

---

## 6. 测试清单（Phase 1 必测）

功能：

- [ ] 新建模板并在设计器添加 3 个节点、2 条边
- [ ] 保存后关闭弹窗，再次打开回显一致
- [ ] 编辑节点名称后保存，刷新后仍一致
- [ ] 删除节点后相关边正确移除
- [ ] 从已有线性模板进入设计器可自动转换

异常：

- [ ] 断网/命令失败时错误提示可读
- [ ] 非法 graph（空 nodes）保存被拦截
- [ ] workflowId 不存在时返回明确错误码

回归：

- [ ] 表单模式创建/编辑流程不受影响
- [ ] 现有任务创建与审批链路不受影响

---

## 7. 风险与阻塞处理

潜在阻塞：

- `WorkflowConfigModal` 改造冲突较大（当前文件较长）
- `src/types.ts` 多人并行修改冲突概率高

处理建议：

- FE-A 主持 `WorkflowConfigModal` 变更，其他人避免同文件并改
- FE-B 先拆分 workflow 图类型到独立文件，再导出到 `types.ts`
- BE 命令名先冻结，避免前端重复改 invoke 名称

---

## 8. 本阶段交付物清单

- [ ] `design/workflow-visual-designer/xyflow-rnd-visual-designer-execution-plan.md`（总方案）
- [ ] 本文档（Phase 1 任务单）
- [ ] 可运行代码（前端设计器 + 后端图存储）
- [ ] 一段 3~5 分钟演示录屏（创建、保存、回显）

达到以上四项即判定 Phase 1 完成，可进入 Phase 2（发布编译兼容）。

