# Wise 员工与工作流系统实施执行文档（数据库版）

## 1. 文档目标

本文件用于指导“员工配置 + 工作流编排 + 任务流转”功能的分阶段落地，确保：

- 可执行：每阶段有明确开发任务和实现边界
- 可确认：每阶段有验收标准、演示路径、通过条件
- 可回滚：出现问题可按阶段回退，不阻塞主线开发

---

## 2. 范围与分期

按以下顺序严格实施：

1. Phase A：员工功能（完整闭环）
2. Phase B：工作流配置功能（完整闭环）
3. Phase C：任务流转串联（完整闭环）

数据库存储为强制要求，统一使用 SQLite（Tauri Rust 侧访问）。

---

## 2.1 并行开发实施策略（多人同时开工）

在保持 A -> B -> C 业务交付顺序的前提下，开发可以并行推进，采用“纵向切片 + 契约先行”。

并行原则：

- 先冻结契约，再并行编码：先确定 TypeScript DTO 与 Tauri 命令签名
- 前后端按 Mock/真实接口双模式开发，减少互相等待
- 每个子任务只改一个责任面（UI/服务/命令/仓储），降低合并冲突
- 每天至少一次主干集成，发现冲突当天解决

建议并行泳道（3 人示例）：

1) FE-A（界面与交互）
- 负责弹窗 UI、左侧列表、输入框 `@` 交互、时间线展示
- 先接 mock service，后切真实 invoke

2) FE-B（前端服务与状态）
- 负责 `src/services/*`、hooks、DTO 映射、错误处理统一
- 维护 mock/real adapter 切换层

3) BE（Tauri + Rust + SQLite）
- 负责 migration、repository、command、事务、状态机规则
- 提供稳定命令契约与错误码

并行依赖拆分：

- Day 1：冻结契约（命令名、入参、出参、错误码）
- Day 2：FE-A/FE-B 用 mock 并行开发；BE 完成 migration + employees 命令
- Day 3：接入 employees 真接口并联调；同时 BE 开始 workflows 命令
- Day 4：FE 继续 workflows UI；BE 完成 workflows 事务与引用校验
- Day 5+：串联任务流转，FE/BE 每日联调推进

分支策略：

- 长分支：`feature/workflow-v1`
- 子分支：
  - `feature/workflow-v1-fe-ui`
  - `feature/workflow-v1-fe-service`
  - `feature/workflow-v1-be-db`
- 子分支每天向长分支合并，长分支通过后再合入主分支

冲突高发文件与规避：

- `src/types.ts`：拆分到 `src/types/workflow.ts`，减少多人改同文件
- `src-tauri/src/lib.rs`：命令注册集中由 1 人维护，其他人提合并请求
- `App.tsx`：路由/入口统一由 FE-A 管理，其他改动经组件注入

并行验收节奏：

- 每天站会后执行一次最小联调：
  - 员工列表查询
  - 新增员工
  - 工作流列表查询
  - 创建任务（可先 mock）
- 每天下班前更新本文件中各阶段 checklist 勾选状态

---

## 3. 总体架构

调用链：

- 前端 React 组件
- `src/services/*` 前端服务封装（仅调 Tauri 命令）
- Tauri `invoke` 命令层
- Rust 领域服务层（状态机/业务规则）
- SQLite Repository 层（事务 + 查询）

约束：

- 前端组件不直接操作数据库
- 业务规则不写在 React 组件内
- 所有“推进/退回/批量更新”必须使用数据库事务

---

## 4. 数据库设计（V1）

## 4.1 表结构

1) `employees`
- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL UNIQUE`
- `agent_type TEXT NOT NULL`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

2) `workflows`
- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL UNIQUE`
- `is_default INTEGER NOT NULL DEFAULT 0`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

3) `workflow_stages`
- `id TEXT PRIMARY KEY`
- `workflow_id TEXT NOT NULL`
- `name TEXT NOT NULL`
- `stage_order INTEGER NOT NULL`
- `pass_rule TEXT NOT NULL`（`ALL_APPROVE` | `ANY_APPROVE`）
- `reject_rule TEXT NOT NULL`（V1 固定 `ANY_REJECT_BACK`）

