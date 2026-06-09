# 排查并修复全局间歇卡顿

## Goal

修复最近添加功能引入的全局间歇性 UI 卡顿，尤其是用户描述的“几秒卡顿一下、随便放哪里都会卡顿”，让主界面在 Claude 会话流式输出、左侧栏可见、工作区 Todo 角标存在时保持响应。

## Confirmed Facts

- 当前任务由用户报告触发：最近添加的功能导致每隔几秒出现一次明显卡顿，卡顿不局限于某个具体面板。
- 近期相关改动集中在 `src/hooks/useMonitorSessionsForOverview.ts`、`src/components/LeftSidebar.tsx`、`src/constants/monitorUi.ts`、工作区 Todo 角标与用户消息展示相关文件。
- `LeftSidebar` 当前为监控面板和 transcript 两个用途分别调用 `useMonitorSessionsFingerprint`。
- `useMonitorSessionsFingerprint` 每 `MONITOR_SESSIONS_SYNC_INTERVAL_MS` 周期扫描会话列表并构造指纹；该间隔当前为 6000ms，和“几秒卡顿一下”的体感吻合。
- 指纹构造会遍历每个 session 的消息，并调用 `indexOfLastRenderableUserMessage` / `settledAssistantPreviewLengthBucket`，在会话多或消息多时会占用主线程。
- `useSidebarWorkspaceTodoCounts` 也会在空闲时批量加载项目和仓库 Todo 计数，需要作为次要候选源检查，但它不是固定几秒周期。

## Requirements

- 消除监控会话指纹逻辑造成的周期性主线程全量扫描，避免左侧栏或全局布局因为后台监控数据同步而卡顿。
- 保持监控概览和左侧栏状态的必要更新：会话数量、状态、末条消息角色、结束后预览变化等仍应能触发 UI 刷新。
- 避免为了修复卡顿而删除现有监控面板、Claude 会话、工作区 Todo 角标等功能。
- 修复应优先使用纯函数、hook 内部节流/缓存或更低成本的指纹策略，不引入新的 UI 框架或持久化路径。
- 添加或更新聚焦测试，覆盖流式正文增长不应改变运行中会话指纹，以及状态/消息边界变化仍应改变指纹。

## Acceptance Criteria

- [ ] 运行中会话的长流式正文增长不会触发监控概览或左侧栏指纹的周期性全量内容扫描。
- [ ] 左侧栏不再为同一批 `sessions` 创建重复的周期性指纹计时器。
- [ ] 会话数量、会话状态、末条消息角色、最后用户消息边界等监控相关状态变化仍能改变指纹。
- [ ] 工作区 Todo 角标逻辑没有引入固定几秒一次的全局刷新或主线程批量工作。
- [ ] 相关测试通过，至少覆盖 `useMonitorSessionsForOverview` 指纹行为。

## Out of Scope

- 重写 Claude 会话存储、终端渲染、监控面板整体架构。
- 删除现有后台能力或工作区 Todo 功能。
- 用浏览器 localStorage 新增持久化性能缓存。

## Open Questions

- 无阻塞问题；先按证据优先修复监控会话指纹周期性扫描。