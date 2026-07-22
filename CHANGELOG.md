# 更新日志

本项目所有重要变更将记录于此文件。

## [1.4.0] - 2026-07-22

1.4.0 围绕"终端与多窗格布局全面重构、Qoder / Cursor / OpenCode 三引擎生态整合、操作卡顿与派发稳定性兜底、Markdown 编辑器与工作区体验增强"四条主线推进。核心亮点包括：**终端渲染引擎由 ghostty 切换为 alacritty 并按职责拆分模块**、**终端面板支持中栏显示并完善多窗格布局配置**、**Qoder 二进制与流式命令全链路集成**、**新增工作区全局备忘录与 Milkdown 语法工具栏屑**、**工作区待办新增全局作用域**、**引入操作卡顿看门狗与 IPC 超时兜底机制**，以及 Markdown 行级编辑热力图、Agent 注册表扫描、多源 AI 用量聚合等可观测性增强。

本版本涵盖 33 个提交（v1.3.0..HEAD），覆盖前端与 Tauri 后端共 90+ 文件，含两次数据库迁移（047 工作区待办全局作用域、049 工作区全局备忘录）。

### ✨ 新功能

#### 终端与多窗格布局全面重构
- **终端渲染引擎由 ghostty 切换为 alacritty**：移除 ghostty 相关 patch 脚本（ghost-cursor / keyboard-protocol / selection-scale），Cargo 依赖切到 alacritty_terminal，渲染管线按 frame.rs / mod.rs 拆分，关注点分离。
- **终端面板支持工作区中栏显示**：新增 `terminalCenterPanelStore` 与 `terminalCenterSlot.tsx`，可让终端在工作区中央栏渲染,与中栏消息列表/文件编辑器三选一。
- **多窗格布局模式与主题样式重构**：抽出 `useMainLayoutModes` 集中管理多窗格布局模式与宽度 clamp；`multiPaneSlots` 工具函数拆分主窗格/额外窗格槽位计算,新增单测覆盖。
- **多屏窗格宽度按屏幕可用宽度 clamp 防止超出锁死**：扩展窗口/minSize 必须 clamp 到屏幕可用宽度,避免超出屏幕且 OS 锁死缩不回；`pane CSS min-width` 须 0 让 `minmax(0,1fr)` 生效；GAP 常量与 CSS `gap:2px` 须一致。

#### Qoder / Cursor / OpenCode 三引擎整合
- **集成 Qoder 二进制与流式命令模块**：新增 `qoder_binary.rs` / `qoder_commands.rs` / `qoder_stream_adapter.rs` 后端模块（约 1005 行），前端会话执行引擎 chip 与 Composer 模型选择器接入 Qoder；Composer 新增 session execution engine 切换支持。
- **重构 Cursor SDK 集成并切换到独立 cursor_binary 模块**：原 `scripts/cursor-sdk-bridge.*` 一系列外部脚本与桥接逻辑（bridge / probe / images / model / repositoryFiles / stderrFilter / stream）全部下放后端 `cursor_binary.rs` 与 `cursor_agent.rs`，逻辑归一处。
- **拆分 cursor / opencode 二进制模块并精简模型配置与会话 hook**：`cursor_binary.rs` / `opencode_binary.rs` 作为薄包装,统一会话 hook 与模型配置入口。
- **精简 Claude 模型顶栏面板与运行时设置触发器**：`ClaudeModelTopbarPanel` 与 `ComposerRuntimeSettingsTrigger` 收敛冗余状态与派生计算。

