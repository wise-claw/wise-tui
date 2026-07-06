# 消息/文件 tab 移到顶栏收起侧边栏图标右侧

## 目标
把当前在「中栏主区内部顶部居中」的「消息 / 文件」Segmented 切换器，移到顶栏（Topbar）里「收起侧边栏」图标的右边。切换器仅在有文件编辑器时出现，行为不变（当前视图占满主区，互斥显示，打开首个文件默认切到「文件」，关闭全部文件切回「消息」）。

## 根因
切换器当前由 `ClaudeChat.tsx:416-426` 的内部 `useState<CenterView>` + effect 驱动，并在 `ClaudeChat.tsx:1663-1675` 的 `app-claude-chat-center-switcher` 内渲染。Topbar 与 ClaudeChat 是兄弟组件（单屏：`index.tsx` 664 vs 701；多屏：`ClaudeMultiPaneGrid` 的 pane 容器内 281/569 vs 292/588），Topbar 无法访问 ClaudeChat 内部状态。因此需要把 `centerView` 状态提升到 per-pane 容器层，由 Topbar 与 ClaudeChat 共享。

附带收益：状态提升到 per-pane 容器后不再随 ClaudeChat 子树瞬时卸载而丢失（见 [[panelbelowmessages-remount-trap]]），比当前内部 useState 更稳健。

## 方案：状态提升 + props 透传 + hook 封装

### 0. 新增 hook（`src/components/ClaudeSessions/claudeChatHelpers.ts`）
- 导出 `type CenterView = "messages" | "files"`（从 ClaudeChat.tsx 迁出，避免循环依赖）。
- 导出 `useCenterView(panelBelowMessages: ReactNode | undefined)`：
  - `useState<CenterView>("messages")`。
  - `useEffect(() => setCenterView(panelBelowMessages ? "files" : "messages"), [panelBelowMessages])`（与现有逻辑一致；panelBelowMessages identity 仅在 editorVisible 翻转时变化，同 pane 内切换文件不打断当前视图）。
  - `onCenterViewChange = useCallback((v) => setCenterView(v), [])`（稳定引用，配合 memo skipFunctions）。
  - 返回 `{ centerView, onCenterViewChange }`。

### 1. `src/components/ClaudeSessions/ClaudeChat.tsx`（改受控）
- Props 新增必填：`centerView: CenterView`、`onCenterViewChange: (v: CenterView) => void`。
- 移除：内部 `centerView` useState + effect（416-426）、`CenterView` 类型定义（迁到 helper）、主区内 `app-claude-chat-center-switcher` Segmented 渲染（1663-1675）。
- 保留：`app-claude-chat-center-pane` 互斥显隐逻辑，改用 `props.centerView` 判定（1668/1678/1688/1707 处的 `centerView` 引用改为 props）。
- `ClaudeSessionChatWithDock` 用 `ComponentProps<typeof ClaudeChat>` + `{...props}` 透传，新增 props 自动透传，无需改该文件。

### 2. `src/components/ClaudeSessions/Topbar.tsx`（渲染切换器）
- Props 新增可选：`centerView?: CenterView`、`onCenterViewChange?: (v: CenterView) => void`、`showCenterSwitch?: boolean`。
- `import { Segmented } from "antd"`。
- 在收起侧边栏按钮（326-332 `IconCollapseSidebar`）之后、`app-topbar-divider`（335）之前，插入：
  ```tsx
  {showCenterSwitch && onCenterViewChange && centerView ? (
    <Segmented
      size="small"
      value={centerView}
      onChange={(v) => onCenterViewChange(v as CenterView)}
      options={[{ label: "消息", value: "messages" }, { label: "文件", value: "files" }]}
    />
  ) : null}
  ```
- 用 `import type { CenterView } from "./claudeChatHelpers"`。

### 3. `src/components/ClaudeSessions/index.tsx`（单屏状态持有 + 透传）
- `ClaudeSessionsShell` 内调 `const { centerView, onCenterViewChange } = useCenterView(panelBelowMessages)`（panelBelowMessages 已是 326 行的 prop）。
- 传给 Topbar（664）：`centerView`、`onCenterViewChange`、`showCenterSwitch={panelBelowMessages != null}`。
- 传给 ClaudeSessionsChatHost（701）：`centerView`、`onCenterViewChange`。

