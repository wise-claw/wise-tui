# 多屏 per-pane 顶栏：每个屏显示完整右侧按钮并独立操作各自仓库

## 背景与现状

用户需求：开多屏时，单屏顶部右侧的「打开文件 / 打开终端 / 打开 IDE / 搜索」等所有按钮需要**在每个屏都显示**，且每个屏独立操作**各自仓库**。

探索发现两个核心问题：

1. **main 分支编译失败（14 个 tsc 错误）**：`AppWorkspaceLayout.tsx` 引用了不存在的 `./ClaudeSessions/PaneLocalHeader` 模块（3 处 TS2307），`ClaudeSessionsProps` 未从 `index.tsx` 导出（TS2724），外加几处 implicit any。这是之前「顶栏合并到 PaneLocalHeader」重构半途而废留下的——`PaneLocalHeader.tsx` 文件从未创建（`git log --all -- "*PaneLocalHeader*"` 为空）。
2. **多屏下顶栏完全消失**：
   - 全局 Topbar 只在 `paneCount===1` 时渲染（`AppWorkspaceLayout.tsx:1535`）。
   - `ClaudeSessions` 内部 Topbar 被 `hideTopbar={true}` 永久隐藏（`AppWorkspaceLayout.tsx:505`）。
   - `ClaudeMultiPaneGrid` 的 `MultiPanePrimaryPane`/`MultiPaneExtraPaneCell` 只渲染 `ClaudeSessionChatWithDock`，无任何顶栏。
   - 因此多屏时 Finder/外部终端/IDE/搜索/运行等按钮全部消失。

死代码：`paneLocalButtonsSlot`/`rightPanelToggleSlot`（AppWorkspaceLayout:793/828）注入到 `topbarProps`，但 `TopbarProps`（Topbar.tsx:167-205）根本没有这两个字段——Topbar 自身已内化运行/外部终端/OpenAppMenu/FCC/多屏切换/右栏按钮。`paneHeaderSharedProps`（AppWorkspaceLayout:892）组装后注入 `claudeSessionsPropsWithHeader`，但 `ClaudeSessionsProps` 类型无此字段、`MultiPaneSharedChatProps` 也无、无人消费。

已确认的基础能力：
- `openFilenameSearchPalette(scopeDir?)`（AppImpl.tsx:3218）支持指定目录 → per-pane 搜索可传 pane 仓库路径。
- 每个 pane 的仓库已由 `resolvedPaneRepositories[paneIdx]` 解析，`ClaudeSessionChatWithDock` 已拿到 pane 自己的 `activeRepository`（ClaudeMultiPaneGrid:531 `activeRepository={resolvedRepo}`）。
- Topbar 的窗口级按钮均为 `onXxx && (...)` 条件渲染，不传 prop 即不渲染 → extra pane 传精简 props 即可只显示仓库级按钮。

用户决策：
- 窗口级按钮（收起侧栏 / 内置终端 / 多屏切换 / 右侧面板）**只在第一屏显示**。
- 仓库级按钮（Finder / 外部终端 / IDE / 搜索 / 运行 / FCC 等）**每个屏显示**，作用于各自仓库。
- **复用现有 Topbar 组件**（不新建 PaneLocalHeader）。

## 方案总览

复用 `Topbar` 组件，在 `ClaudeMultiPaneGrid` 的每个 pane 内、`<ClaudeSessionChatWithDock>` 上方渲染一个 per-pane Topbar：
- primary pane：传完整 props（含窗口级按钮回调）。
- extra pane：传精简 props（不传窗口级回调），`activeRepository` 用 pane 自己的 `resolvedRepo`，`onSearch` 传 `() => openFilenameSearchPalette(resolvedRepo.path)`。

打通 `paneTopbarShared`（原 `paneHeaderSharedProps` 改名+改类型）透传链：`AppWorkspaceLayout` → `ClaudeSessionsProps` → `ClaudeSessionsChatHost` → `MultiPaneSharedChatProps` → 两个 pane 组件。

## 阶段 0：修复编译错误

目标：`bunx tsc --noEmit -p tsconfig.app.json` 0 错误。