#### Markdown 编辑器与工作区体验增强
- **新增工作区全局备忘录与 Milkdown 语法工具栏屑**：新增 `WorkspaceMemoPanel` 组件（289 行）+ `workspaceMemoPanelStore`，左栏快捷入口与工作区级持久化；Milkdown 编辑器新增 `MilkdownSyntaxToolbar`（190 行）与任务列表命令模块，行内语法按钮与列表项工具栏屑可视。
- **工作区待办新增全局作用域并精简计数与弹窗逻辑**：迁移 047 新增 `workspace_todos_global_scope`，工作区可承载跨仓库全局待办；统一计数与弹窗逻辑，移除 `SidebarGlobalWorkspaceTodoAddModal` 独立入口并精简 `WorkspaceTodosEditor` 159 行。
- **统一常用语管理面板并移除独立全局入口**：合并 `GlobalComposerCommonPhrasesManager` 与 `ComposerCommonPhrasesPanel` 到单一面板,统一配置入口。
- **新增工作区列表布局配置与可见行数自适应**：默认配置面板新增工作区列表布局设置项；`useWorkspaceListVisibleRows` 自适应可见行数。
- **优化左栏状态管理与面板布局配置**：`useProjectRepositorySidebarState` 收敛仓库/项目维度状态，新增 106 行单测覆盖。
- **新增仓库面板分栏拖拽手柄与高度持久化**：`RepoPanelSplitResizeHandle` 组件（179 行）+ `useRepoPanelSplitHeightPx` hook + `useWiseTopbarChromeVisibility` 配合；HTML5 拖拽 + 高度落库到默认配置 store；288 行单测覆盖拖拽/释放/边界。

#### 操作卡顿与稳定性兜底
- **引入操作卡顿看门狗与超时兜底机制**：新增 `operationWatchdogStore`（152 行）+ `useBusyTimeout` hook + `OperationStuckBanner` 浮层；IPC 接入 `ipcTimeouts` / `promiseWithTimeout` 超时包装；当主线程拥塞或 IPC 卡住超阈值时浮层兜底引导用户操作；移除旧 `OperationStuckBanner` 重构后的精简版。
- **增强执行环境派发与语音流水线稳定性**：`executionEnvironmentDispatch` 重构派发失败重试 + dispatchFailureTracker 退避；`useComposerSpeechPipeline` 静音/清空/历史拖入三处隐患加固；新增 92 行单测覆盖。
- **派发任务占位与运行面板重复修复**：rehydrate 占位 item 与真实 worker 共存致运行面板重复,store 三处写入加 prune 修复。
- **会话切换在途写入与派发门闸残留致任务丢失修复**：`composer-region` + `ClaudeChat` + `useClaudeSessions` 三处协同,会话切换时主动 flush 在途写入并清派发门闸残留。

#### 可观测性与 Agent 生态
- **新增 Agent 注册表扫描与展示支持**：后端 `agent_registry.rs` 290 行扫描本地 Agent；前端 `agentRegistryPresentation` 57 行展示规则；`AgentRegistrySection` 80 行配置 UI。
- **新增多源 AI 用量聚合与消息列表样式兜底**：后端 `ai_usage_multi_source.rs` 909 行聚合多源用量；`claude_code_line_edits` 86 行新增行级编辑快照；`ClaudeCodeUsagePopover` 用量展示更新；消息列表新增样式兜底规则防溢出。
- **优化触发器锚点与 Git 提交流水线**：`composer-trigger-anchor` 65 行优化锚点定位;`gitCommitPullPush` 27 行完善提交流水线;新增 178 行单测覆盖。

#### Composer / 消息 / 多屏增强
- **优化会话任务详情抽屉预取与分发行渲染**：`SessionConversationTaskDetailDrawer` 158 行优化抽屉预取与分发;`prefetchSessionConversationTaskDetailDrawer` 工具函数复用。
- **优化 Claude 会话与历史抽屉交互体验**：`ClaudeSessionTab` 收敛历史切换交互;`historySessionDrawerChrome` 完善抽屉 chrome 与空态。
- **优化 ClaudeChatInput 纯文本工具与区域渲染**：`composer-plain-utils` 59 行抽取纯文本工具;`composer-region` 142 行区域渲染加固。
- **抽取工具分组活动摘要工具并精简消息部件渲染**：`toolGroupActivitySummary` 162 行工具函数,`MessageParts` 284 行精简到更聚焦的渲染。

#### 顶栏 / 配置 / 快捷键
- **顶栏会话相关触发器可见性默认值与配置对齐**：`SessionDataLinkTopbarTrigger` / `SessionFeedbackLoopTopbarTrigger` 默认值与 `wiseDefaultConfigStore` 对齐,避免老用户被归零或挂载闪烁。

