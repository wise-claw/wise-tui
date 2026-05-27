# Design: 中栏多屏模式（2/4/6/8屏）

## 数据模型

### 当前（布尔 + 标量）

```typescript
// AppImpl.tsx
dualPaneEnabled: boolean;
dualPaneSecondarySessionId: string | null;
dualPaneSecondaryRepositoryId: number | null;
```

### 目标（计数 + 数组）

```typescript
// AppImpl.tsx — 新状态
type PaneCount = 1 | 2 | 4 | 6 | 8;

interface PaneSlot {
  /** 唯一槽位 id，用于 React key 和稳定引用 */
  slotId: string;
  /** 该窗格绑定的 session id；null 表示空屏 */
  sessionId: string | null;
  /** 该窗格绑定的 repository id；null 表示未选择 */
  repositoryId: number | null;
}

paneCount: PaneCount;                          // 默认 1（关闭）
extraPanes: PaneSlot[];                        // 长度 = paneCount - 1
```

**Pane 0（主窗格）** 始终是 `activeSession`，不存入 `extraPanes`。
Pane 1..N-1 对应 `extraPanes[0..N-2]`。

### 网格维度计算

```typescript
function paneGridDimensions(count: PaneCount): { rows: number; cols: number } {
  if (count <= 2) return { rows: 1, cols: count };
  return { rows: 2, cols: count / 2 };
}
// 2→1×2, 4→2×2, 6→2×3, 8→2×4
```

## 文件修改范围

### 1. `src/constants/mainLayoutWidths.ts`

新增多栏宽度计算函数，替换硬编码的 `* 2`：

```typescript
/** 多栏模式下每列最小宽度（与 CSS --app-multi-pane-min-width 一致） */
export const MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX = 460;
export const MAIN_LAYOUT_MULTI_PANE_DIVIDER_PX = 1;

export function paneGridDimensions(count: PaneCount): { rows: number; cols: number } {
  if (count <= 2) return { rows: 1, cols: count };
  return { rows: 2, cols: count / 2 };
}

export function computeMinLogicalCenterWidthForPaneCount(count: PaneCount): number {
  const { cols } = paneGridDimensions(count);
  return MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX * cols + MAIN_LAYOUT_MULTI_PANE_DIVIDER_PX * (cols - 1);
}

export function computeMultiPaneTargetCenterLogical(
  count: PaneCount,
  centerBeforeLogical: number,
): number {
  const minTotal = computeMinLogicalCenterWidthForPaneCount(count);
  return Math.max(minTotal, centerBeforeLogical);
}
```

保留旧函数名 `computeMinLogicalCenterWidthForDualPane` / `computeDualPaneTargetCenterLogical` 作为 `count=2` 的别名，避免大范围重命名。

### 2. `src/services/mainWindowLayout.ts`

- `expandMainWindowByDualPaneCenterDelta` → 泛化为 `expandMainWindowForPaneCount(count, centerBefore, options)`。
- `shrinkMainWindowByDualPaneDelta` → 保持不变（仅接收 delta 值）。
- 新增 `computeWindowDeltaForPaneCount` 辅助。

### 3. `src/hooks/useMainLayoutModes.ts`

重构为多窗格管理：

- `handleToggleDualPane` → `handleChangePaneCount(count: PaneCount)`
- 维护 `extraPanes` 数组：增加屏数时追加空槽位，减少屏数时截断多余槽位。
- 窗口 resize 逻辑改为基于 `paneGridDimensions(count).cols` 计算 delta。
- `handleDualPaneSecondaryRepositorySelect` → `handlePaneRepositorySelect(slotIndex: number, repositoryId: number)`。
- `handleNewSecondarySession` → `handleNewPaneSession(slotIndex: number, repository: Repository)`。
- Alt+K 快捷键改为循环 `1→2→4→6→8→1`。
- 全局事件 `global-toggle-dual-pane` 改名为 `global-cycle-multi-pane`（保留旧事件名兼容）。

