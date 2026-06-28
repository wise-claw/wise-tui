# 更新日志

本项目所有重要变更将记录于此文件。

## [1.2.0] - 2026-06-28

1.2.0 围绕"会话面板与输入体验重构、模型/Provider 配置简化、Git 面板全面增强、性能与稳定性修复"四条主线推进。核心亮点包括：**仓库主会话面板**与 Composer 运行时设置重构、Codex 第三方 Provider 预设、默认配置面板快捷键与外观设置、新增 ⌘N/Ctrl+N 全局快捷键一键新建会话，以及 Git Flow / 行统计 / 工作区切换的一体化重构。

本版本涵盖 33 个提交，覆盖前端与 Tauri 后端共 70+ 个文件。

### ✨ 新功能

#### 会话与输入体验
- **仓库主会话面板（RepositorySessionPanel）**：在右侧 Inspector 新增按仓库维度管理"主会话"，支持面板过滤、绑定关系持久化与折叠分组。
- **Composer 运行时设置重构**：将运行时配置从隐式状态抽离为可触发的 `ComposerRuntimeSettingsTrigger`，并接入新的 `ComposerModelPicker`，运行时切换与模型切换解耦。
- **全局快捷键 ⌘N / Ctrl+N 快速创建新会话**：在任意焦点下按下即可唤起新建会话入口。
- **会话界面 ClaudeChat 逻辑收敛**：移除冗余分支，统一到会话宿主层。
- **Todo Dock 修复后闭环**：todo 关闭后，新任务写入自动重新展开；新轮发送不再错误还原上一轮已完成的 todo。

#### 模型与 Provider
- **Codex 第三方 Provider 预设**：内置 9 个常用 Provider（DeepSeek、Minimax、百炼、火山等），自动填充 baseURL 与推荐模型；Codex 模型切换页集成 Provider 下拉，简化配置流程。
- **Claude 模型顶栏面板高级配置折叠**：原始 `auth.json` / `config.toml` 编辑器默认收起，引导用户优先选择 Provider + API Key。
- **`/models` 快捷字段 `ModelProfileQuickConfigFields`**：与 Provider 预设联动，减少面板来回切换。

#### 默认配置面板
- **快捷键设置项**：在默认配置面板新增全局快捷键相关的可配置项。
- **外观设置项**：UI 主题、Chrome 可见性等外观相关配置集中入口。

#### Git 面板
- **Git Flow 面板（`GitFlowPanel`）**：从 0 到 1 实现的流程视图，整合分支状态、暂存区与提交流。
- **Git 面板更多菜单（`GitPanelMoreMenu`）**：将 Flow、菜单项等操作整合为统一菜单，并补齐空值安全保护。
- **左栏仓库列表 `RepositoryActiveSessionBadge`**：仓库行内显示当前活跃会话计数，状态一目了然。
- **`useSidebarRepositoryActiveSessionCounts` hook**：高效统计每个仓库的活跃会话数。
- **Diff Mode 提交按钮**：可一键生成提交信息。
- **编辑器支持 Ctrl/Cmd 点击 `import` / `export` 路径跳转目标文件**。
- **Monaco TypeScript 环境补充 React 类型库**：编辑器智能提示更准确。

### ⚡ 性能优化
- **Claude 会话流式解析优化 + 任务事件查询索引**：流式期间减少重复解析，新增任务事件索引加速回查。
- **Git 行统计改用 `git --numstat` + `memchr` 字节扫描**：相比 `libgit2` 自实现统计路径在大量变更下显著提速。
- **`git_status_summary` 改为异步执行**：避免在主线程阻塞 UI。
- **`git --numstat` 命令统计暂存与未跟踪文件行数**：命令路径替代内部库，规避多处精度 bug。
- **Git 工作区选择器 `GitPanelWorkspaceSelector` 重构**：去掉冗余渲染路径，简化状态切换。
- **未跟踪文件行数统计**：改用 libgit2 `show_untracked_content` 选项替代手写实现，并简化暂存区行统计的树比较分支。
- **工作区选择状态 `workspaceSelectionState`**：减少不必要的状态广播。

### 🐛 问题修复
- 修复加载更早消息后视口贴底误触窗口回收。
- 修复多屏窗格仓库跟随左栏误切与滚动弹跳。
- 修复 Git `flowItems` / `menuItems` 渲染时空指针崩溃（增加空值安全保护）。
- 修复 todo 关闭后新任务写入未自动重新显示。
- 修复新轮发送后错误还原上一轮已完成的 todo。
- 修复 `statuses` / `diff.foreach` 遍历逻辑，正确统计未跟踪文件行数。
- 修复 `propsEqual` 相关回归补全。

### 🧹 重构与精简
- **Composer 区域逻辑收敛**：移除冗余状态与重复 effect。
- **多屏窗格 `ClaudeMultiPaneGrid` 与宿主简化**：去掉不必要的派生状态。
- **`claudeChatComposerTrayPropsEqual` 增补**：浅比较覆盖新加的运行时设置 prop，避免无效重渲染。
- **`InspectorCollapsibleSection` 增强**：仓库主会话面板的折叠分组支持稳定展开/收起。
- **`inspectorStorage` 持久化键调整**：避免与现有 Inspector 状态冲突。
- **`claudeSessionContext` 流式上下文清理**：去除重复写入路径，索引替代全量遍历。
- **`wiseDefaultConfigStore` 默认配置 store**：集中快捷键、外观等设置项的写入。

### 🗃 数据库
- 本版本无破坏性迁移；`session_feedback_loop`、`session_feedback_patch_effectiveness` 等 1.1.0 表保持兼容。

### 📦 升级说明
- 升级后默认配置面板中可立即看到新的「快捷键」「外观」分类。
- Codex 用户在模型切换页可直接下拉选择 Provider，URL/Model 自动填充；如需手写 `auth.json` / `config.toml`，点击"高级配置"展开。
- 全局快捷键 ⌘N / Ctrl+N 默认启用；若与其他应用冲突，可在默认配置面板中调整。
- 仓库主会话面板绑定信息持久化于 Inspector 存储中，升级后无需重新绑定。

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
