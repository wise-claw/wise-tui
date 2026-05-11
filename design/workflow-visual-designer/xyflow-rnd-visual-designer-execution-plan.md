# Wise 研发流程可视化设计器（基于 XYFlow）完整可执行方案

## 1. 文档目标

本方案用于指导 Wise 在现有“员工 + 工作流 + 任务流转”能力之上，建设一套可视化研发流程设计器，确保：

- 可落地：按阶段拆解到具体模块与接口，研发可直接开工
- 可兼容：不破坏当前线性阶段执行引擎，先增量升级
- 可演进：从线性流程平滑演进到 DAG（分支/汇聚）流程
- 可验收：每阶段提供验收标准、演示脚本、上线门槛

---

## 2. 背景与范围

### 2.1 当前基线（已存在能力）

当前项目已具备以下基础：

- 数据库已有 `workflows`、`workflow_stages`、`stage_assignees`、`tasks`、`task_stage_decisions`、`task_events`
- 前端已有工作流配置弹窗（表单式阶段配置）与任务时间线
- 后端已有工作流模板保存、任务创建、审批推进/退回命令

结论：业务闭环已具备，当前短板在“流程建模体验与表达能力”。

### 2.2 本次新增范围（In Scope）

- 引入 `@xyflow/react` 实现可视化流程建模（拖拽节点 + 连线）
- 建立图模型持久化（Graph JSON）与校验机制
- 图模型编译为当前可执行线性阶段快照（兼容旧引擎）
- 提供设计态与执行态双视图（编辑图 + 运行高亮）
- 接入现有模板管理与任务执行链路

### 2.3 暂不纳入范围（Out of Scope）

- 复杂表达式引擎（如脚本条件、动态变量运行时求值）
- 跨工作流子流程调用（Subflow/Call Activity）
- 多租户权限体系（组织、角色、资源级 ACL）

---

## 3. 产品能力定义（V1）

V1 可视化设计器能力：

1) 画布建模
- 节点拖拽、缩放、框选、对齐
- 连线创建与删除
- 节点复制、删除、重命名

2) 节点类型
- 开始节点（Start）
- 研发任务节点（Task）
- 审批节点（Approval）
- 结束节点（End）

3) 属性配置
- 节点侧栏配置（名称、执行人、通过规则、退回规则、附加说明）
- 边配置（条件类型、优先级）

4) 智能校验
- 唯一开始节点
- 至少一个结束节点
- 开始可达性/孤岛检测
- 审批节点必须有执行人
- 非结束节点必须有出边

5) 模板发布与任务执行
- 设计态保存草稿
- 发布时执行校验 + 编译
- 任务实例沿用当前执行引擎运行

6) 执行态可视化
- 当前节点高亮
- 历史路径着色
- 驳回回退路径标识

---

## 4. 技术架构方案

### 4.1 前端架构（React + XYFlow）

新增模块：

- `src/components/WorkflowDesigner/`
  - `index.tsx`：设计器主容器
  - `nodes/*.tsx`：各节点渲染组件
  - `NodeConfigDrawer.tsx`：节点属性面板
  - `EdgeConfigPopover.tsx`：连线属性配置
  - `graphValidation.ts`：图校验器
  - `graphCompiler.ts`：图编译器（Graph -> stages）

与现有联动：

- 在 `WorkflowConfigModal` 增加模式切换：
  - 表单模式（现有）
  - 设计器模式（新增）
- 老模板进入设计器时自动转换为图结构（线性转图）

### 4.2 后端架构（Tauri + SQLite）

保留现有命令，同时新增图模型命令：

- `get_workflow_graph(workflow_id)`
- `save_workflow_graph(workflow_id?, name, is_default, graph_json)`
- `validate_workflow_graph(graph_json)`
- `publish_workflow_graph(workflow_id)`（可选，支持草稿/发布分离）

兼容关键点：

- 保存图时先编译成线性执行快照
- 将编译结果同步写入现有 `workflow_stages/stage_assignees`
- `create_workflow_task` 与 `decide_workflow_task_stage` 暂不重写

---

## 5. 数据模型与迁移设计

## 5.1 新增表（建议迁移：`010_workflow_graph.sql`）

