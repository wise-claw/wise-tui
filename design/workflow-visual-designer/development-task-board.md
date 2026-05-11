# Wise 可视化工作流设计器开发排期任务看板

## 1. 使用说明

本看板用于项目执行与每日站会同步，字段可直接映射到 Jira/飞书多维表格：

- `任务ID`：唯一标识
- `阶段`：P1/P2/P3
- `任务名称`：可执行任务项
- `负责人角色`：FE-A / FE-B / BE
- `预估工时`：人天
- `前置依赖`：必须先完成项
- `交付物`：代码或文档产出
- `验收标准`：完成判定口径
- `优先级`：P0/P1/P2

---

## 2. 总排期概览（建议）

- Phase 1（MVP）：5 个工作日
- Phase 2（发布编译）：6 个工作日
- Phase 3（执行态可视化）：5 个工作日
- 合计：16 个工作日（3 人并行）

---

## 3. 任务明细（可直接导入）

| 任务ID | 阶段 | 任务名称 | 负责人角色 | 预估工时 | 前置依赖 | 交付物 | 验收标准 | 优先级 |
|---|---|---|---|---:|---|---|---|---|
| WFD-P1-001 | P1 | 安装 xyflow 并建立设计器骨架 | FE-A | 0.5 | 无 | `WorkflowDesigner/index.tsx` | 页面可渲染画布与控件 | P0 |
| WFD-P1-002 | P1 | 实现四类节点渲染与注册 | FE-A | 1.0 | WFD-P1-001 | `nodes/*` | 可添加并显示 start/task/approval/end | P0 |
| WFD-P1-003 | P1 | 实现节点拖拽、连线、删除 | FE-A | 1.0 | WFD-P1-002 | 设计器交互代码 | 节点边可编辑且状态同步 | P0 |
| WFD-P1-004 | P1 | 集成到 WorkflowConfigModal（模式切换） | FE-A | 1.0 | WFD-P1-003 | `WorkflowConfigModal` 改造 | 可切换表单/设计器模式 | P0 |
| WFD-P1-005 | P1 | 定义 WorkflowGraph 类型 | FE-B | 0.5 | 无 | `types.ts` | TS 严格通过，无 any | P0 |
| WFD-P1-006 | P1 | 新增 workflowGraphs 服务层 | FE-B | 0.5 | WFD-P1-005 | `services/workflowGraphs.ts` | 前端无直接 invoke 调用 | P0 |
| WFD-P1-007 | P1 | 实现线性模板转图适配器 | FE-B | 1.0 | WFD-P1-005 | `legacyAdapter.ts` | 老模板可自动转图回显 | P0 |
| WFD-P1-008 | P1 | 设计器保存/回显流程串联 | FE-B | 1.0 | WFD-P1-006,WFD-P1-007 | modal 状态逻辑 | 保存后重开布局一致 | P0 |
| WFD-P1-009 | P1 | 新增 010 数据库迁移（workflow_graphs） | BE | 0.5 | 无 | `010_workflow_graph.sql` | 新库/增量迁移均成功 | P0 |
| WFD-P1-010 | P1 | 仓储层 graph 读写接口 | BE | 0.5 | WFD-P1-009 | `wise_db.rs` | graph_json 可 upsert/get | P0 |
| WFD-P1-011 | P1 | 新增 get/save/validate 命令（基础版） | BE | 1.0 | WFD-P1-010 | `lib.rs` | 前端可调用并返回稳定结果 | P0 |
| WFD-P1-012 | P1 | P1 联调与回归 | FE-A+FE-B+BE | 1.0 | P1 全部 | 联调记录 | 设计器闭环可用且不回归旧功能 | P0 |
| WFD-P2-001 | P2 | 发布交互（保存草稿/发布模板） | FE-A | 0.5 | P1 完成 | modal 按钮与状态 | 发布态 loading 与反馈完整 | P0 |
| WFD-P2-002 | P2 | 校验错误面板与定位能力 | FE-A | 1.0 | WFD-P2-001 | `ValidationPanel.tsx` | 错误点击可定位节点/边 | P0 |
| WFD-P2-003 | P2 | 前端预校验（结构/业务） | FE-B | 1.0 | P1 完成 | `graphValidation.ts` | 非法图前端阻止发布 | P0 |
| WFD-P2-004 | P2 | 服务契约升级（publish/validate） | FE-B | 0.5 | WFD-P2-003 | `workflowGraphs.ts` | 命令调用与类型一致 | P0 |
| WFD-P2-005 | P2 | 编译预览（可选增强） | FE-B | 1.0 | WFD-P2-004 | 预览 UI | 发布前可看到阶段变更 | P1 |
| WFD-P2-006 | P2 | 新增 011 迁移（compiled/status） | BE | 0.5 | P1 完成 | `011_workflow_graph_publish.sql` | 历史数据补默认值成功 | P0 |
| WFD-P2-007 | P2 | 服务端图校验器实现 | BE | 1.5 | WFD-P2-006 | `workflow_graph_validator.rs` | 返回结构化错误列表 | P0 |
| WFD-P2-008 | P2 | Graph->Stages 编译器实现 | BE | 1.5 | WFD-P2-007 | `workflow_graph_compiler.rs` | 合法图可产出连续 stage_order | P0 |
| WFD-P2-009 | P2 | publish 命令与事务落库 | BE | 1.0 | WFD-P2-008 | `lib.rs`+`wise_db.rs` | 发布失败可全回滚 | P0 |
| WFD-P2-010 | P2 | P2 联调与异常回归 | FE-A+FE-B+BE | 1.0 | P2 全部 | 联调记录 | 发布后可创建并流转任务 | P0 |
| WFD-P3-001 | P3 | 新增 RuntimeViewer 只读组件 | FE-A | 1.0 | P2 完成 | `WorkflowRuntimeViewer` | 任务详情可显示流程图 | P0 |
| WFD-P3-002 | P3 | 节点/边状态样式（active/passed/rejected） | FE-A | 0.5 | WFD-P3-001 | 组件样式 | 各状态视觉可区分 | P0 |
| WFD-P3-003 | P3 | 时间线 -> 图节点定位联动 | FE-A | 1.0 | WFD-P3-001 | Timeline 联动逻辑 | 点击事件可聚焦节点 | P0 |
| WFD-P3-004 | P3 | 图节点 -> 时间线过滤联动 | FE-A | 0.5 | WFD-P3-003 | 双向联动逻辑 | 点击节点可过滤事件 | P1 |
| WFD-P3-005 | P3 | runtimeMapper 状态推导器 | FE-B | 1.0 | P2 完成 | `runtimeMapper.ts` | 同输入输出稳定一致 | P0 |
| WFD-P3-006 | P3 | task_events 解析器 | FE-B | 0.5 | WFD-P3-005 | `eventParser.ts` | 异常 payload 不崩溃 | P0 |
| WFD-P3-007 | P3 | 任务详情容器集成与视图切换 | FE-B | 1.0 | WFD-P3-005,WFD-P3-006 | 容器改造 | 时间线/流程图切换稳定 | P0 |
| WFD-P3-008 | P3 | 补齐事件 payload 关键字段（可选） | BE | 0.5 | P2 完成 | `lib.rs` 事件写入 | 前端映射无需猜测 | P1 |
| WFD-P3-009 | P3 | 新增 runtime 聚合接口（可选） | BE | 0.5 | WFD-P3-008 | 命令实现 | 单接口返回任务+图+事件 | P2 |
| WFD-P3-010 | P3 | P3 联调与性能回归 | FE-A+FE-B+BE | 1.0 | P3 全部 | 联调记录 | 1s 内完成常规图渲染 | P0 |