1. **`src/components/ClaudeSessions/index.tsx`**
   - 导出 Props 类型：把 `interface Props`（line 48）改为 `export interface ClaudeSessionsProps`（同步更新内部引用名），或新增 `export type ClaudeSessionsProps = Props`。
   - 在 Props 上新增可选字段 `paneTopbarShared?: PaneTopbarSharedProps`（类型从 Topbar.tsx 导入）。

2. **`src/components/ClaudeSessions/Topbar.tsx`**
   - 新增并导出 `PaneTopbarSharedProps` 类型：承载 per-pane Topbar 共享字段（窗口级回调 + 会话级回调 + 全局状态），即从 AppWorkspaceLayout:892-915 原 `paneHeaderSharedProps` 列出的字段集，去掉 per-pane 的 `activeRepository`/`activeSessionRepositoryPath`/`mainSessionForDataLink`（这些每 pane 各自提供）。

3. **`src/components/AppWorkspaceLayout.tsx`**
   - 删除 line 30 `import type { PaneLocalHeaderSharedProps } from "./ClaudeSessions/PaneLocalHeader"`。
   - 删除 line 85-90 `LazyPaneLocalButtons`/`LazyRightPanelToggleButton`（引用不存在的 PaneLocalHeader）。
   - 删除 `paneLocalButtonsSlot`（793-825）与 `rightPanelToggleSlot`（828-846）两个 useMemo（死代码，TopbarProps 无对应字段）。
   - 从 `topbarProps`（852-885）移除 `paneLocalButtonsSlot`/`rightPanelToggleSlot` 字段及依赖。
   - `paneHeaderSharedProps` useMemo（892-930）改名为 `paneTopbarShared`，类型改为 `PaneTopbarSharedProps`（从 Topbar.tsx 导入），字段不变。
   - `claudeSessionsPropsWithHeader`（934-940）注入 `paneTopbarShared` 替代 `paneHeaderSharedProps`。
   - 修 implicit any：line 1098 `r`、1104 `s`、1352 `repo`、1357 `s`、1361 `repo` 补类型注解。

4. **`src/AppImpl.tsx`**
   - 修 implicit any：line 4004 `repository`、4007 `project`、4067 `taskId` 补类型注解。

## 阶段 1：per-pane 顶栏透传与渲染

1. **`src/components/ClaudeSessions/ClaudeMultiPaneGrid.tsx`**
   - `MultiPaneSharedChatProps`（118-212）新增字段 `paneTopbarShared: PaneTopbarSharedProps`。
   - `MultiPanePrimaryPane`（225-346）：在 `<div className="app-claude-sessions__pane">` 内、`<ClaudeSessionChatWithDock>` 上方渲染 `<Topbar>`，传完整 props：
     - `activeRepository={activeRepository}`、`activeSessionRepositoryPath={session.repositoryPath}`、`mainSessionForDataLink={session}`
     - 窗口级回调从 `shared.paneTopbarShared` 取（onToggleSidebar/onToggleTerminal/onChangePaneCount/onToggleRightPanel 等）
     - `onSearch={() => shared.paneTopbarShared.onSearchForRepository(activeRepository.path)}`
     - 会话级回调（onSessionInsightsAiAnalysis/onDispatchSessionFeedbackLoop/getClaudeSessions/onAutoFixRunError）从 `shared.paneTopbarShared` 取
   - `MultiPaneExtraPaneCell`（378-787）：在 `<div className="app-claude-sessions__pane">` 内、`<ClaudeSessionChatWithDock>` 上方渲染 `<Topbar>`，传精简 props：
     - `activeRepository={resolvedRepo}`、`activeSessionRepositoryPath={paneSession?.repositoryPath}`、`mainSessionForDataLink={paneSession ?? null}`
     - **不传**窗口级回调（onToggleSidebar/onToggleTerminal/onChangePaneCount/onToggleRightPanel）→ 这些按钮自动不渲染
     - `repositories={shared.repositories}`、`activeWorkspaceFocus="repository"`（不传 activeProject，让 Topbar 用 repo 路径）
     - `onSearch={() => shared.paneTopbarShared.onSearchForRepository(resolvedRepo.path)}`
     - 会话级回调从 `shared.paneTopbarShared` 取（若 `paneSession` 为 null 则相应 trigger 不启用）
   - memo 比较函数（338-346、769-787）补 `prev.shared.paneTopbarShared === next.shared.paneTopbarShared`（其实 `shared` 整体比较已覆盖，确认即可）。
   - 用 `lazy(() => import("./Topbar").then(m => ({default: m.Topbar})))` 包一层，避免 primary/extra 同步引入 Topbar 全部依赖（Topbar 已是 memo + 内部 lazy trigger）。