### 4. `src/components/ClaudeSessions/ClaudeSessionsChatHost.tsx`（单屏路径透传）
- `ClaudeSessionsChatHostProps` 新增 `centerView`、`onCenterViewChange`。
- 单屏路径（642 `ClaudeSessionChatWithDockLazy`）透传这两项。
- 多屏路径（615 `ClaudeMultiPaneGridLazy`）**不传** —— 多屏各 pane 在 ClaudeMultiPaneGrid 内自持状态。
- `claudeSessionsChatHostPropsEqual` 无需改：末尾 `arePropsEqualSkipping` 兜底浅比较，`centerView`（字符串）不在 skipKeys，值变化正确穿透；`onCenterViewChange` 是函数被 skipFunctions 跳过，但 `centerView` 值变化已足够触发重渲染。

### 5. `src/components/ClaudeSessions/ClaudeMultiPaneGrid.tsx`（多屏 per-pane 状态）
- `MultiPanePrimaryPane`（250）：调 `useCenterView(paneAuxLayout.panelBelowMessages)`；传给 Topbar（281）与 ClaudeSessionChatWithDock（292）。
- `MultiPaneExtraPaneCell`（415）：同上；正常渲染分支（566-587）传给 Topbar（568）与 ClaudeSessionChatWithDock（588）。
  - lazy 占位分支（551-564）与 file-only 分支（678-686）不渲染 Topbar/ClaudeChat，无需传；实现时确认 file-only 分支是否需要切换器（纯文件 pane 无消息，预期不需要）。

### 6. `src/components/ClaudeSessions/index.css`
- 移除 `.app-claude-chat-center-switcher`（1702 附近，不再使用）。
- 新增顶栏切换器样式：`.app-chat-topbar-leading-cluster .ant-segmented` 的小幅间距（如 `margin-left: 8px`），或新增 `.app-topbar-center-switch` 包裹类。视觉与现有 `app-topbar-btn` 对齐，避免与右侧仓库名 divider 挤压。

## 不改的
- 视图互斥显隐机制（`app-claude-chat-center-pane` + `is-hidden`）。
- `deferHeavySubtree` 离屏性能护栏、`hideMessagesScroll` 逻辑。
- ViewMode 状态机、`PaneEditorPanelBridge` / `centerAuxPanelsNodeByPane` 桥接。
- 三个 memo 比较函数（`topbarPropsEqual` / `claudeSessionsChatHostPropsEqual` / `claudeChatPropsEqual`）—— 均用 `arePropsEqualSkipping` 兜底，新增非函数 props 自动覆盖。
- `panelBelowMessages` 数据流（AppWorkspaceLayout → ClaudeSessionsShell → ChatHost → grid/ClaudeChat）。

## 风险与实现时确认
1. **file-only pane 分支**（ClaudeMultiPaneGrid 678-686）：确认该分支是否渲染 Topbar；若渲染且无消息视图，`showCenterSwitch` 应为 false 或不显示切换器。
2. **Topbar memo 与 Segmented 交互**：`topbarPropsEqual` skipFunctions 跳过 `onCenterViewChange`，但 `centerView` 值变化触发重渲染，Segmented 受控 value 更新正常。点击切换 → `onCenterViewChange`（稳定引用）→ setCenterView → index.tsx/grid 重渲染 → Topbar 收到新 `centerView`。闭环验证。
3. **多屏 per-pane 隔离**：`MultiPanePrimaryPane` 与 `MultiPaneExtraPaneCell` 是独立 memo 组件，各自 `useCenterView` 独立状态，不串扰。
4. **单屏切换器出现时机**：`showCenterSwitch = panelBelowMessages != null`，与「有编辑器才显示切换器」一致。

## 验证
- `bun test`：无既有测试回归（排除 main 已知 9 个失败，见 [[test-baseline-failures]]）。
- 手动：
  - 单屏打开文件 → 顶栏收起侧边栏图标右侧出现「消息/文件」切换器；切换 → 主区视图切换；主区内部不再有切换器。
  - 打开首个文件默认切到「文件」；关闭全部文件 → 切换器消失，消息列表恢复全屏。
  - 多屏各 pane 独立切换器、独立视图。
  - 离屏 pane（lazy 占位）不渲染切换器；性能护栏不回归。
  - 消息列表滚动、贴底跟随、windowing 正常。

## 提交
`feat: 消息/文件视图切换器移至顶栏收起侧边栏图标右侧`
