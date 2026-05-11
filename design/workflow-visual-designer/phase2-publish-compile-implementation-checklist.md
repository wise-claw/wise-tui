# Wise 可视化工作流设计器 Phase 2（发布编译兼容）实施任务单

## 1. 目标与边界

本阶段目标：在 Phase 1“设计器草稿可编辑”的基础上，完成“发布前校验 + Graph 编译 + 与现有执行引擎兼容运行”。

本阶段不包含：

- DAG 多分支并行真实执行
- 节点级 token 引擎
- 脚本表达式运行时

交付完成定义（DoD）：

- 可视化图可发布为可执行模板
- 发布后可直接创建任务并按现有阶段引擎流转
- 驳回/通过行为与当前逻辑保持一致
- 发布失败时数据库不产生脏写

---

## 2. 核心实现策略（兼容优先）

采用“双模型”策略：

- 设计态：`workflow_graphs.graph_json`
- 执行态：现有 `workflow_stages + stage_assignees`

发布动作本质是“编译 + 同步”：

1. 图校验（结构 + 业务 + 可编译性）
2. 图编译（Graph -> Stages）
3. 单事务写入：
   - `workflow_graphs`（状态改为 published、写 compiled 快照）
   - `workflows`
   - `workflow_stages`
   - `stage_assignees`

---

## 3. 编译规则（V1 固定）

## 3.1 可编译图约束

V1 仅支持“单主干审批链 + 可选驳回回退”：

- 必须且仅有 1 个 `start`
- 至少 1 个 `end`
- 主干上 `approval` 节点必须可线性排序
- 不允许并行分叉后再汇聚
- 不允许 `approval` 到多个 `approved` 出边

允许结构：

- `start -> task? -> approval -> approval -> ... -> end`
- `approval -(rejected)-> 上一审批节点 或 end(驳回终止)`

## 3.2 节点映射规则

- `approval` 节点映射到 `workflow_stages`
- `stage_order` 按主干拓扑顺序自 0 递增
- `pass_rule` 直接来自节点配置
- `reject_rule` 统一写 `ANY_REJECT_BACK`
- `assignees` 直接映射到 `stage_assignees`

说明：

- `start/task/end` 节点仅参与设计表达，不落地为 stage
- 若图中无 `approval` 节点，发布失败

## 3.3 驳回边处理

V1 驳回只做“合法性校验”，不改变现有引擎行为：

- 允许 `rejected` 边指向上一审批节点（推荐）
- 允许 `rejected` 指向 `end`（表示终止）
- 但运行时仍由现有规则处理：`current_stage_index - 1` 或标记 rejected

---

## 4. 文件级任务拆解

## 4.1 FE-A（设计器发布交互）

1) 发布入口与状态

- [ ] 改造 `src/components/WorkflowConfigModal/index.tsx`
- [ ] 新增按钮：`保存草稿` / `发布模板`
- [ ] 发布中禁用编辑操作并显示 loading

验收：
- [ ] 点击发布后有明确反馈（成功/失败）

2) 校验反馈面板

- [ ] 新建 `src/components/WorkflowDesigner/ValidationPanel.tsx`
- [ ] 展示后端返回 errors 列表
- [ ] 点击错误项可定位对应节点/边

验收：
- [ ] 发布失败时可快速定位并修复

3) 发布后回显

- [ ] 发布成功后刷新模板列表
- [ ] 当前编辑模板状态更新为 published

验收：
- [ ] 重新打开模板仍展示发布前布局与数据

## 4.2 FE-B（服务、编译预览、类型）

1) 类型扩展

- [ ] 扩展 `src/types.ts`：
  - `WorkflowGraphValidationResult`
  - `WorkflowCompileStagePreview`
  - `WorkflowGraphStatus`（draft/published）

2) 服务扩展

- [ ] 修改 `src/services/workflowGraphs.ts`
- [ ] 新增方法：
  - `publishWorkflowGraph(workflowId: string)`
  - `previewWorkflowCompile(input)`（可选）

3) 前端预校验

- [ ] 新建 `src/components/WorkflowDesigner/graphValidation.ts`
- [ ] 实现轻量校验（start/end 数量、空 assignees、孤立节点）
- [ ] 失败时不发起发布请求

4) 编译预览（可选但建议）

- [ ] 发布前展示“将生成的阶段清单”预览
- [ ] 对比现有阶段，给出变更提示（新增/删除/调整）

验收：
- [ ] 用户可在发布前理解影响范围

## 4.3 BE（校验器 + 编译器 + 事务）

1) 数据库迁移补充

- [ ] 新增 migration：`011_workflow_graph_publish.sql`
- [ ] 在 `workflow_graphs` 增加：
  - `compiled_stages_json TEXT`
  - `status TEXT NOT NULL DEFAULT 'draft'`
  - `published_at INTEGER`

验收：
- [ ] 历史数据自动补默认值

2) Rust DTO 与校验错误结构

- [ ] 修改 `src-tauri/src/lib.rs`
- [ ] 增加结构：
  - `WorkflowGraphValidationError { code, message, node_id?, edge_id? }`
  - `WorkflowGraphValidationResult { ok, errors }`

3) Graph 校验器（服务端最终裁决）