### ⚡ 性能优化
- **终端渲染模块拆分后管线更轻量**：`terminal/frame.rs` 与 `terminal/mod.rs` 分离后渲染路径更聚焦,`useTerminalSession` 736 行瘦身后聚焦会话编排。
- **常用语面板合并与消息部件精简**：`ComposerCommonPhrasesPanel` 396 行精简 + `MessageParts` 284 行精简,减少无效重渲染与冗余 DOM。
- **左栏仓库列表性能 CSS 收敛**：`leftSidebarListPerformance.css` 精简渲染路径,与 `useProjectRepositorySidebarState` 协同降低首屏成本。

### 🐛 问题修复

#### 派发与权限生命周期
- **派发任务占位与运行面板重复**（如上）。
- **会话切换在途写入与派发门闸残留致任务丢失**（如上）。
- **统一归零 ignoreNextContentSyncRef 防残留吞下次粘贴**：清空发送 ignoreNext 残留,发送后粘贴单条内容按钮不再变灰,composer-region-races 147 行单测覆盖。
- **权限请求已应答时防止被降回 pending**：`hub.setPermissionRequest` 加 `same id + non-pending` 早返回守卫;`streamIngest` 兜底重放加 lifecycle 检查;183 行单测覆盖。

#### 多屏 / 视图控制
- **多屏窗格宽度按屏幕可用宽度 clamp 防止超出锁死**（如上）。
- **顶栏会话相关触发器可见性默认值与配置对齐**（如上）。

### 🧹 重构与精简
- **终端渲染引擎 ghostty → alacritty 切换**（如上）。
- **Cursor SDK 集成下放后端并切换到独立 cursor_binary 模块**（如上）。
- **拆分 cursor / opencode 二进制模块**（如上）。
- **精简 Claude 模型顶栏面板与运行时设置触发器**（如上）。
- **统一常用语管理面板并移除独立全局入口**（如上）。
- **抽取工具分组活动摘要工具并精简消息部件渲染**（如上）。
- **提取多窗格布局模式与主题样式重构**（如上）。
- **清理已下线作者面板与状态弹窗等冗余模块**：`AuthorPanel` / `AuthorPanelTabs` / `CursorSdkDiagnosticPanel` / `AppSettingsModal` / `CompletedTaskPanel` 等已下线模块整体清理,删除约 700+ 行遗留代码。
- **重构终端主题与侧栏样式并移除操作卡顿横幅**：精简 `LeftSidebar` / `SidebarIcons` / `ProjectRepositoryList` / `repositoryRows` 冗余样式。
- **完善终端中栏显示与多窗格视图控制**：`ClaudeChat` / `claudeChatHelpers` / `useTerminalSession` / `paneCenterViewControlStore` 协同,中栏视图控制逻辑收敛。

