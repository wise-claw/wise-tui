# 更新日志

本项目所有重要变更将记录于此文件。

## [1.1.0] - 2026-06-23

1.1.0 将 Wise 进一步演进为多引擎 AI 工作台：新增 **OpenCode** 作为与 Claude Code、Codex 并列的可执行引擎，建立 **会话反馈循环**（补丁有效性评分 + 自动化守卫 + 审计日志），强化用量可观测性（**Claude 行编辑热力图**），并完成一轮渲染性能重构与 Trellis 遗留运行时精简。

本版本涵盖 80 个提交，781 个文件变更（+31,112 / −84,700）。

### ✨ 新功能

#### 引擎与模型
- **OpenCode 引擎全链路集成**：新增二进制管理（`opencode_binary`）、会话执行（`execute_opencode_code`）、stdout 流适配（`opencode_stream_adapter`），并配套 **OpenCode Go 代理**，支持模型切换、配置管理、Claude/Codex 设置桥接与 traces 追踪。
- **OpenCode 设置编辑器与模型配置模板**：在会话侧提供 `OpencodeSettingsEditor` 与开箱即用的 profile 模板。
- **Codex 二进制管理**：新增 `codex_binary` 模块；provider 档案切换时整体替换 `config.toml`，使 provider 配置真正生效。
- **`/models` 斜杠命令**：打开模型切换面板，支持 OpenCode 引擎模型切换。
- **三引擎默认配置面板**：统一管理 Claude / Codex / OpenCode 默认配置与设置项。
- **斜杠指令补全**：支持加载用户全局技能。

#### 会话反馈循环
- **顶栏触发器与工作区钩子**：`SessionFeedbackLoopTopbarTrigger` + `useSessionFeedbackLoopWorkspace` 提供统一入口。
- **补丁有效性评分与历史持久化**：新增 `session_feedback_loop_history` 与 `session_feedback_patch_effectiveness` 两张表（迁移 044），按仓库维度追踪补丁应用效果。
- **反馈自动化守卫与审计日志**：`feedbackAutomationGuard` + `feedbackAutomationAuditLog`，对自动化反馈动作做守卫与可审计记录。
- **仅计划批准的自动批准模式**（plan-only auto-approve）。
- 待处理任务队列与反馈循环配置增强；扩展洞察分析能力。

#### 用量与可观测性
- **Claude 行编辑热力图**：后端 `claude_code_line_edits` 采集行级编辑快照，前端 `claudeLineEditsHeatmap` 渲染热力图。
- **用量面板扩展**：新增工具栏、用量胶囊组（`UsagePillGroup`）、行编辑内容视图；用量图表重构为摘要条视图。
- 仓库 / 会话用量基线（`useRepositoryUsageBaseline` + `sessionUsageBaseline`）。

#### Git 面板
- 仓库文件浏览与拖拽交互优化。
- Diff 模式显示效果优化。
- 推送时支持**取消 AI 提交信息生成**。
- **一键推送流程**：移除弹窗，下沉按钮事件为直接执行。

#### 多屏窗格
- 替换会话时保留自身执行环境与模型。
- 额外窗格新建会话继承主窗格运行时覆盖与模型。
- 按多屏布局约束主窗口最小尺寸。

#### 配置与界面
- 顶栏 Chrome 可见性默认配置与设置面板。
- Composer 底部 Chrome 可见性默认配置项。
- Claude Hooks 配置面板与路径展示优化。
- **命令面板重构**：搜索范围移入顶栏，新增底部快捷键栏与结果计数。
- 文件编辑器 tab 面板抽离；仓库树标记未保存修改状态。

### ⚡ 性能优化
- 引入**主线程拥塞控制与 UI 延迟调度**，优化整体渲染性能。
- 主线程拥塞时放慢非关键轮询；对 `ResizeObserver` 做 rAF 节流。
- 降低非主窗口轮询频率。
- 流式 **tail-patch 增量复用 fold 缓存**，避免每 tick 全量重算。
- Claude 会话流式期间预算裁剪与快照查询性能优化。
- 引入 **`propsEqual` 浅比较机制**（覆盖消息列表与监控面板），避免组件无效重渲染。
- 消息列表窗口增加 `maxVisible` 封顶，防回缩与贴底回收。
- Monaco 本地化加载；屏蔽仓库浏览场景的类型解析误报。

### 🐛 问题修复
- 修复多屏窗格仓库跟随左栏误切与滚动弹跳。
- 修复加载更早消息后视口贴底误触窗口回收。
- 修复文件编辑器 Markdown 预览在面板重挂时回退到编辑态。
- 修复 Codex 配置顶层重复 `model` 行导致 TOML 解析失败。
- 修复 Codex provider 档案切换后配置不生效。
- cursor SDK bridge 加载 user 层设置，确保 Local Agent 挂载文件读写工具。
- 修复 `propsEqual` 语法错误，补全 Monaco 语义高亮类型与缺失导入。
- 增强会话停止逻辑，取消正在执行的会话任务。
- 修正空提交信息判定逻辑，避免误规范化。

### ⚠️ 移除与精简
本版本精简了一批 Trellis 工作流编排时期的遗留运行时，转向更清晰的工作台形态。涉及数据库迁移 041–043，**相关数据将被清理，升级前请备份**：
- 移除**代码知识图谱**模块（`CodeKnowledgeGraph`）及相关依赖（迁移 041）。
- 移除**工作区备忘**（`WorkspaceMemosPanel`）（迁移 042）。
- 移除 **PRD 拆分向导与任务拆分面板**（`PrdSplitWizard` / `PrdTaskSplitPanel`）及 Trellis 运行时（`MissionControl` / `Inspectors`）（迁移 043）。
- 移除 Claude 会话任务列表抽屉。
- 移除 Wise Trellis 内置引导项，简化工作区引导选择器。

### 🗃 数据库迁移
- `041_drop_code_knowledge_graph.sql`
- `042_drop_workspace_memos.sql`
- `043_drop_trellis_mission_prd.sql`
- `044_session_feedback_loop.sql`

### 📦 升级说明
- 升级后自动执行 041–043 迁移，代码知识图谱、工作区备忘、PRD/Trellis 运行时相关数据将被清理，请提前备份。
- 首次使用 OpenCode：在设置中配置 OpenCode 二进制路径与 Go 代理，即可在 `/models` 或会话中切换至 OpenCode 引擎。
- Codex / OpenCode 默认配置可在新的默认配置面板统一管理。
