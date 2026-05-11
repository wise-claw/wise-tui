# Wise 可视化工作流设计器 Phase 3（执行态可视化）实施任务单

## 1. 目标与边界

本阶段目标：在 Phase 2“可发布可执行”基础上，实现任务执行态的图形化可视化，帮助用户快速理解当前卡点、历史路径与驳回原因。

本阶段不包含：

- DAG 并行 token 的真实执行模拟
- 甘特图/统计报表类分析面板
- 跨任务全局流程监控大屏

交付完成定义（DoD）：

- 任务详情中可查看执行态流程图
- 当前阶段节点高亮，已通过/驳回路径可视化
- 与现有时间线 `task_events` 一致，不出现状态冲突

---

## 2. 核心设计原则

1) 执行事实以后端为准
- 所有节点状态由任务数据 + 事件日志推导
- 前端不自行猜测推进结果

2) 图是视图，不是执行引擎
- Phase 3 只做“可视化映射”，不改动现有审批推进逻辑

3) 时间线与流程图双向联动
- 点时间线可定位图节点
- 点图节点可过滤相关事件

---

## 3. 执行态状态模型（前端）

## 3.1 节点状态枚举（展示态）

- `idle`：未进入
- `active`：当前执行中
- `passed`：已通过
- `rejected`：发生驳回
- `skipped`：未走到（保留，V1 可选）

## 3.2 边状态枚举（展示态）

- `normal`：默认
- `active_path`：当前路径
- `passed_path`：历史通过路径
- `rejected_path`：驳回路径

## 3.3 推导输入

来自后端现有接口：

- `list_workflow_tasks`（`current_stage_index`、`status`）
- `list_task_events`（事件序列）
- `get_workflow_graph`（图结构）
- `list_workflow_templates`（阶段定义兜底）

---

## 4. 文件级任务拆解

## 4.1 FE-A（图渲染与联动交互）

1) 新增执行态图组件

- [ ] 新建 `src/components/WorkflowRuntimeViewer/index.tsx`
- [ ] 新建 `src/components/WorkflowRuntimeViewer/index.css`
- [ ] 基于 `@xyflow/react` 以只读模式渲染（禁用编辑/连线）

验收：
- [ ] 进入任务详情可看到对应流程图只读视图

2) 节点/边状态样式

- [ ] 新建/扩展节点样式类：
  - `.app-workflow-node--active`
  - `.app-workflow-node--passed`
  - `.app-workflow-node--rejected`
- [ ] 边样式区分通过/驳回路径颜色

验收：
- [ ] 不同状态在深浅色主题下均可辨识

3) 时间线联动

- [ ] 改造 `src/components/ClaudeSessions/WorkflowTaskTimeline.tsx`
- [ ] 点击时间线事件触发 `focusNode(nodeId)`（通过 props 或事件总线）
- [ ] 当前聚焦节点在图上加描边与居中

验收：
- [ ] 点击事件可定位到相关节点

4) 图反向联动

- [ ] 点击节点后，过滤并高亮该节点相关事件
- [ ] 提供“清除过滤”入口

验收：
- [ ] 节点与时间线能形成闭环导航

## 4.2 FE-B（状态推导、服务与容器集成）

1) 执行态映射器

- [ ] 新建 `src/components/WorkflowRuntimeViewer/runtimeMapper.ts`
- [ ] 提供：
  - `buildRuntimeNodeStates(graph, task, events, template)`
  - `buildRuntimeEdgeStates(graph, events)`

验收：
- [ ] 对同一输入数据输出稳定可预测

2) 事件解析器

- [ ] 新建 `src/components/WorkflowRuntimeViewer/eventParser.ts`
- [ ] 解析 `task_events.payload_json` 关键字段：
  - `task_created`
  - `task_approved`
  - `task_rejected`
  - `task_completed`

验收：
- [ ] 非法/缺字段 payload 不导致页面崩溃

3) 容器层集成

- [ ] 改造 `src/components/ClaudeSessions/ClaudeChat.tsx` 或关联任务详情容器
- [ ] 在任务详情区域增加“时间线视图 / 流程图视图”切换
- [ ] 增加数据加载顺序控制（任务 -> 图 -> 事件）

验收：
- [ ] 视图切换不丢状态、不重复请求

4) 服务层补充（如缺）

- [ ] 若尚未实现，补充 `src/services/workflowGraphs.ts` 的读取方法复用
- [ ] 增加统一错误处理与 fallback（无图时显示线性视图）

验收：
- [ ] 无 graph 数据时有可理解兜底提示

## 4.3 BE（必要增强）

Phase 3 后端原则：尽量不新增执行逻辑，仅补可视化所需信息。