### 🧪 测试
- **补齐 Composer 区域竞态回归测试**：composer-region-races 147 行单测覆盖清空发送 / ignoreNext 残留 / 派发门闸残留 / setContent 异步回流。
- **补齐派发失败重试与语音流水线单测**：executionEnvironmentDispatch 92 行单测覆盖派发失败重试 + 退避 + 语音静音/清空/历史拖入三处隐患。
- **补齐左栏仓库/项目状态管理单测**：useProjectRepositorySidebarState 106 行单测覆盖仓库/项目维度状态切换。
- **补齐仓库面板拖拽手柄单测**：RepoPanelSplitResizeHandle 288 行单测覆盖拖拽开始/拖拽中/释放/边界 clamp。
- **补齐工具分组活动摘要单测**：toolGroupActivitySummary 64 行单测覆盖工具分组与活动摘要纯函数。
- **补齐 Composer 常用语合并单测**：composerCommonPhrase 59 行单测覆盖常用语合并与冲突规则。
- **补齐权限请求生命周期单测**：hub.lifecycle 63 行 + streamIngest 93 行覆盖权限请求已应答时被降回 pending 的回放与守卫。
- **补齐多屏槽位工具函数单测**：mainLayoutWidths.multiPane 111 行单测覆盖多屏宽度 clamp 与槽位计算。
- **补齐 composer 触发器锚点单测**：composer-trigger-anchor 74 行单测覆盖触发器锚点定位与 Git 流水线分支。
- **补齐 Git 提交流水线单测**：gitCommitPullPush 104 行单测覆盖 Git 提交/推送/取消。
- **补齐终端中栏 store 单测**：terminalCenterPanelStore 96 行单测覆盖中栏切换与持久化。
- **补齐工作区列表布局常量单测**：workspaceListLayout 21 行单测覆盖列表布局默认值与归一化。
- **补齐 Agent 注册表 store 单测**：agentRegistryStore 98 行单测覆盖注册表扫描/展示/格式化。
- **补齐聊天消息列表样式兜底单测**：chatMessageListRowStyles 33 行单测覆盖长文/代码块样式兜底。
- **补齐 Claude Chat helpers 单测**：claudeChatHelpers 3 行新增测试覆盖会话切换/历史抽屉工具函数。
- **补齐 Composer 纯文本工具单测**：composer-plain-utils 40 行单测覆盖纯文本工具函数。
- **补齐 Composer 运行时设置触发器单测**：ComposerRuntimeSettingsTrigger 3 行新增测试覆盖运行时设置触发。
- **补齐 Agent 注册表展示单测**：agentRegistryPresentation 2 行新增测试覆盖展示规则。
- **补齐 dismissStuckOverlays 单测**：dismissStuckOverlays 8 行单测覆盖卡顿浮层关闭。
- **补齐操作看门狗 store 单测**：operationWatchdogStore 49 行单测覆盖卡顿超时阈值与浮层触发。
- **补齐多窗格槽位单测**：multiPaneSlots 12 行单测覆盖主窗格/额外窗格槽位工具函数。
- **补齐 monitorPanelLayout 单测**：monitorPanelLayout 2 行新增测试覆盖监控面板布局。
- **补齐 Composer 常用语常量单测**：composerCommonPhrase.test 59 行覆盖合并与默认值。
- **补齐 Cursor SDK stderr 单测移除**：原 `cursor-sdk-bridge.stderr.test.ts` 39 行与 bridge 整体下放后端随之移除。

### 🗃 数据库迁移
- `047_workspace_todos_global_scope.sql` — 工作区待办全局作用域。
- `049_workspace_global_memo.sql` — 工作区全局备忘录。

### 📦 升级说明
- **存储键新增**：`wise.defaultConfig.workspaceMemoPanelVisible` / `wise.defaultConfig.leftSidebarWorkspaceListLayout` 等若干默认配置键,沿用现有 `wiseDefaultConfigStore` 无感升级。
- **`workspace_inspector` 表新增列**：workspace_global_memo / workspace_todos_global_scope（迁移 047、049）;老数据库自动迁移,无需手动操作。
- **后端模块重组**：原 `scripts/cursor-sdk-bridge.*` 系列脚本下放后端 `cursor_binary.rs`;外部运行时不再依赖 TS 桥接脚本,可执行性更稳。
- **终端渲染切换**：ghostty → alacritty,3 个 patch 脚本移除;升级后首次启动终端面板会自动用 alacritty 后端,无外部配置变更。
- **手动验证清单**（`bun run tauri:dev`）：
  1. 多窗格：拖窗格分隔条,确认尺寸在屏幕可用宽度内不溢出；
  2. 终端中栏：把终端面板拖到工作区中央栏,确认渲染正常并能切换消息/文件/终端三视图；
  3. 工作区全局备忘录：在工作区列表选「全局备忘录」入口,创建/编辑/删除一条,关闭重开 app 数据应保留；
  4. 工作区全局待办：在工作区列表入口创建全局待办,跨仓库应可见；
  5. Qoder 引擎：composer 顶栏切换到 Qoder 引擎,确认二进制扫描、会话派发、流式响应正常；
  6. 仓库面板拖拽手柄：拖仓库面板下方分隔条,松手后高度应保留,重开 app 应恢复；
  7. 操作卡顿看门狗：故意构造一次长 IPC 调用,确认卡顿浮层可正常弹出并可关闭。

## [1.3.0] - 2026-07-10