---

## 4. 里程碑验收卡点

### M1（P1 结束）

- [ ] 可创建/编辑/保存流程图草稿
- [ ] 老模板可转图回显
- [ ] 旧表单模式无回归

### M2（P2 结束）

- [ ] 图可发布为可执行模板
- [ ] 发布后任务可创建并按现引擎流转
- [ ] 发布失败可全量回滚

### M3（P3 结束）

- [ ] 执行态流程图可展示当前阶段与历史路径
- [ ] 与时间线双向联动
- [ ] 关键链路演示通过

---

## 5. 风险跟踪栏（建议每日更新）

| 风险ID | 描述 | 影响阶段 | 当前状态 | 负责人 | 处理策略 |
|---|---|---|---|---|---|
| R-001 | `WorkflowConfigModal` 冲突频繁 | P1 | 打开 | FE-A | 统一由 FE-A 合并该文件 |
| R-002 | 前后端校验规则不一致 | P2 | 打开 | BE | 以后端校验为准并同步错误码 |
| R-003 | 历史模板缺失 graph 数据 | P1/P3 | 打开 | FE-B | 使用 `stagesToGraph` 兜底转换 |
| R-004 | 发布事务出现半更新 | P2 | 监控中 | BE | 强制单事务与失败回滚测试 |

---

## 6. 每日站会模板（可复制）

- 昨日完成：
- 今日计划：
- 阻塞项：
- 需协同：
- 风险变化：

---

## 7. 完成判定

可视化工作流设计器项目判定“可上线”需满足：

- [ ] `P1/P2/P3` 所有 P0 任务完成
- [ ] 所有里程碑验收卡点通过
- [ ] 至少 1 条端到端演示链路录屏完成
- [ ] 回滚策略验证通过（关闭 feature flag 后可继续使用旧模式）

