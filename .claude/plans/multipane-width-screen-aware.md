# 多屏宽度优化：智能扩展 + 屏幕上限

## 问题根因

开多屏时窗口超出屏幕，是多重叠加结果：

1. **扩展无视屏幕宽度**（`useMainLayoutModes.ts:287`）：`setMainWindowLogicalInnerSize(window.innerWidth + colDelta×421, …)` 每列无脑 +421px。1280px 窗口开两屏 → 1701px，顶出 1440px 屏幕。
2. **OS 级 `setMinSize` 锁死过宽**（`mainWindowLayout.ts:64`）：2 屏 minSize = 260+841+300+10 = **1411px**；8 屏 = **2253px**。锁住后用户缩不回屏幕内。
3. **pane CSS `min-width: 420px`**（`index.css:115`）：4/6/8 屏每个 cell 强制 420px，撑破 grid（2 屏已覆盖为 0，4/6/8 未覆盖）。
4. **gap 常量不一致**：TS `MAIN_LAYOUT_MULTI_PANE_GAP_PX=1`（`mainLayoutWidths.ts:186`）vs CSS `gap:2px`（`index.css:77`），扩展计算与渲染偏差。
5. `expandMainWindowToRemoveHorizontalOverflow` 是死代码（无调用点），忽略。

## 方案（用户已确认：智能扩展 + 屏幕上限）

开多屏时：
- 计算理想窗口宽度 `idealWidth` = 侧栏 + 中栏目标(每屏≥420) + 手柄
- 计算屏幕可用宽度 `maxByMonitor` = `currentMonitor()` 逻辑宽度 − margin(16px)
- `targetWidth` = min(idealWidth, maxByMonitor)，且不小于当前窗口宽度（不缩窗，只扩或保持）
- `targetWidth > currentInnerWidth` → 扩展窗口并记录增量；否则窗口内分屏（pane 自动变窄）
- 被屏幕上限压回时，一次性 `message.info` 提示

minSize 同样屏幕感知：`minWidth = min(理论最小, maxByMonitor)`，保证用户总能缩回屏幕内。
pane CSS `min-width` 改 0，让 `minmax(0,1fr)` 真正生效，屏幕不够时 pane 压缩而非撑破容器。
多显示器：`currentMonitor()` 返回窗口所在显示器，自动跟随。

## 改动清单

### 1. `src/constants/mainLayoutWidths.ts`（纯函数 + 常量）

- **修复 gap**：`MAIN_LAYOUT_MULTI_PANE_GAP_PX` 1 → 2（与 CSS `gap:2px` 一致）；`MAIN_LAYOUT_MULTI_PANE_UNIT_PX` 自动变 422。
- **新增** `MAIN_LAYOUT_MONITOR_WIDTH_MARGIN_PX = 16`（窗口距屏幕留白：阴影/边框/DPI 抖动）。
- **新增纯函数** `computeMultiPaneTargetWindowWidth({ paneCount, currentInnerWidth, leftCollapsed, rightCollapsed, leftWidthPx, rightWidthPx, monitorLogicalWidth })` → `{ targetWidth, clampedByMonitor }`：
  - `sideGutter` = 左右栏(收起为0) + 手柄
  - `idealCenter` = max(computeMinLogicalCenterWidthForPaneCount(paneCount), currentInnerWidth − sideGutter)
  - `idealWidth` = idealCenter + sideGutter
  - monitor 为 null → `{ max(currentInnerWidth, idealWidth), false }`
  - 否则 `maxByMonitor = max(320, monitor − MARGIN)`；`cappedIdeal = min(idealWidth, maxByMonitor)`；`target = max(currentInnerWidth, cappedIdeal)`；`clamped = idealWidth > maxByMonitor`
- **新增纯函数** `clampMinWindowWidthToMonitor(minWidth, monitorLogicalWidth, marginPx?)`：monitor 为 null 返回 minWidth；否则 `min(minWidth, max(320, monitor − margin))`。
- **`computeRestoreMultiPaneLogicalWidth` 增加可选参数** `monitorLogicalWidth?: number | null`：原逻辑算出 target 后，若提供 monitor 则 `target = min(target, max(320, monitor − MARGIN))`。旧调用（不传该参）行为不变。

### 2. `src/services/mainWindowLayout.ts`（Tauri 副作用封装）