1.3.0 围绕"Ultracode 多代理模式落地、多屏隔离能力成型、外部终端与运行面板体验打磨、Claude 流式装配稳定性"四条主线推进。核心亮点包括：**每条 Claude 会话可独立切换 Ultracode 工作模式（`/ultracode` slash 命令 + composer 紫色 chip）**、**多屏 per-pane 顶栏与按仓库隔离的常用语**、**外部终端按钮右键配置运行指令**、以及 Claude 流式长文段间污染（P0–P9 result 权威对齐 / 段间压缩 / 重复气泡）等十余处稳定性修复。

本版本涵盖 83 个提交（v1.2.1..HEAD），覆盖前端 30+ 文件、Tauri 后端零改动（沿用现有 `--settings` 顶层 `ultracode` 透传路径）。

### ✨ 新功能

#### Ultracode 多代理工作模式
- **每条 Claude 会话可独立切换 Ultracode 模式**：在 composer 内输入 `/ultracode` 即可为本会话开启或关闭 Ultracode 工作模式（per-session override 优先级高于全局默认）；启用时自动向 Claude 注入 OMC ultracode 工作流 system-prompt（explore → design → parallel verification → synthesis），composer header 出现紫色 `ultracode` chip，1 击关闭。
- **三种 slash 语法**：
  - `/ultracode` — 纯切换本会话状态（启用/跟随全局）
  - `/ultracode off` — 显式关闭（覆盖全局 on 状态）
  - `/ultracode <prompt>` — 启用本会话并把 `<prompt>` 作为用户消息直接发送
- **优先级规则**：per-session `false` beats global `true`，per-session `true` beats global `false`；状态落盘到 `tabs.json`，重启后恢复。

#### 多屏 per-pane 顶栏与隔离
- **每个 pane 拥有独立顶栏**：primary pane 含窗口级按钮（新建会话、文件搜索、设置等），extra pane 仅保留仓库级按钮，避免按钮冗余与状态串扰。
- **Composer 常用语按仓库隔离**：每个 pane 的快捷栏按当前仓库优先，全局兜底；首次编辑时复制全局条目到当前仓库，避免破坏全局配置；存储键升级为 `wise.composer.commonPhrasesByRepo.v1`，按 `repositoryId` 分桶。
- **修复多屏下跨 pane 文件路由串读 bug** 共 4 处：第二屏文件搜索透传 `fileRootPath` 避免读到第一屏仓库；primary pane 打开文件不再误卸 extra pane 的编辑器节点；`loadEditorFile` existing 分支校验 `rootPath` 避免跨仓库同名文件串内容；避免 stale target 串 pane。

#### 外部终端可配置运行指令
- **外部终端按钮右键配置运行指令**：左键沿用「运行」按钮已配置的指令直接打开终端；右键弹出精简 popover 配置，与「运行」按钮共享同一份 `localStorage`（key: `terminal-run-command`），配置修改实时同步两侧。
- **macOS 新实例强制参数**：Ghostty / Kitty / Alacritty / WezTerm 等终端必须用 `open -na <App> --args <cmd>` 强制开新实例才能接收 `--args`；修复后 CLI 派发自动追加 `-n` 标志。
- **IPC 参数命名修正**：修复 `macos_open_terminal_with_command` 入参命名与 Python 侧不一致导致的参数丢失问题。

#### 助手模板与会话快捷操作
- **会话级快捷操作支持左栏弹窗编辑**：从仓库级提升到会话级，归属标签展示具体工作区或仓库名并超长省略，新增可点击图标触发弹窗。
- **助手模板激活逻辑收敛到 store + hook**：UI 事件源单一来源；模板激活路径与会话快捷操作布局完善。
- **新增工作区快捷操作添加图标**：标题旁 SVG + 图标 → `WorkspaceQuickActionAddModal`；scope 校验 / pickFolder / retain-scope 复用。