2. **`src/components/ClaudeSessions/ClaudeSessionsChatHost.tsx`**
   - `multiPaneSharedChatRef.current`（508）组装时填入 `paneTopbarShared`（从 Props 解构的 `paneTopbarShared`）。

3. **`src/components/ClaudeSessions/index.tsx`**
   - `ClaudeSessionsShell` 解构 `paneTopbarShared`，透传给 `ClaudeSessionsChatHost`。
   - `claudeSessionsShellPropsEqual` 确认 `paneTopbarShared` 引用稳定（AppWorkspaceLayout 单源 useMemo，已稳定）。

4. **`src/components/AppWorkspaceLayout.tsx`**
   - `paneTopbarShared` useMemo 增补 `onSearchForRepository: (path: string) => openFilenameSearchPalette(path)` 字段（需把 `openFilenameSearchPalette` 从 AppImpl 透传到 AppWorkspaceLayout，或经 claudeSessionsProps 下沉；优先复用现有 onSearch 透传路径，新增 `onSearchForRepository` 回调）。
   - 类型 `PaneTopbarSharedProps` 加 `onSearchForRepository: (repositoryPath: string) => void`。

5. **`src/AppImpl.tsx`**
   - 把 `openFilenameSearchPalette`（或包装的 `onSearchForRepository`）注入 `claudeSessionsProps`，经 AppWorkspaceLayout 到 `paneTopbarShared`。

## 阶段 2：验证

1. `node_modules/.bin/tsc --noEmit -p tsconfig.app.json` → 0 错误。
2. `bun test` → 通过（排除记忆 test-baseline-failures 记录的 9 个既有失败）。
3. 静态确认（不启动 dev server，遵守项目规则）：
   - 1 屏路径不变（全局 Topbar 仍渲染，hideTopbar=true 不变）。
   - 多屏路径：primary pane 顶栏含窗口级+仓库级按钮；extra pane 顶栏只含仓库级按钮，`activeRepository` 为 pane 自己的 `resolvedRepo`，搜索按钮调 `openFilenameSearchPalette(resolvedRepo.path)`。
   - `paneTopbarShared` 引用稳定，不破坏 `ClaudeMultiPaneGrid` 现有 memo。

## 风险与回归

- **memo 性能**：每 pane 多一个 Topbar 实例。Topbar 是 `memo` + `topbarPropsEqual`，且内部 trigger 多为 lazy。extra pane 的 Topbar 仅在 `resolvedRepo`/`paneSession` 变化时重渲，可接受。
- **会话级 trigger**：extra pane 的 SessionDataLink/FeedbackLoop 会以 `paneSession` 为 mainSession。若 `paneSession` 为 null（pane 未创建会话），`topbarToolsReady` 仍可由 `resolvedRepo.path` 启用仓库级按钮，会话级 trigger 内部自处理 null。
- **1 屏回归**：1 屏路径完全不动（仍走 `ClaudeSessionChatWithDockLazy` + 全局 Topbar），无影响。
- **多屏搜索路由**：per-pane 搜索传 `scopeDir=resolvedRepo.path`，命中已有的 `searchRepositoryPathOverride`/`repositoryFileOpenRequest` 路由机制（记忆 multipane-pane1-search-fallback），文件编辑器落到对应 pane。
- **窗口级按钮只在 primary**：extra pane 不传窗口级回调，Topbar 自动不渲染这些按钮，无需改 Topbar 内部逻辑。