- **新增** `readCurrentMonitorLogicalWidth(): Promise<number | null>`：`getCurrentWindow().currentMonitor()` → `monitor.size.width / monitor.scaleFactor`；失败/null 返回 null（回退到不 clamp）。
- **`syncMainWindowMinLogicalSize` 屏幕感知**：内部 `await readCurrentMonitorLogicalWidth()`，用 `clampMinWindowWidthToMonitor(computeMainWindowMinLogicalWidth(options), monitorWidth)` 后再 `setMinSize`。签名不变。
- 死代码 `expandMainWindowToRemoveHorizontalOverflow` 不动（无调用，避免范围蔓延）。

### 3. `src/hooks/useMainLayoutModes.ts`（切换逻辑）

- **`handleChangePaneCount` 扩展分支（283-305 行）**：
  - `colDelta > 0`：替换 `colDelta × UNIT_PX` 为：
    ```
    monitorWidth = await readCurrentMonitorLogicalWidth()
    { targetWidth, clampedByMonitor } = computeMultiPaneTargetWindowWidth({ paneCount: targetCount, currentInnerWidth: window.innerWidth, leftCollapsed: collapsed, rightCollapsed: effectiveRightCollapsed, leftWidthPx: mainLayoutLeftWidthPx, rightWidthPx: mainLayoutRightWidthPx, monitorLogicalWidth: monitorWidth })
    if (targetWidth > window.innerWidth) {
      await setMainWindowLogicalInnerSize(targetWidth, window.innerHeight)
      multiPaneAccumulatedDeltaRef.current += targetWidth - window.innerWidth
    }
    if (clampedByMonitor) message.info("屏幕宽度有限，已在当前窗口内分屏")
    ```
  - `colDelta < 0`（缩窗）：保持现有逻辑（缩窗只会更小，无需 clamp）。
- **持久化恢复（706 行）**：
  ```
  monitorWidth = await readCurrentMonitorLogicalWidth()
  targetWidth = computeRestoreMultiPaneLogicalWidth(restoredCount, currentWidth, undefined, monitorWidth)
  ```
- **关闭多屏（230-254 行）**：不变（按 accumulated delta 缩回）。

### 4. `src/components/ClaudeSessions/index.css`

- `.app-claude-sessions__pane` 的 `min-width: var(--app-multi-pane-min-width)` → `min-width: 0`，让 4/6/8 屏 `minmax(0,1fr)` 真正生效。保留 `--app-multi-pane-min-width: 420px` 变量（splitter clamp 仍引用，语义=理想最小）。
- 删除 `.app-claude-sessions__multi-panes--two-pane .app-claude-sessions__pane { min-width: 0 }` 覆盖（85-87 行，现已统一为 0，覆盖冗余）。

### 5. 测试 `src/constants/mainLayoutWidths.multiPane.test.ts`

- 更新 gap 相关断言：`MAIN_LAYOUT_MULTI_PANE_UNIT_PX` 421 → 422；`computeRestoreMultiPaneLogicalWidth` 第 79 行 `900 + UNIT_PX` 同步。
- 新增 `computeMultiPaneTargetWindowWidth` 用例：屏幕够宽扩到 ideal；屏幕不够压到 maxByMonitor 且 clamped=true；当前窗口已宽于 ideal 不扩 clamped=false；monitor=null 不 clamp。
- 新增 `clampMinWindowWidthToMonitor` 用例：minWidth>maxByMonitor 返回 maxByMonitor；minWidth<=maxByMonitor 返回 minWidth；monitor=null 返回 minWidth。
- 新增 `computeRestoreMultiPaneLogicalWidth` monitor 参数用例：屏幕上限压回。

## 体验细节

- 提示文案「屏幕宽度有限，已在当前窗口内分屏」（一次性 message.info）。
- splitter 拖拽下限 `TWO_PANE_MIN_WIDTH_PX=420` 保留（窄屏下 `clampTwoPaneSplitRatio` 已自动回退 0.5）。
- 关闭多屏仍按 accumulated delta 缩回。
- 多显示器跟随窗口所在屏。

## 风险与回退

- `currentMonitor()` 返回 null → 回退原逻辑（不 clamp），不劣于现状。
- pane min-width 改 0 后，宽屏下 4/6/8 屏 pane 填满中栏（可能 >420），符合 `minmax(0,1fr)` 等分意图，是预期改善。
- minSize 屏幕感知后多屏可缩入屏幕，pane 变窄可接受（优于超出屏幕）。

## 验证

- `bun test`（含 `mainLayoutWidths.multiPane.test.ts` 及全量回归，排除 memory 记录的 9 个既有失败）。
- 静态检查：`bunx tsc --noEmit`（不启动 dev server，遵守 CLAUDE.md）。
- 手动场景：1280 窗口开两屏 → 扩到 min(ideal, 屏幕上限)，不超屏幕；8 屏在 1440 屏 → 压到屏幕上限 + 内部分屏 + 提示。
