# project-scoped employee and team isolation

## Goal

当用户在项目中查看员工和团队列表时，仅看到属于该项目的记录，避免跨项目泄露。使用已有的 `project_prd_employees` / `project_prd_workflows` 关联表实现过滤，不新增数据库 schema。

## What I already know

- employees 和 workflows 都是全局实体
- 已有 `project_prd_employees` 和 `project_prd_workflows` 关联表（migration 015）
- 已有 `projectPrdScope.ts` 前端服务层和 Rust 后端实现
- 已有 `active_project_id` 概念用于跟踪当前选中项目
- 现有 `projectPrdScopeDisplay.ts` 有一些复杂的项目范围过滤逻辑，但仅针对 PRD 视图
- ProgressMonitorPanel 显示"我的团队"（员工 + 团队）
- EmployeeConfigModal 用于员工 CRUD
- WorkflowConfigModal 用于团队/工作流配置

## Decision (ADR-lite)

**Context**: 如何实现员工和团队的项目归属隔离
**Decision**: 方案 A — 复用 project_prd_* 关联表做严格过滤，不新增数据库 schema
**Consequences**:
- 当选择项目时，只显示关联到该项目的员工和团队
- 未选项目但有仓库上下文时，按仓库过滤（employee.repositoryIds）
- 既无项目也无仓库上下文时，列表为空
- 新建员工/团队时自动关联到当前活跃项目
- 团队创建时也遵循相同的关联规则

**编辑时可管理**：
- 员工编辑界面可增删关联的项目和仓库
- 团队编辑界面可增删关联的项目

## Filtering Rules

**员工列表**：
- 有选中项目 → 仅显示 `project_prd_employees` 中关联该项目的员工
- 无项目但有仓库上下文 → 仅显示 `employee.repositoryIds` 包含该仓库的员工
- 既无项目也无仓库 → 列表为空

**团队（workflow）列表**：
- 有选中项目 → 仅显示 `project_prd_workflows` 中关联该项目的团队
- 无项目但有仓库 → 无仓库级关联概念，列表为空（团队仅通过项目关联）
- 既无项目也无仓库 → 列表为空

**创建时自动关联**：
- 新建员工时，自动加入当前活跃项目的 `project_prd_employees`
- 新建员工时，自动加入当前仓库的 `repositoryIds`
- 新建团队时，自动加入当前活跃项目的 `project_prd_workflows`

## Out of Scope (explicit)

- 不修改 employees / workflows 表结构（不加 project_id 列）
- 不处理员工/团队在多个项目间共享的场景（这是 future evolution）
- 不处理已有数据迁移（不自动关联现有全局员工到项目）

## Requirements

* 员工列表根据当前项目或仓库上下文进行过滤
* 团队列表根据当前项目上下文进行过滤
* 无上下文时列表为空
* 创建员工/团队时自动关联当前上下文
* 编辑员工/团队时可管理关联关系（增删项目/仓库）
* 删除时自动清理关联关系（FK ON DELETE CASCADE）

## Acceptance Criteria

* [ ] 选中项目后，ProgressMonitorPanel 仅显示关联该项目的员工和团队
* [ ] 无项目但有仓库时，ProgressMonitorPanel 仅显示关联该仓库的员工
* [ ] 无项目无仓库时，ProgressMonitorPanel 员工/团队区域为空
* [ ] 新建员工时自动关联当前项目（如有）和仓库（如有）
* [ ] 新建团队时自动关联当前项目（如有）
* [ ] 员工编辑界面可增删关联的项目和仓库
* [ ] 团队编辑界面可增删关联的项目
* [ ] 删除员工/团队时关联关系自动清理

## Definition of Done

* 类型检查通过
* 现有功能不受影响
* 关联关系 CRUD 在 UI 中可正常操作

## Technical Approach

### 后端（Rust/Tauri）

1. 在 `wise_db.rs` 中增加查询方法：
   - `list_project_employees(project_id)` — 查询项目关联的员工
   - `list_project_workflows(project_id)` — 查询项目关联的团队
2. 新增 Tauri 命令：
   - `list_project_employees` / `add_project_employee` / `remove_project_employee`
   - `list_project_workflows` / `add_project_workflow` / `remove_project_workflow`

### 前端服务层

1. 扩展现有 `projectPrdScope.ts` 或新建 `projectMembers.ts`：
   - 增加 `listProjectEmployeeIds`, `addProjectEmployee`, `removeProjectEmployee`
   - 增加 `listProjectWorkflowIds`, `addProjectWorkflow`, `removeProjectWorkflow`
2. 在 `employees.ts` / `workflowTasks.ts` 中增加过滤逻辑

### 前端 UI 层

1. **ProgressMonitorPanel**：
   - 获取当前项目/仓库上下文
   - 根据上下文过滤员工/团队列表
2. **EmployeeConfigModal**：
   - 新增项目/仓库关联管理 UI（多选下拉框）
   - 创建时自动关联当前上下文
3. **WorkflowConfigModal**：
   - 新增项目关联管理 UI（多选下拉框）
   - 创建时自动关联当前项目

## Technical Notes

- `.trellis/spec/frontend/index.md` - 前端编码规范
- `src/services/projectPrdScope.ts` - 已有的 PRD 范围服务
- `src/services/employees.ts` - 员工 CRUD 服务
- `src/components/ProgressMonitorPanel/index.tsx` - 团队/员工展示面板
- `src/components/EmployeeConfigModal/index.tsx` - 员工配置弹窗
- `src/components/WorkflowConfigModal/index.tsx` - 团队配置弹窗