#### 文件 / 编辑器体验升级
- **文件树支持内联重命名**：直接在树上 F2 / 双击重命名，无需打开文件编辑器。
- **编辑器顶栏新增按钮、tab 右键菜单支持「在文件树中定位文件」**：快速跳转文件在树中的位置。
- **新增 ⌘J / Ctrl+J 文件内容搜索快捷键**：与文件搜索并列，编辑器内跨文件搜文本更顺手。
- **文件打开时与消息列表可共存切换**：通过顶栏 Segmented 在「消息」与「文件」间切换（收起侧边栏图标右边），centerView 状态提升到 pane 层 hook；ClaudeChat 与文件编辑器互不卸载。

#### 运行面板与 Composer
- **运行面板详情抽屉复用主输入框并按 worker 路由控制请求**：减少 UI 重复，避免 worker 错位。
- **运行面板折叠时头部显示正在执行数量徽标**：不用展开面板也能知道当前有多少任务在跑。
- **同一运行报错仅派发一次自动修复**：避免重复弹窗与重复任务。
- **主会话顶栏展示最近发送的消息并支持一键复制**：常用 prompt 一键复用。

#### 应用内快捷键扩展
- **新增 ⌘J / Ctrl+J 文件内容搜索**（如上）。
- **扩展应用内快捷键支持工作区操作**：批量注册新快捷键到快捷键系统。
- **新增新建会话时迁移旧会话输入框草稿**：避免切换 tab 草稿丢失。

### ⚡ 性能优化
- **流式装配期间减少重复解析与正则计算**：把会话/工具相关热路径上的解析/正则收敛到模块级缓存或纯函数 helper，避免每次 chunk 到达都跑一次昂贵计算。
- **Claude 流式 JSONL 装配任务事件索引**：补齐 Claude 流与会话 JSONL 装配单测，回查任务事件 O(1) 定位。
- **Monaco Git 变更行装饰 hook 单测补齐**：装饰计算移出渲染路径，编辑器滚动更流畅。

### 🐛 问题修复

#### Claude 流式装配稳定性
- **流式长文段间压缩 bug 修复**：实时接收长文段落粘连、刷新磁盘态才规整的根因=段间距 4× 落差 + chat-prose 触发滞后 + 流式段落剥离无条件压平；三层根因同步修复（`chat-prose` 早触发 + 流式段落保护 + 磁盘态字节级等价对齐）。
- **合并相邻 text part 渲染**：消除长文段落粘连的最后一段断崖。
- **修复 Claude 流式消息正文翻倍与 result 文本重复装配**：根因是流式与磁盘重载两套 parts 装配路径分歧；P0–P9 result 权威对齐 reconcile + P5 stale-ref 跨帧竞态 reconcile 前 sync flush + containment 对称守卫 + P1 前缀包含去重 + P2 兜底加固 + P6 tail 前导空白双重换行 + P7 complete 路径 previewRaw 三源污染 + P8 缓冲 result 事件翻倍 + P9 reconcile 多块 disjoint。
- **修复首发会话 id 迁移致重挂后输入框失焦**：consume 只读不删 + `onSessionTabIdMigrated` 调 `migrateComposerRefocus` 迁到 realSessionId。

#### Composer 派发稳定性
- **修复 composer 队列 main lane 同帧重复派发**：根因 = `onExecute` 同步翻 store + React 重渲染异步；修法 = `mainLaneDispatchGate` 显式记录「已派但 status 未翻 active」窗口，5s timeout 兜底。
- **增强 composer 派发稳定性避免失败循环与重置 ref 卡死**：`dispatchFailureTracker`（max3 / 2s 线性退避 / drop）+ `suppressFinalFlush` 防旧 ref 重派绕过退避；`onGiveUp` 兜底 settle。
- **修复同一帧 setContent 48 帧耗尽 onAfterSet 不调致 pending/resetting ref 永久卡死**（canSend 灰 + 打字吞）：`onGiveUp` 兜底 settle。
- **防止 ClaudeChat 瞬时卸载导致本地状态丢失**：`panelBelowMessages` 卸载陷阱修复，需提升到 hook 层的本地 `useState` 全部迁移。
- **发送消息后重新聚焦输入框支持连续输入**：Semi handleSend 在 canSend=false 静默 return + React/Tiptap rAF 窗口；`pendingSetContentRef` + `composerResettingRef` + onMessageSend 优先 React prompt + onAfterSet 兜底算 canSend 四处加固。
- **将 Claude 错误文案友好化为中文并附原文**：英文透传（Overloaded / rate_limit / 529 / ECONNRESET 等）转中文 + 附原文；`humanizeClaudeError` 纯模块接入 `claudeStreamParser`（系统错误 / 轮次失败兜底）+ `claudeInvocationText`（副本）；不接入 MessageParts `part.error`（工具错误误伤）。