- [ ] 新建 `src-tauri/src/workflow_graph_validator.rs`（建议）
- [ ] 校验类别：
  - 结构合法性
  - 可达性
  - 可编译性（单主干限制）
  - 业务合法性（approval assignees）

4) Graph 编译器

- [ ] 新建 `src-tauri/src/workflow_graph_compiler.rs`（建议）
- [ ] 输出：
  - `Vec<WiseWorkflowStageRow>`
  - `Vec<WiseStageAssigneeRow>`
  - `compiled_stages_json`

5) 发布命令

- [ ] 在 `lib.rs` 新增 `publish_workflow_graph(workflow_id)`
- [ ] 执行步骤：
  - 读取 graph
  - 校验
  - 编译
  - 事务同步模板与阶段
  - 标记 `workflow_graphs.status = 'published'`

6) Repository 事务能力

- [ ] 修改 `src-tauri/src/wise_db.rs`
- [ ] 新增 `publish_workflow_graph_with_compiled(...)`
- [ ] 保证“删旧阶段 + 写新阶段 + 写 assignees + 更新 graph 状态”原子化

验收：
- [ ] 任一步失败时全回滚，不留半成品

---

## 5. 接口契约（Phase 2）

## 5.1 `publish_workflow_graph`

输入：

```ts
{ workflowId: string }
```

输出：

```ts
{
  workflow: WorkflowTemplateItem;
  graphStatus: "published";
  compiledStages: Array<{
    stageId: string;
    name: string;
    stageOrder: number;
    passRule: "ALL_APPROVE" | "ANY_APPROVE";
    assigneeCount: number;
  }>;
}
```

失败示例：

```ts
{
  code: "WF_GRAPH_NOT_COMPILABLE",
  message: "流程包含暂不支持的分支汇聚结构",
  details: {
    errors: [
      { code: "WF_GRAPH_MULTI_BRANCH", nodeId: "node_xxx", message: "审批节点存在多个 approved 出边" }
    ]
  }
}
```

## 5.2 `validate_workflow_graph`（升级版）

输入：

```ts
{ workflowId?: string; graph: WorkflowGraph; mode: "save" | "publish" }
```

输出：

```ts
{
  ok: boolean;
  errors: Array<{ code: string; message: string; nodeId?: string; edgeId?: string }>;
  warnings: Array<{ code: string; message: string; nodeId?: string; edgeId?: string }>;
}
```

---

## 6. 事务步骤（后端必须按序）

发布事务伪流程：

1. `BEGIN`
2. 校验 `workflow_id` 存在
3. 读取 `workflow_graphs.graph_json`
4. 执行 validator（失败直接回滚）
5. 执行 compiler 得到 stages + assignees
6. `DELETE stage_assignees WHERE stage_id IN (...)`
7. `DELETE workflow_stages WHERE workflow_id = ?`
8. 批量 `INSERT workflow_stages`
9. 批量 `INSERT stage_assignees`
10. 更新 `workflow_graphs`：`status/published_at/compiled_stages_json/version`
11. 更新 `workflows.updated_at`（及默认标记）
12. `COMMIT`

失败处理：

- 任一步异常 -> `ROLLBACK`
- 返回统一错误码与 message

---

## 7. 每日排期建议（6 天）

Day 1
- FE-A：发布按钮与校验面板骨架
- FE-B：类型与服务契约升级
- BE：011 migration + DTO 定义

Day 2
- FE-A：错误定位到节点
- FE-B：前端预校验
- BE：validator 初版

Day 3
- FE：联调 validate 接口
- BE：compiler 初版（单主干）

Day 4
- FE：发布流程联调
- BE：publish 事务落库

Day 5
- 全员：异常路径与回滚验证

Day 6
- 全员：回归测试、文档补充、演示脚本彩排

---

## 8. 测试清单（Phase 2 必测）

功能：

- [ ] 合法图发布成功，并生成可执行 stages
- [ ] 发布后创建任务，任务进入 stage 0
- [ ] 审批通过后推进下一阶段
- [ ] 审批拒绝后按现有规则回退/终止

校验：

- [ ] 无 start 图发布失败
- [ ] 多 start 图发布失败
- [ ] approval 无 assignees 发布失败
- [ ] 含分支汇聚图发布失败（V1 限制）

事务与一致性：

- [ ] 发布中途故障后 DB 无半更新数据
- [ ] 重复发布同模板不会产生重复脏数据

回归：

- [ ] 旧表单模式保存模板仍可用
- [ ] 现有任务流转接口行为不变

---

## 9. 风险与应对

风险 1：编译规则与产品预期不一致
- 应对：先冻结“V1 可编译子集”并在 UI 明示限制

风险 2：前端预校验与后端校验差异
- 应对：后端结果为准，前端仅提前提示

风险 3：发布后旧任务受影响
- 应对：仅影响后续新任务；旧任务仍按创建时 stage 快照执行

---

## 10. 本阶段交付物清单

- [ ] `phase2-publish-compile-implementation-checklist.md`（本文档）
- [ ] `workflow_graph_validator` 与 `workflow_graph_compiler` 实现代码
- [ ] 发布命令与事务落库代码
- [ ] 一段联调录屏（发布 -> 创建任务 -> 推进/驳回）

完成以上项即可进入 Phase 3（执行态可视化联动）。

