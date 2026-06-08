# Implement — Git 与文件树左右栏组合/单独显示

## 执行顺序

### Step 1 — 存储与纯函数

- [ ] 在 `sidebarStorage.ts` 增加 `RepoPanelVisibility`、`deriveRepoPanelLayout`、读写与 `bottomTab` 迁移。
- [ ] 新增 `sidebarStorage.test.ts` 覆盖迁移与推导。

**验证**：`bun test src/components/LeftSidebar/sidebarStorage.test.ts`

### Step 2 — Tab Switcher / Panes

- [ ] 改造 `LeftSidebarBottomTabSwitcher` 为 visibility toggle。
- [ ] 改造 `LeftSidebarBottomTabPanes` 接受 `layout`，按 design 显示/隐藏。
- [ ] 新增 switcher 单元测试（可选，与 Step 1 同文件或独立）。

**验证**：`bun test` 相关用例

### Step 3 — 抽取 `useRepoPanelExplorerState`

- [ ] 从 `LeftSidebar.tsx` 抽出路径、tree selection、search、open file、selector props。
- [ ] 返回 `layout` 所需字段 + 工厂函数 `buildFilesPanel(props)`。

**验证**：TypeScript 编译；左栏 solo 模式手动冒烟（开发环境若可用）

### Step 4 — 左栏接入

- [ ] `LeftSidebar` 使用 visibility state 替代 `leftBottomTab`。
- [ ] `split-lr` 时左栏只渲染 Git；`solo-files` 左栏渲染 files。
- [ ] `useEffect` 调用 `onRepositoryFilesPanelChange` 传递右栏 files 节点（仅 `split-lr` 非 null）。

### Step 5 — 右栏与 App 布线

- [ ] `ChatInspector` 增加 `repositoryFilesPanel` 插槽与样式。
- [ ] `LeftSidebar/types.ts` + `AppImpl`：`repositoryFilesPanelNode` state、`onRepositoryFilesPanelChange`。
- [ ] `split-lr` 首次进入且右栏收起 → 自动展开（`useEffect` on layout）。

### Step 6 — 样式收尾

- [ ] `Inspector.css` / `App.css`：右栏文件树高度、滚动、与 inspector card 间距。
- [ ] 确认左栏现有 `app-left-sidebar-bottom-tab-content` 在 `split-lr` 下 Git 仍占满底部区域。

### Step 7 — 质量门禁

- [ ] `bun test` 全量或至少本任务相关测试。
- [ ] `read_lints` 改动文件无新增错误。

## 回滚点

- Step 3 前：仅 storage/UI 组件，可 revert 不影响 App 布线。
- Step 5 前：右栏无 files，组合模式可临时降级为仅 Git（feature flag 不必要，保持原子提交）。

## 不在本实现内

- DefaultConfigPanel 设置项
- 反向分栏（files 左 git 右）