#### 路由 / 焦点 / 视觉
- **修复 monaco 跨 pane model 共享 bug**：两屏各自 README.md 内容串读 + 关闭联动根因 = 非 TS 文件 `editorPath` 缺 rootPath 哈希，@monaco-editor/react 按 path 复用同一 model；修为 `monacoUriForRepositoryPath(tab.relativePath, tab.rootPath)`。
- **修复多屏 splitter drag 不收敛**：用户拖 splitter 改 pane 尺寸时画面不停抖动；本轮最小加固（ratio 0.0005 同值跳过）+ 静态检查全过。
- **修复 Git 树节点箭头悬停时被隐藏的问题**：CSS 规则多余闭合括号断行与问号类选择器未转义导致 hover 失效。
- **修复 AuthorPanelTabs / DefaultConfigPanel 样式问题**：包括左栏会话 tab 滚动、配置项布局、antd notification 降级链路补全。
- **修复外部终端 popover 保存只弹一次提示**：popover 保存逻辑修正。

### 🧹 重构与精简
- **Claude 会话 hook 状态隔离梳理**：把会话级 hook 与全局 hook 拆分，避免 effect 互相污染。
- **拆分仓库文件编辑器 hook 与面板**：文件编辑器相关 hook 与面板组件从 ClaudeChat 中独立成模块。
- **收敛命令面板与文件树弹出层状态隔离**：把命令面板、文件树、消息列表三处弹出层状态统一管理。
- **抽离 ClaudeChat 会话特性面板状态**：状态归属清晰。
- **收敛 diff 模式展开目录状态到 hook**：diff mode 展开目录状态从组件级提升到 hook。
- **收敛 composer 执行态忙碌判定**：从散布在三处的判定集中到一处 helper。
- **收敛常用语面板与默认指令字段展示逻辑**：两处展示入口合并。
- **收敛 markdown 展示源归一化逻辑**：markdown 渲染管线与归一化逻辑抽离成纯函数。
- **收敛终端派发与助手模板激活逻辑**：两处 store 事件合并。
- **收敛助手 UI 事件至 store**：UI 事件源单一来源。
- **移除冗余右栏与检查器模块**：合并到默认配置存储。
- **`tabsStore.normalizePersistedSession` 导出**：外部可显式调用持久化校验；增加 `ultracodeEnabled` boolean 防御。

### 🧪 测试
- **加固流式段落粘连修复的边界与磁盘字节级等价覆盖**：参数化 `looksLikeLongFormChatMarkdown` 多种段落形态，确保磁盘态与流式态字节级等价。
- **补齐 Claude 流与会话 JSONL 装配单测**：覆盖 P0–P9 result 权威对齐 + 缓冲 result 翻倍 + reconcile 多块 disjoint。
- **补齐 Claude 流与会话 JSONL 工具单测**：覆盖工具调用工具名解析、参数边界、错误码。
- **补齐 Monaco Git 变更行装饰 hook 单测**：装饰计算函数纯函数化。
- **补齐多屏槽位工具函数单测**：per-pane 槽位增删改查覆盖。
- **补齐 Claude 会话状态与孤儿 markdown 单测**：orphan markdown 工具函数覆盖。
- **补充 Monaco TS 环境与导入导航单测**：TS 环境模块解析覆盖。
- **补充 composer 区域竞态回归测试**：send 时序加固 + main lane 派发。
- **完善助手模板激活与会话任务目录测试**：模板激活路径 + 任务目录写入。