1) 事件负载标准化（推荐）

- [ ] 在 `src-tauri/src/lib.rs` 中确保关键事件 payload 含：
  - `fromStageIndex`
  - `toStageIndex`
  - `stageId`（可选但建议）
  - `employeeId`（审批事件）

验收：
- [ ] 前端无需二次猜测即可映射节点

2) 可选：新增聚合查询命令（提升性能）

- [ ] 新增 `get_task_runtime_view(task_id)`（可选）
- [ ] 返回任务、图、事件聚合数据，减少前端多次调用

验收：
- [ ] 单次请求可完成可视化渲染（可选项）

---

## 5. 关键映射规则（必须统一）

## 5.1 阶段到节点映射

优先级：

1. `compiled_stages_json.stageId -> graph.nodeId` 显式映射（推荐）
2. 若无显式映射，则按 `stage_order` 与主干 `approval` 节点顺序映射

要求：

- 映射规则必须前后端文档化并固定，避免同一任务在不同页面状态不一致

## 5.2 当前节点判定

- `task.status = in_progress`：`current_stage_index` 对应节点标记 `active`
- `task.status = completed`：最后阶段节点标记 `passed`，结束节点高亮
- `task.status = rejected`：当前/上一步节点按事件序列标记 `rejected`

## 5.3 路径着色判定

- 读取事件序列按时间推进，构造有序路径
- 通过事件对应边标 `passed_path`
- 驳回事件对应边标 `rejected_path`

---

## 6. 接口契约（Phase 3）

## 6.1 前端内部数据结构（建议）

```ts
type RuntimeViewData = {
  task: WorkflowTaskItem;
  graph: WorkflowGraph | null;
  events: WorkflowTaskEventItem[];
  nodeStates: Record<string, "idle" | "active" | "passed" | "rejected" | "skipped">;
  edgeStates: Record<string, "normal" | "active_path" | "passed_path" | "rejected_path">;
};
```

## 6.2 可选后端聚合命令返回

```ts
{
  task: WorkflowTaskItem;
  graph: WorkflowGraph | null;
  events: WorkflowTaskEventItem[];
  template: WorkflowTemplateItem | null;
}
```

---

## 7. 每日排期建议（4~5 天）

Day 1
- FE-A：RuntimeViewer 只读画布骨架
- FE-B：runtimeMapper/eventParser 初版
- BE：确认事件 payload 字段补齐方案

Day 2
- FE-A：节点/边状态样式 + 基础高亮
- FE-B：任务详情容器集成与数据管线
- BE：必要字段补齐（若缺）

Day 3
- FE-A：时间线 -> 图定位联动
- FE-B：图 -> 时间线过滤联动
- 全员：联调一致性

Day 4
- 全员：异常场景与回归测试

Day 5（可选缓冲）
- 性能优化与视觉细节调整

---

## 8. 测试清单（Phase 3 必测）

功能：

- [ ] 任务 in_progress 时当前节点高亮正确
- [ ] 任务 completed 时完成路径正确着色
- [ ] 出现驳回事件时驳回边与节点正确标红
- [ ] 时间线点击可定位图节点
- [ ] 图节点点击可过滤时间线

异常：

- [ ] `graph_json` 缺失时可回退线性时间线
- [ ] 事件 payload 异常时不崩溃并显示降级提示
- [ ] 图节点被删除但历史任务存在时，提示“历史节点缺失”

回归：

- [ ] 任务创建、审批、退回原有行为不变
- [ ] 工作流设计器编辑能力不受影响

---

## 9. 性能与可用性要求

- 首屏渲染目标：任务详情打开后 300ms 内出现骨架，1s 内完成图渲染（常规数据量）
- 节点数量建议上限：100（超限时显示性能提示）
- 事件数量较大时，时间线列表按需渲染（虚拟列表可选）

---

## 10. 风险与应对

风险 1：事件粒度不足导致无法精确映射路径
- 应对：补齐事件 payload 的 stage 相关字段，必要时引入显式 nodeId

风险 2：历史模板无 graph 数据
- 应对：使用 `stagesToGraph` 临时转换并标注“迁移视图”

风险 3：映射逻辑复杂导致维护成本升高
- 应对：统一放在 `runtimeMapper.ts`，禁止分散在组件内重复实现

---

## 11. 本阶段交付物清单

- [ ] `phase3-runtime-visualization-implementation-checklist.md`（本文档）
- [ ] `WorkflowRuntimeViewer` 可用代码
- [ ] 时间线与流程图联动能力
- [ ] 一段演示录屏（进行中任务 + 驳回任务 + 已完成任务）

完成后即可进入下一阶段（可选）：
- Phase 4：DAG 真执行引擎与节点级状态机。

