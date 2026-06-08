# Git 与文件树左右栏组合/单独显示

## Goal

让用户在 Wise 左栏底部切换 Git 变更面板与仓库文件树时，既能像现在一样**单独显示其中一个**，也能在需要时**左右分栏同时查看**（Git 在左栏、文件树在右栏），减少在 Tab 间来回切换的成本。

## 背景（已确认事实）

- 当前左栏底部通过 `LeftSidebarBottomTabSwitcher` **互斥 Tab** 切换 Git / 文件树，同一时刻只显示一个（`LeftBottomTab = "git" | "files"`）。
- 右栏 `ChatInspector` 承载快捷操作、备忘录、待办、运行监控等，**不含** Git / 文件树。
- 运行面板已有「左栏 / 右栏」分栏配置先例（`monitorPanelPlacement`），本需求仅针对 Git + 文件树，不复用运行面板槽位。

## Requirements

1. **单独显示（保持现有能力）**
   - 仅 Git：Git 面板在左栏底部全高展示（与现 `bottomTab=git` 一致）。
   - 仅文件树：文件树在左栏底部全高展示（与现 `bottomTab=files` 一致）。

2. **组合显示（方式 A：左右分栏）**
   - 用户同时启用 Git 与文件树时：Git 留在**左栏底部**，文件树移到**右栏 Inspector** 顶部区域（位于快捷操作 / 备忘录 / 待办之上或之下，见 design.md）。
   - 两侧共用同一仓库目录上下文（路径、工作区选择器选中项、打开文件行为一致）。

3. **切换交互**
   - 左栏底部现有 Git / 文件两个图标改为 **可多选 toggle**（至少保留一个选中）。
   - 只选 Git → 单独 Git；只选文件 → 单独文件树；两个都选 → 左右分栏组合。

4. **持久化**
   - 用户选择写入 `localStorage`，刷新后恢复；从旧 `wise.leftPanel.bottomTab` 平滑迁移。

5. **右栏收起兼容**
   - 组合模式下若右栏处于收起状态，进入组合时应**自动展开右栏**（一次性），确保文件树可见；用户仍可手动再收起。

## Out of Scope

- 左栏上下分屏堆叠 Git + 文件树（方式 B）。
- 可配置「文件树在左 / Git 在右」的反向分栏。
- 默认配置中心新增「Git/文件树布局」项（后续迭代）。
- 改动 Cockpit / Author 模式下的侧栏结构。
- 删除或迁移现有 Git / 文件树 IPC、后端能力。

## Acceptance Criteria

- [ ] 左栏 Git / 文件图标支持 toggle；至少一项保持选中。
- [ ] 仅 Git 选中：行为与改动前 `bottomTab=git` 一致。
- [ ] 仅文件选中：行为与改动前 `bottomTab=files` 一致。
- [ ] 两项均选中：左栏显示 Git，右栏 Inspector 显示文件树，目录上下文与打开文件行为一致。
- [ ] 从旧 `bottomTab` localStorage 迁移后，首次加载表现与升级前相同。
- [ ] 组合模式首次进入时，若右栏收起则自动展开。
- [ ] 相关单元测试通过（布局推导、存储迁移、toggle 逻辑）；`bun test` 无回归。

## Notes

- UI 文案使用中文。
- 遵循现有 Ant Design 侧栏样式与 `app-left-sidebar-bottom-tab-*` 布局约定。
