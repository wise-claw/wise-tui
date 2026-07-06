# 多屏：展开右侧面板按钮移到最右列 pane

## 背景

当前「展开右侧面板」按钮（`Topbar.tsx:627-698`，渲染条件 `onToggleRightPanel && (...)`）的渲染策略：

- **单屏**（`paneCount===1`）：走 `AppWorkspaceLayout.tsx:1671` 的全局 `LazyTopbar`，按钮在窗口级顶栏。**本次不改，维持现状。**
- **多屏**：走 `ClaudeMultiPaneGrid`。primary pane（pane 0，左上 `(0,0)`）通过 `{...shared.paneTopbarShared}` 全量展开 → 按钮渲染；所有 extra pane 在 `ClaudeMultiPaneGrid.tsx:590` 显式 `onToggleRightPanel={undefined}` → 按钮不渲染。

**问题**：多屏时按钮在左上 primary pane，离窗口右侧的面板 rail 太远，操作不直觉。

## 目标

多屏时按钮从 primary pane 移走，改放在**最右列的所有 extra pane**顶栏上（最右列每格都紧邻右侧面板 rail，都能操作；同一全局 `rightCollapsed` 状态，按钮多处但行为一致）。单屏不变。

## 「最右列」判定公式

grid 维度来自 `paneGridDimensions(count)`（`mainLayoutWidths.ts:196`）：2→1×2, 4→2×2, 6→2×3, 8→2×4。

pane 在 grid 中的 cell index：primary=0，extra pane i（`paneIdx=i`）= `i+1`。按行填充时列号 = `cellIndex % cols`。最右列 = `col === cols - 1`，即：

```ts
const { cols } = paneGridDimensions(paneCount);
const isRightmostColumn = (paneIdx + 1) % cols === cols - 1;
```

各屏数下命中（已验证）：

| paneCount | cols | 命中的 extra paneIdx | 位置 |
|-----------|------|----------------------|------|
| 2 | 2 | 0 | 右 |
| 4 | 2 | 0, 2 | 右上 + 右下 |
| 6 | 3 | 1, 4 | 右上 + 右下 |
| 8 | 4 | 2, 6 | 右上 + 右下 |

primary pane 永远在 `(0,0)`，多屏时永远不在最右列 → 多屏时 primary 不渲染按钮。

## 改动（仅 `ClaudeMultiPaneGrid.tsx` + `Topbar.tsx` 注释）

### 改动 1 — `MultiPanePrimaryPane` 多屏时移除按钮

1. `MultiPanePrimaryPaneProps`（`ClaudeMultiPaneGrid.tsx:240-249`）新增 `paneCount: PaneCount;`（`PaneCount` 已于 line 30 导入）。
2. 函数签名（line 251-260）解构 `paneCount`。
3. Topbar 渲染（line 287-299）：当 `paneCount > 1` 时覆盖 `onToggleRightPanel={undefined}` 与 `onSetRightPanelDefaultCollapsed={undefined}`，使按钮在 primary 不渲染。`paneCount === 1` 时保留（与现状一致；单屏实际走全局 Topbar，此处为防御性保留）。
4. 主渲染处（line 1057-1068）给 `<MultiPanePrimaryPane>` 传 `paneCount={paneCount}`。

### 改动 2 — `MultiPaneExtraPaneCell` 最右列保留按钮

1. 组件内 `resolvedRepo` 之后（line 450 附近）计算：
   ```ts
   const { cols } = paneGridDimensions(paneCount);
   const isRightmostColumn = (paneIdx + 1) % cols === cols - 1;
   ```
   （`paneGridDimensions` 已于 line 30 导入；`paneIdx` / `paneCount` 已是 props。）
2. Topbar 渲染（line 583-603）把原来的无条件覆盖改为条件化：
   ```tsx
   // 最右列 pane 紧邻右侧面板，保留右侧面板按钮；其余 extra pane 不渲染窗口级按钮。
   onToggleRightPanel={isRightmostColumn ? shared.paneTopbarShared?.onToggleRightPanel : undefined}
   onSetRightPanelDefaultCollapsed={
     isRightmostColumn ? shared.paneTopbarShared?.onSetRightPanelDefaultCollapsed : undefined
   }
   ```
   其余 5 个窗口级回调（`onToggleSidebar` / `onToggleTerminal` / `onChangePaneCount` / `onOpenRemoteChannels`）保持 `undefined` 不变。
3. 更新 line 585-586 注释，说明最右列例外。

最右列 extra pane 通过 `{...shared.paneTopbarShared}` 展开，自然拿到 `rightCollapsed` / `rightPanelDefaultCollapsed` / `onToggleRightPanel` / `onSetRightPanelDefaultCollapsed`，按钮图标、文案、右键「启动默认收起」popover 全部正常工作。

### 改动 3 — 更新 `PaneTopbarSharedProps` 类型注释（`Topbar.tsx:214-238`）

语义已变：多屏下 primary 不再渲染右侧面板按钮，改由最右列 extra pane 渲染。更新该 type 上方注释的第 220-222 行描述。

## 不改的部分

- 单屏全局 Topbar 路径（`AppWorkspaceLayout.tsx:1671`）—— 单屏按钮位置不变。
- `rightCollapsed` / `rightPanelDefaultCollapsed` 状态来源（`useMainLayoutModes.ts` + `paneTopbarShared` 组装 `AppWorkspaceLayout.tsx:911-946`）—— 仍是全局单一状态，多处按钮行为一致。
- 右侧面板 rail DOM（`AppWorkspaceLayout.tsx:1705-1749`）—— 窗口级，不受按钮位置影响。
- 其他窗口级按钮（侧栏 / 终端 / 多屏切换 / RemoteEntry）的渲染策略不变。

## 验证

- `bun test`（确认无回归；该文件无单元测试，主要靠类型 + 静态检查）。
- `bunx tsc --noEmit`（或项目既有类型检查命令）确认类型无误。
- 手动验证（用户侧）：2/4/6/8 屏下按钮出现在最右列 pane 顶栏，primary 与中间列不出现；单屏按钮仍在全局顶栏。