4) `stage_assignees`
- `id TEXT PRIMARY KEY`
- `stage_id TEXT NOT NULL`
- `employee_id TEXT NOT NULL`
- `required_count INTEGER NOT NULL DEFAULT 1`
- `is_required INTEGER NOT NULL DEFAULT 1`

5) `tasks`
- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `content TEXT NOT NULL`
- `creator TEXT NOT NULL`
- `workflow_id TEXT NOT NULL`
- `current_stage_index INTEGER NOT NULL`
- `status TEXT NOT NULL`（`in_progress` | `completed` | `rejected` | `archived`）
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

6) `task_stage_decisions`
- `id TEXT PRIMARY KEY`
- `task_id TEXT NOT NULL`
- `stage_id TEXT NOT NULL`
- `employee_id TEXT NOT NULL`
- `decision TEXT NOT NULL`（`pending` | `approved` | `rejected`）
- `reason TEXT`
- `decided_at INTEGER`

7) `task_events`
- `id TEXT PRIMARY KEY`
- `task_id TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `payload_json TEXT NOT NULL`
- `created_at INTEGER NOT NULL`

## 4.2 索引

- `idx_tasks_status_stage` on `tasks(status, current_stage_index)`
- `idx_decisions_task_stage` on `task_stage_decisions(task_id, stage_id, decision)`
- `idx_stages_workflow_order` on `workflow_stages(workflow_id, stage_order)`
- `idx_assignees_stage_employee` on `stage_assignees(stage_id, employee_id)`

## 4.3 迁移策略

- 建立 `schema_version` 管理表
- 使用增量脚本：`001_init.sql`, `002_*.sql`
- 禁止修改已发布迁移脚本，只允许追加新脚本

---

## 5. 分阶段执行清单

## 5.1 Phase A：员工功能（先完成）

### A.1 开发任务

- [ ] 新增数据库迁移：`employees`、必要索引
- [ ] Rust 实现员工 CRUD repository
- [ ] Tauri 命令：`list_employees/create_employee/update_employee/delete_employee`
- [ ] 前端 `src/services/employees.ts` 对接 invoke
- [ ] 新增员工配置弹窗（查询/新增/编辑/删除）
- [ ] 左侧仓库区域展示员工列表与任务计数
- [ ] 删除前引用检查（被阶段引用时阻止删除并提示）

### A.2 验收标准（必须全部通过）

- [ ] 可新增员工并指定 `agent_type`
- [ ] 员工名唯一校验生效
- [ ] 可编辑、禁用、删除未引用员工
- [ ] 已被引用员工不可删除，提示清晰
- [ ] 左侧可见“员工 + 当前进行中任务数”

### A.3 演示脚本（手工确认）

1. 打开员工配置弹窗，新增 3 个员工  
2. 编辑其中 1 个员工名称与智能体  
3. 删除 1 个未引用员工，应成功  
4. 删除 1 个引用员工，应失败并提示原因  
5. 返回主界面，左侧员工列表显示正确

---

## 5.2 Phase B：工作流配置功能

### B.1 开发任务

- [ ] 新增迁移：`workflows/workflow_stages/stage_assignees`
- [ ] Rust 实现工作流 CRUD 与阶段重排事务
- [ ] Tauri 命令：
  - `list_workflows/create_workflow/update_workflow/delete_workflow`
  - `save_workflow_stages`（含 assignees 配置）
- [ ] 前端工作流配置弹窗
- [ ] 阶段拖拽排序（推荐 `@dnd-kit`）
- [ ] 阶段内员工与人数配置
- [ ] 支持设置默认工作流

### B.2 验收标准（必须全部通过）

- [ ] 可创建工作流并添加多个阶段
- [ ] 阶段顺序可拖拽并持久化
- [ ] 每阶段可配置多个员工与数量
- [ ] `pass_rule` 可配置（ALL/ANY）
- [ ] 删除工作流前有任务引用保护

### B.3 演示脚本（手工确认）

1. 新建“标准研发流”并配置 4 个阶段  
2. 给每阶段配置 1~2 个员工和人数  
3. 拖拽调整阶段顺序并保存  
4. 关闭弹窗重新打开，配置应完整回显  
5. 尝试删除被任务引用工作流，应被阻止

---

## 5.3 Phase C：任务流转串联

### C.1 开发任务

- [ ] 新增迁移：`tasks/task_stage_decisions/task_events`
- [ ] 输入框支持 `@员工`（提及选择与解析）
- [ ] 创建任务时绑定工作流（默认/手选）
- [ ] 初始化首阶段决策（按 assignees 生成 pending）
- [ ] 实现“通过/退回（必填原因）”命令
- [ ] 实现阶段推进规则（ALL/ANY）
- [ ] 实现退回上阶段规则与原因追踪
- [ ] 事件审计时间线（task_events）
- [ ] 左侧员工任务数实时更新

### C.2 验收标准（必须全部通过）

- [ ] 可通过 `@员工` 下发任务
- [ ] 任务进入首阶段并创建待处理决策
- [ ] 满足通过规则后自动进入下一阶段
- [ ] 拒绝时必须填写原因并退回上阶段
- [ ] 最后阶段通过后任务状态为 `completed`
- [ ] 时间线完整展示推进与退回记录

### C.3 演示脚本（手工确认）

1. 输入框 `@张三 @李四` 创建任务  
2. 任务进入阶段 1，出现两个待处理决策  
3. 员工 A 通过，员工 B 拒绝并填写原因  
4. 任务退回上一阶段，时间线记录拒绝原因  
5. 重新处理并全部通过，最终任务完成

---

## 6. 事务与一致性要求（强制）

下列操作必须单事务执行：

- 创建任务 + 初始化阶段决策 + 写事件
- 阶段通过判定 + 推进阶段 + 写事件
- 阶段拒绝 + 退回阶段 + 写事件
- 阶段拖拽重排（多行顺序更新）

若事务失败，必须整体回滚，不允许部分成功。

---

## 7. API 与错误码约定

错误码前缀统一：`WF_`

建议最小错误码集合：

- `WF_INVALID_INPUT`
- `WF_NOT_FOUND`
- `WF_DUPLICATE_NAME`
- `WF_REFERENCED_ENTITY`
- `WF_INVALID_TRANSITION`
- `WF_DB_CONFLICT`
- `WF_DB_IO_FAILED`
- `WF_INTERNAL_ERROR`

前端展示规范：

- 用户可理解错误（校验/引用冲突）直接展示 message
- 系统错误统一“操作失败，请重试”，并写控制台日志

---

## 8. 回滚策略

- Phase A/B/C 均可独立发布
- 每阶段引入 feature flag（如 `workflowV1Enabled`）
- 若出现重大缺陷：
  - 关闭对应 flag（前端隐藏入口）
  - 保留数据库数据，不做破坏性删除
  - 用热修复迁移脚本修正数据

---

## 9. 里程碑与确认点

## M1（员工）

- 输出物：
  - 员工管理弹窗可用
  - 左侧员工任务计数可用
  - 员工数据库 CRUD 完成
- 评审确认：
  - [ ] 产品确认交互
  - [ ] 开发确认代码结构
  - [ ] 联调确认错误处理

## M2（工作流）

- 输出物：
  - 工作流配置弹窗可用
  - 阶段拖拽/员工分配可持久化
  - 默认工作流机制可用
- 评审确认：
  - [ ] 产品确认流程表达能力
  - [ ] 开发确认事务完整性
  - [ ] 联调确认回显一致性

## M3（串联）

- 输出物：
  - `@员工` 下发任务可用
  - 阶段推进/退回可用
  - 审计时间线可用
- 评审确认：
  - [ ] 完整 E2E 用例通过
  - [ ] 回归无阻塞缺陷
  - [ ] 可进入灰度

---

## 10. 最终通过标准（Go/No-Go）

上线前必须满足：

- [ ] 三阶段验收项全部通过
- [ ] 至少 1 条完整 E2E 演示录屏
- [ ] 关键路径无 P1/P2 缺陷
- [ ] 数据库迁移可在全新环境与已有环境均成功
- [ ] 回滚开关验证通过

未全部满足则 No-Go，不进入上线。

---

## 11. 并行开发完成定义（DoD）

满足以下条件才视为“并行开发实现”完成：

- [ ] 前后端在不阻塞的情况下完成 A/B/C 各自任务
- [ ] 每天主干集成成功，无跨天未处理冲突
- [ ] mock 到真实接口切换不改 UI 组件业务逻辑
- [ ] 联调用例（员工/工作流/任务）连续 2 天全通过
- [ ] 长分支合入主分支后可一键启动并完成演示脚本

