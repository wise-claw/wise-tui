# Implement: 中栏多屏模式（2/4/6/8屏）

## 实施顺序

### Step 1: 类型与常量层

1. 在 `src/constants/mainLayoutWidths.ts` 新增：
   - `PaneCount` 类型
   - `paneGridDimensions()` 函数
   - `computeMinLogicalCenterWidthForPaneCount()` 函数
   - `computeMultiPaneTargetCenterLogical()` 函数
   - 保留旧函数名作为 `count=2` 的别名
2. 验证：`bun test`（确保现有测试不受影响）

### Step 2: 窗口服务层

1. 在 `src/services/mainWindowLayout.ts` 新增：
   - `expandMainWindowForPaneCount(count, centerBefore, options)` 泛化函数
2. 保留旧的 `expandMainWindowByDualPaneCenterDelta` 作为兼容包装

### Step 3: 状态管理重构（useMainLayoutModes）

1. 重构 `src/hooks/useMainLayoutModes.ts`：
   - 接口改为接受 `paneCount` + `setPaneCount` + `extraPanes` + `setExtraPanes`
   - 新增 `handleChangePaneCount(count)` 替代 `handleToggleDualPane`
   - 新增 `handlePaneRepositorySelect(slotIndex, repositoryId)` 替代 `handleDualPaneSecondaryRepositorySelect`
   - 新增 `handleNewPaneSession(slotIndex, repository)` 替代 `handleNewSecondarySession`
   - Alt+K 循环逻辑改为 `1→2→4→6→8→1`
   - 窗口 resize 基于列数计算
2. 返回值更新：导出 `handleChangePaneCount`, `handlePaneRepositorySelect`, `handleNewPaneSession`

### Step 4: AppImpl 状态替换

1. 替换 `src/AppImpl.tsx` 中的三个 dualPane 状态为 `paneCount` + `extraPanes`
2. 更新 `useMainLayoutModes` 调用参数
3. 更新向 `ClaudeSessions` 传递的 props
4. 更新 `useClaudeSessions` 的 `companionSessionId` → `companionSessionIds`
5. 更新 `src/hooks/useClaudeSessions.ts` 接受 `companionSessionIds: string[]`

### Step 5: ClaudeSessions 渲染重构

1. **Topbar 下拉菜单**：
   - 替换 `TopbarBtn` 为 `Dropdown` + 菜单
   - 菜单项：1屏（关闭）/2屏/4屏/6屏/8屏
   - 当前选中项带 ✓
2. **网格渲染**：
   - 替换二元分支为 grid 渲染
   - Pane 0 始终渲染 activeSession
   - Pane 1..N-1 从 extraPanes 渲染
   - 每个额外窗格带 Repo 选择器
3. **CSS 更新**：
   - `src/components/ClaudeSessions/index.css` 改为 CSS Grid 布局
   - 使用 `gap` 替代显式 divider 元素

### Step 6: Tauri 后端快捷键

1. 在 `src-tauri/src/lib_impl.rs` 更新 Alt+K 快捷键发射事件为 `global-cycle-multi-pane`
2. 保留旧 `global-toggle-dual-pane` 事件兼容

### Step 7: 交叉引用更新

1. 搜索所有引用 `dualPaneEnabled` 的文件，更新为 `paneCount > 1`
2. 搜索所有引用 `dualPaneSecondarySessionId` 的文件，更新为 `extraPanes[0]?.sessionId`
3. 确保 `AppWorkspaceLayout.tsx` 等中间层组件适配新 props

### Step 8: 验证与测试

1. `bun test` — 确保现有测试通过
2. `bun run build` — 确保编译通过（用户允许后执行）
3. 手动验证：
   - Topbar 下拉菜单可选 1/2/4/6/8 屏
   - Alt+K 循环切换正确
   - 网格布局正确（1×2, 2×2, 2×3, 2×4）
   - 新增窗格显示空屏状态
   - Repo 选择器正常工作
   - 通知隔离正常
   - 窗口自适应调整

## 验证命令

```bash
bun test
bun run build  # 需用户允许
```

## 回滚策略

- 所有修改在前端层，不涉及数据库迁移
- 可通过 git revert 安全回滚
- 旧事件名 `global-toggle-dual-pane` 保持兼容