1) `workflow_graphs`
- `workflow_id TEXT PRIMARY KEY`（FK -> workflows.id）
- `version INTEGER NOT NULL`
- `graph_json TEXT NOT NULL`（完整 nodes/edges/viewport）
- `compiled_stages_json TEXT NOT NULL`（编译快照，便于排错审计）
- `status TEXT NOT NULL DEFAULT 'draft'`（draft/published）
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

建议索引：
- `idx_workflow_graphs_status_updated` on `(status, updated_at DESC)`

## 5.2 Graph JSON 结构（V1）

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "node_start_1",
      "type": "start",
      "position": { "x": 120, "y": 80 },
      "data": { "name": "开始" }
    },
    {
      "id": "node_approval_1",
      "type": "approval",
      "position": { "x": 380, "y": 80 },
      "data": {
        "name": "代码评审",
        "passRule": "ALL_APPROVE",
        "rejectRule": "ANY_REJECT_BACK",
        "assignees": [
          { "employeeId": "emp_xxx", "requiredCount": 1, "isRequired": true }
        ]
      }
    },
    {
      "id": "node_end_1",
      "type": "end",
      "position": { "x": 660, "y": 80 },
      "data": { "name": "完成" }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_start_1",
      "target": "node_approval_1",
      "data": { "condition": "always", "priority": 1 }
    },
    {
      "id": "edge_2",
      "source": "node_approval_1",
      "target": "node_end_1",
      "data": { "condition": "approved", "priority": 1 }
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

## 5.3 编译产物（Graph -> Stages）

V1 编译策略（先兼容）：

- 仅允许“单主干线 + 可选 reject 回退线”
- 将 `approval` 节点按主干拓扑顺序编译为 `workflow_stages`
- `task/start/end` 节点不参与阶段落库，仅用于可视化表达
- 若存在分支汇聚，V1 校验不通过并阻止发布

---

## 6. 核心流程设计

## 6.1 设计器保存流程

1. 前端提交 `graph_json`
2. 后端执行语义校验（结构 + 业务约束）
3. 校验通过后编译 `compiled_stages_json`
4. 单事务写入：
   - `workflows`（名称、默认标志）
   - `workflow_graphs`
   - `workflow_stages`
   - `stage_assignees`
5. 返回最新模板详情

## 6.2 任务执行流程（兼容模式）

1. 创建任务时选择/自动选择 workflow
2. 仍按 `workflow_stages.stage_order` 初始化当前阶段
3. 审批推进/退回沿用现有命令
4. 执行态 UI 从任务事件 + 图映射做节点高亮

---

## 7. 关键校验规则（发布前强制）

结构校验：

- [ ] `start` 节点数量必须等于 1
- [ ] `end` 节点数量必须 >= 1
- [ ] 节点 ID 与边 ID 全局唯一
- [ ] 所有边的 source/target 必须存在

可达性校验：

- [ ] 所有非孤立节点必须从 `start` 可达
- [ ] 所有可达路径最终必须可达某个 `end`

业务校验：

- [ ] `approval` 节点必须配置至少 1 名执行人
- [ ] `approval.passRule` 仅允许 `ALL_APPROVE`/`ANY_APPROVE`
- [ ] `rejectRule` 仅允许 V1 支持集合（`ANY_REJECT_BACK`）
- [ ] 非 `end` 节点至少 1 条出边

编译校验：

- [ ] 主干可拓扑排序
- [ ] 可生成连续 `stage_order`（0..n-1）
- [ ] 每个编译阶段均有合法 assignees

---

## 8. 研发任务拆解（文件级）

## 8.1 前端任务

1) 依赖与基础
- [ ] 安装 `@xyflow/react`
- [ ] 新增 `WorkflowDesigner` 组件骨架

2) 设计器核心
- [ ] 节点渲染与拖拽
- [ ] 连线创建/删除
- [ ] 节点/边属性编辑
- [ ] 撤销/重做（可先基于快照栈）

3) 校验与发布
- [ ] `graphValidation.ts` 前端预校验
- [ ] 展示错误列表并定位到节点
- [ ] 保存/发布按钮与状态反馈

4) 兼容与迁移
- [ ] 线性模板 -> 图模板转换器
- [ ] 图模板 -> 阶段预览展示

5) 执行态可视化
- [ ] 在任务详情页显示流程图
- [ ] 根据 `current_stage_index` 与事件高亮路径

## 8.2 后端任务