### 4. `src/AppImpl.tsx`

- 替换三个 dualPane 状态为 `paneCount` + `extraPanes`。
- 向 `ClaudeSessions` 传递新 props：`paneCount`, `extraPanes`, `onChangePaneCount`, `onPaneRepositorySelect`, `onNewPaneSession`。
- 传递 `paneCount` 到 `useClaudeSessions` 的 `companionSessionIds`（复数）。

### 5. `src/components/ClaudeSessions/index.tsx`

**Topbar**：
- 原 `TopbarBtn` 替换为 Ant Design `Dropdown`，菜单项为 `[{label: "1屏（关闭）", key: "1"}, {label: "2屏", key: "2"}, ...]`。
- 当前选中项显示 ✓。
- 按钮图标复用 `IconDualPane` 或新增 `IconMultiPane`。

**渲染区**：
- 将 `dualPaneEnabled ? (...) : (...)` 二元分支改为网格渲染：

```tsx
{paneCount > 1 ? (
  <div
    className="app-claude-sessions__multi-panes"
    style={{
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: rows > 1 ? `repeat(${rows}, 1fr)` : undefined,
    }}
  >
    {/* Pane 0: active session */}
    <div className="app-claude-sessions__pane">
      <ClaudeSessionChatWithDock session={activeSession} ... />
    </div>
    {/* Pane 1..N-1 */}
    {extraPanes.map((slot, i) => (
      <React.Fragment key={slot.slotId}>
        <div className="app-claude-sessions__pane-divider" aria-hidden />
        <div className="app-claude-sessions__pane">
          {resolvePaneSession(slot) ? (
            <ClaudeSessionChatWithDock session={resolvePaneSession(slot)} ...
              dualPaneRepositoryPicker={{...}}
            />
          ) : (
            <SessionEmptyState ... />
          )}
        </div>
      </React.Fragment>
    ))}
  </div>
) : (
  <ClaudeSessionChatWithDock session={activeSession} ... />
)}
```

**CSS Grid 替代 Flexbox**：

```css
.app-claude-sessions__multi-panes {
  --app-multi-pane-min-width: 460px;
  display: grid;
  gap: 1px;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
}

.app-claude-sessions__pane {
  min-width: var(--app-multi-pane-min-width);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-claude-sessions__pane-divider {
  /* 使用 grid gap 替代显式 divider 元素，无需单独 CSS */
}
```

> 使用 CSS Grid `gap` 属性替代显式 divider 元素，简化渲染结构。

### 6. `src/hooks/useClaudeSessions.ts`

- `companionSessionId: string | null` → `companionSessionIds: string[]`
- keep-set 逻辑改为遍历数组。

### 7. `src-tauri/src/lib_impl.rs`

- 全局快捷键 Alt+K 发射事件改为 `global-cycle-multi-pane`。
- 保留对旧事件 `global-toggle-dual-pane` 的兼容发射。

## 向后兼容

- `dualPaneEnabled` 相关的 props 名在 `ClaudeSessions` 组件中保留，但语义变为 `paneCount > 1`。
- `dualPaneSecondarySessionId` → `extraPanes[0]?.sessionId`（如果存在）。
- 其他组件中引用 `dualPaneEnabled` 的地方（如 `AppWorkspaceLayout.tsx`）改为读取 `paneCount > 1`。

## 风险与边界

1. **窗口宽度上限**：8屏（4列×460px=1840px+分隔条）需要很宽的显示器或缩放。如果显示器不够宽，窗格会被压缩到 min-width 以下。解决方案：允许窗格出现水平滚动条而非强制最小宽度。
2. **内存/性能**：8个 `ClaudeSessionChatWithDock` 实例。每个实例内部有独立的通知订阅和消息列表。React 19 并发特性应能处理，但需要关注。
3. **Tauri 窗口 resize**：多行模式下可能需要调整窗口高度。初版先只处理宽度，高度保持不变。