### 📦 升级说明
- **存储键新增**：`wise.composer.commonPhrasesByRepo.v1`（按 `repositoryId` 分桶）。老用户首次编辑常用语时自动从全局键复制条目到当前仓库，无感升级。
- **`tabs.json` 新增字段**：`ClaudeSession.ultracodeEnabled?: boolean`。`normalizePersistedSession` 对非 boolean 值静默剥除，老数据无影响。
- **Tauri 配置文件**：升级后 desktop bundle 元数据（`productName` / `identifier` 不变，仅 `version` 升级到 `1.3.0`）。
- **无 IPC / Tauri command 改动**：本次 83 条 commit 仅涉及前端；后端依赖 `build_claude_spawn_settings_payload` 顶层键透传，已支持 `ultracode` 字段。
- **手动验证清单**（`bun run tauri:dev`）：
  1. 全局 ultracode=false → 新会话发问 → 流式响应无 chip；
  2. 输入 `/ultracode` → composer 顶部出现紫色 `ultracode` chip；
  3. 输入 `/ultracode 帮我调研 X` → chip 出现 + `<prompt>` 作为用户消息正常发送；
  4. 输入 `/ultracode off` → chip 消失，per-session override 写 false；
  5. 全局 ultracode=true + per-session override=false → 不注入 ultracode（per-session 优先）；
  6. 关闭并重开 app → per-session override 状态从 `tabs.json` 恢复；
  7. 多屏：每个 pane 独立 toggle，互不污染。

## [1.2.1] - 2026-06-30

1.2.1 聚焦语音听写体验收尾与一项 dev 构建回归修复。核心改动包括：**手动模式段尾停顿时长改为弹窗可配（默认 1s）**、**移除录音转需求功能**及其偏好开关，以及修复导致 `Importing a module script failed` 的 4 处 TS 错误（流水线解构未导出字段、未使用变量、`ComposerSpeechEngine` 枚举不匹配比较）。

### ✨ 新功能
- **手动模式段尾停顿可在语音听写弹窗配置**：新增 `manualSegmentIdleMs` 偏好（400–10000ms，步长 100ms，默认 1000ms），与 `silenceAutoSendIdleMs` 解耦——前者表达「一段说完自动 finalize 入框但不发」，后者表达「整段结束并自动发送」。偏好落库到 `wise.composer.speech.v1`，已有用户无感升级，未持久化时按默认值兜底。手动模式下 hover 提示文案同步显示当前段尾停顿秒数。

### 🧹 重构与精简
- **移除录音转需求功能**：删除 `useSpeechToRequirementSync` hook、`prdSpeechToRequirement` 服务与单测，以及 `ClaudeChat` 中相关 scope/调用链。
- **偏好模型精简**：从 `ComposerSpeechPreferencesV1` 移除 `speechToRequirementEnabled` 字段；`normalizeComposerSpeechPreferences` 不再读写该字段。
- **语音听写弹窗 UI 精简**：移除对应的「录音转需求」开关区块。

### 🐛 问题修复
- **修复 dev/build 阶段 `Importing a module script failed`**：根因为 4 处 TypeScript 错误导致 Vite 转译 chunk 失败。
  - `composer-region.tsx` 解构了 `useComposerSpeechPipeline` 不再导出的 `setAudioLevelSink`，改用 `speechDictation.setAudioLevelSink` 注入到 `useComposerSpeechLevelMeter`，恢复电平柱条动效。
  - `ComposerVoiceDictationBubble.tsx` 删除未被引用的旧函数 `nextBarTargets`。
  - `ClaudeChat.tsx` 清理上一轮删 `useSpeechToRequirementSync` 时残留的未消费 `speechPrefs` 与对应 `useComposerSpeechPreferences` import。
  - `useComposerSpeechDictation.ts` 把与 `ComposerSpeechEngine = "sensevoice" | "web"` 类型无交集的 `=== "webspeech"` 比较改为 `=== "web"`。

### 🧪 测试
- `composerSpeechPreferences.test.ts` 同步移除 `speechToRequirementEnabled` 相关断言，新增 `manualSegmentIdleMs` clamp + step 用例。
- `composerSpeechSilenceIdle.test.ts` 与 `composerSpeechSegmentIdle.test.ts` 补齐自定义 `idleMs` 与格式化函数的覆盖。

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
