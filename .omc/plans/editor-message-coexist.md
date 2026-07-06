# 文件打开时消息列表与编辑器共存

## 目标
会话列表打开文件后，无需关闭文件即可查看消息列表。两者上下分屏（消息在上、编辑器在下），中间可拖拽调整高度，编辑器可折叠为标签栏。

## 根因
`AppWorkspaceLayout.tsx:506-520` 的 `resolvePaneAuxLayout`：当 pane 挂了文件编辑器节点（`centerAuxPanelsNodeByPane.get(paneIndex)` 非空）时，硬编码返回 `hideMessages: true`，导致 `ClaudeChat.tsx:1648` 的 `ClaudeChatMessagesLiveHost` 不渲染，编辑器独占主区。

布局基础已就绪：`.app-claude-chat-main` 是 `flex-direction: column`，`.app-claude-messages` 与 `.app-file-editor-panel` 本就是上下 flex 子项，共存只需放开 `hideMessages` 并用 Splitter 管理高度比例。

## 改动点

### 1. 放开消息隐藏（核心）
**`src/components/AppWorkspaceLayout.tsx:506-520`** `resolvePaneAuxLayout`
- 编辑器节点存在时：`hideMessages: false`、`hideSessionTools: false`（恢复消息列表、owner bar、顶部工具栏），`panelBelowMessages` 仍注入。
- 未挂编辑器时维持 `{ hideMessages: false, hideSessionTools: false }`。

性能护栏保留：`ClaudeMultiPaneGrid.tsx:490` `hidePaneMessages = paneAuxLayout.hideMessages || deferHeavySubtree` 不变；离屏 pane 仍由 `deferHeavySubtree` 隐藏消息。`hideSessionTools` 在 `ClaudeChat.tsx:1627` 已有 `&& !deferHeavySubtree` 守卫。

### 2. Splitter 共存布局
**`src/components/ClaudeSessions/ClaudeChat.tsx:1644-1667`**
- 新增 `hasEditor = Boolean(panelBelowMessages)`。
- 当 `hasEditor && !hideMessages`：用 antd `Splitter`（`orientation="vertical"`）包裹消息列表 + 编辑器：
  - 消息 Panel：`defaultSize` 从持久化恢复或 `"60%"`，`min="15%"`。
  - 编辑器 Panel：`defaultSize` 从持久化恢复或 `"40%"`，`min={EDITOR_TAB_BAR_H}`（约 36px，tab 栏高度），`collapsible`（折叠为标签栏）。
- 否则维持原渲染：无编辑器时消息全屏；离屏（`hideMessages`）时编辑器独占、消息不渲染。
- `hideMessagesScroll`（1652 行）维持 `hideMessages || deferHeavySubtree`，共存时为 `false`，消息正常滚动。

### 3. 持久化（按 paneIndex）
- localStorage key：`wise.chat.editorSplit.${paneIndex}.v1`，值 `{ editorSizePct: number; collapsed: boolean }`。
- `onResizeEnd` → 持久化 `editorSizePct`；`onCollapse` → 持久化 `collapsed`。
- 初始 `defaultSize`/折叠态从 localStorage 恢复；`paneIndex` 已在 ClaudeChat props（405 行）可用。
- 读写封装为小 helper（纯函数 + try/catch），与 `composerCommonPhrasesStore` 风格一致。

### 4. CSS
**`src/components/ClaudeSessions/index.css`**
- 新增 `.app-claude-chat-splitter`：`flex: 1 1 0; min-height: 0; min-width: 0; display: flex;`（Splitter 根占满 `app-claude-chat-main` 上方）。
- Splitter 内 Panel 已含 `.app-claude-messages`/`.app-file-editor-panel`（均 `flex:1 1 0; min-height:0`），高度自适应。
- 折叠态：编辑器 Panel size = `min`（tab 栏高度），`.app-file-editor-body` 高度自然为 0，只显示 tab 栏。
- 分割条视觉：沿用 antd 默认或轻量定制（高度、hover 色），与 `.app-color-split` 一致。

## 不改的
- ViewMode 状态机（无关）。
- `deferHeavySubtree` 离屏性能护栏。
- `RepositoryFileEditorPanel` 内部逻辑（tab 栏、keep-alive、快捷键）。
- `PendingTaskQueue`/`NotificationDock` 位置（仍在 Splitter 之后、`app-claude-chat-bottom` 之前，`margin-top:auto` 维持底部）。
- `PaneEditorPanelBridge` / `centerAuxPanelsNodeByPane` 桥接机制。

## 风险与实现时确认
1. **antd Splitter `collapsible` 折叠目标**：确认折叠后面板 size = `min`（=36px，保留 tab 栏）。若折叠到 0，改用受控 `size`（折叠时 size=36）+ 自定义按钮。
2. **Splitter DOM 包裹对消息虚拟滚动的影响**：消息列表靠 ResizeObserver 驱动 windowing，Panel 尺寸变化会触发；需实测拖拽时滚动/贴底跟随正常。
3. **Monaco resize 适应**：编辑器已有 ResizeObserver，Splitter 拖拽时实时 layout；`lazy` 默认 false 保实时反馈，若卡顿再调。
4. **离屏 pane 性能不回归**：`deferHeavySubtree` 时 Splitter 不渲染，走原分支。

## 验证
- `bun test`：确保无既有测试回归（排除 main 已知失败）。
- 手动场景：
  - 单 pane 打开文件 → 消息上、编辑器下，两者可见。
  - 拖拽分割条 → 比例调整，持久化。
  - 折叠编辑器 → 只留 tab 栏，消息占满；展开恢复。
  - 多 pane 各 pane 独立折叠/尺寸。
  - 离屏 pane 不渲染消息（性能）。
  - 关闭全部文件 → 消息列表恢复全屏。
  - 消息列表滚动、贴底跟随、windowing 正常。

## 提交
`feat: 文件打开时消息列表与编辑器上下分屏共存，支持拖拽与折叠`