1) 数据层
- [ ] 新增 migration `010_workflow_graph.sql`
- [ ] `wise_db.rs` 增加 graph 的查询与 upsert

2) 命令层
- [ ] 在 `lib.rs` 增加图模型命令
- [ ] 接口 DTO 与现有 `types.ts` 对齐

3) 规则层
- [ ] Rust 侧图校验器（服务端最终防线）
- [ ] Rust 侧编译器（Graph -> stages）

4) 事务一致性
- [ ] 保存图 + 更新模板 + 更新阶段统一事务
- [ ] 发布失败时全量回滚

## 8.3 类型与服务层任务

- [ ] 扩展 `src/types.ts`：`WorkflowGraph`, `WorkflowNode`, `WorkflowEdge`
- [ ] 新增 `src/services/workflowGraphs.ts`
- [ ] 接入 `WorkflowConfigModal` 与 `WorkflowTaskTimeline`

---

## 9. 分期与里程碑

## Phase 1（3-4 天）：设计器 MVP

输出：

- 可视化画布可用（增删节点、连线、保存草稿）
- 基础节点类型可配置
- 图可持久化到 `workflow_graphs`

验收：

- [ ] 能创建图并重新打开回显
- [ ] 节点位置与连线信息不丢失

## Phase 2（3 天）：校验 + 编译兼容

输出：

- 发布前校验（前后端双重）
- 图编译为现有线性阶段
- 任务可按编译后阶段正常流转

验收：

- [ ] 从设计器发布后可创建任务
- [ ] 通过/驳回逻辑与当前行为一致

## Phase 3（2-3 天）：执行态可视化

输出：

- 任务详情中图视图高亮当前节点与历史路径
- 驳回回退路径可识别

验收：

- [ ] 与 `task_events` 时间线一致
- [ ] 切换任务时显示正确无串态

## Phase 4（可选，后续）：DAG 真执行引擎

输出：

- 多分支并行与汇聚执行
- `task_node_states` 级别状态机

---

## 10. 风险与应对

1) 风险：图能力过强，执行引擎跟不上
- 应对：V1 通过校验限制图形态，仅支持可编译子集

2) 风险：前后端校验规则不一致
- 应对：前端仅做提示，后端作为唯一裁决；错误码标准化

3) 风险：历史模板迁移失败
- 应对：保留表单模式兜底；提供“一键转图 + 可逆回退”

4) 风险：复杂图导致性能问题
- 应对：节点数上限（如 100）；按需渲染属性面板；节流保存

---

## 11. 测试与验收计划

单元测试（优先）：

- `graphValidation`：合法图/非法图覆盖
- `graphCompiler`：线性、驳回回退、非法分支场景

集成测试：

- 保存图 -> 发布 -> 创建任务 -> 审批推进全链路
- 默认工作流与指定工作流并行验证

手工演示脚本：

1. 创建“标准研发流程”图：开始 -> 开发 -> 代码评审 -> 测试验收 -> 结束  
2. 设置评审节点执行人为员工 A/B，规则 ALL_APPROVE  
3. 发布模板并创建任务  
4. A 通过、B 驳回，任务回退并记录原因  
5. 再次通过后任务完成，图和时间线一致

---

## 12. 上线与回滚策略

上线策略：

- 增加 feature flag：`workflowVisualDesignerEnabled`
- 先灰度给内部用户，观察 1~2 天
- 监控错误：发布失败率、任务推进失败率、图加载失败率

回滚策略：

- 关闭 flag，隐藏设计器入口
- 保留数据库数据，不做破坏性删除
- 继续使用旧表单模式编辑与运行

---

## 13. 人力与工期估算

建议 3 人并行（FE 2 + BE 1）：

- Phase 1：3~4 人天
- Phase 2：3 人天
- Phase 3：2~3 人天
- 总计：8~10 人天（不含 DAG 真执行引擎）

若 2 人小组执行，预计 1.5~2 周可完成 V1 上线。

---

## 14. 开工清单（第一天）

- [ ] 建 migration：`010_workflow_graph.sql`
- [ ] 安装 `@xyflow/react` 并搭起设计器空页面
- [ ] 定义 `WorkflowGraph` TS 类型与 Rust DTO
- [ ] 打通 `save_workflow_graph` 命令空实现（先回显）
- [ ] 完成“线性模板 -> 图”转换器初版

完成以上 5 项后即可进入并行开发节奏。

