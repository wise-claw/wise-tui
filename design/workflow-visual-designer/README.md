# Wise 可视化工作流设计器方案索引

本目录用于落地 Wise 基于 `xyflow` 的研发流程可视化设计器实施方案，按“总方案 -> 分阶段任务单”组织，便于直接排期执行。

## 文档清单

1) 总体方案（必读）

- `xyflow-rnd-visual-designer-execution-plan.md`
- 说明：目标范围、架构、数据模型、迁移、里程碑、风险、验收、工期

2) Phase 1：MVP（设计器草稿闭环）

- `phase1-mvp-implementation-checklist.md`
- 说明：画布编辑、草稿保存回显、表单模式并存

3) Phase 2：发布编译兼容

- `phase2-publish-compile-implementation-checklist.md`
- 说明：发布校验、Graph -> stages 编译、事务同步现有执行引擎

4) Phase 3：执行态可视化

- `phase3-runtime-visualization-implementation-checklist.md`
- 说明：任务时间线与流程图联动、当前阶段高亮、路径回放

---

## 建议执行顺序（强制）

请按以下顺序推进，不建议跳阶段开发：

1. 先完成 Phase 1（编辑闭环）
2. 再完成 Phase 2（可执行发布）
3. 最后完成 Phase 3（运行态可视化）

原因：

- Phase 2 依赖 Phase 1 的图模型持久化
- Phase 3 依赖 Phase 2 的发布产物与事件结构稳定

---

## 角色分工建议

最小推荐 3 人并行：

- FE-A：设计器画布与交互
- FE-B：类型/服务/容器状态与联调
- BE：Tauri 命令、SQLite 迁移、编译与事务

并行原则：

- 命令契约先冻结再并行
- 每日联调一次主链路
- 避免多人同时改动同一核心文件（尤其 `WorkflowConfigModal`、`types.ts`、`lib.rs`）

---

## 启动清单（第一周）

Day 1：

- [ ] 对齐总方案与 Phase 1 范围
- [ ] 冻结命令名与 DTO 字段（前后端一致）
- [ ] 建立分支与责任人

Day 2~3：

- [ ] 完成 Phase 1 代码与联调
- [ ] 保证旧表单模式不回归

Day 4~5：

- [ ] 进入 Phase 2 编译发布能力
- [ ] 做事务回滚与异常路径测试

Week 2（建议）：

- [ ] 进入 Phase 3 执行态可视化
- [ ] 完成演示录屏与验收

---

## 验收总门槛（Go/No-Go）

上线前必须满足：

- [ ] 三个阶段任务单的“必测项”全部通过
- [ ] 至少 1 条完整演示链路：设计 -> 发布 -> 创建任务 -> 审批推进/驳回 -> 可视化回放
- [ ] 无 P1/P2 阻塞缺陷
- [ ] 关闭设计器 feature flag 后系统仍可用（可回滚）

---

## 后续扩展（Phase 4 方向）

在 Phase 1/2/3 稳定后，可继续推进：

- DAG 真执行引擎（并行分支/汇聚）
- 节点级状态机与 token 流转
- 条件表达式与变量上下文
- 跨流程子流程调用

建议单独开 `phase4-dag-runtime-plan.md`，避免与当前稳定链路耦合。

