# PRD: 前端内存优化 — 清理无界缓存与缓冲上限

## Goal

Wise 桌面应用长时间运行后，前端多个 Map/Set/Array 缓存无上限增长，导致内存持续上升。已有大量优化（sidecar prune、session messages cap、stream dedup 等），但仍有若干高频路径残留无界缓存。本轮对 5 处高影响区域加上限或改用更紧凑的数据结构。

## Requirements

### R1. `notificationHub.requestLifecycles` 增加数量上限

`expireStaleRequests` 只按时间（`maxAgeMs * 2`）清理非 pending 条目。大量工具调用场景下（单次会话数百 tool_use），条目在 2 小时窗口内累积数千条。

**方案**：在 `expireStaleRequests` 末尾增加数量上限裁剪——非 pending 条目超过 `MAX_LIFECYCLE_ENTRIES`（500）时按 `updatedAt` 升序删除最旧的。

### R2. `useSpeechToRequirementSync` 的 `syncedIdsRef` 改为阈值追踪

`syncedIdsRef: Set<number>` 对每条消息 id 做 add，长会话可累积数千条。消息 id 是 `Date.now()` 生成的数字，单调递增。

**方案**：将 `Set<number>` 替换为 `number`（已同步消息的最大 id）。判断 `msg.id > syncedMaxIdRef.current` 即可。

### R3. `fccTracesStore` 的 `traces` 数组增加最大上限

滚动加载 `loadMoreFccTraces` 无限追加条目。

**方案**：定义 `FCC_TRACES_MAX_ENTRIES = 2000`，合并后若超出则截断最旧条目并置 `hasMore = false`。

### R4. `claudeStreamRuntime` 隐藏态 deferred 缓冲增加安全上限

`deferredSystemErrors`、`deferredStderrErrors`、`deferredCompletes` 在文档 hidden 期间无限累积。

**方案**：每个数组上限 256 条，超出时丢弃最旧的。

### R5. `repositoryRunCommandRuntimeStore` 保存 terminal listener unlisten 函数

`subscribeTerminalOutput` / `subscribeTerminalExit` 返回 unlisten 但未存储。

**方案**：存储 unlisten 函数并提供 `disposeTerminalListeners`。同时确保 `pruneRepositoryRunCommandRuntime` 也清理 `repoInternalsById` 中的残留条目。

## Acceptance Criteria

- [x] `notificationHub.expireStaleRequests` 在时间裁剪后追加数量裁剪
- [x] `useSpeechToRequirementSync` 不再使用 `Set<number>`
- [x] `fccTracesStore` 的 `traces` 数组有硬上限
- [x] `claudeStreamRuntime` 三个 deferred 数组有安全上限
- [x] `repositoryRunCommandRuntimeStore` 存储 unlisten 函数且 prune 也清理 internals
- [x] `bun test` 全部通过
- [x] 无 TypeScript 类型错误

## Notes

- 轻量任务，PRD-only 即可开始实现。
- 所有修改均在前端 `src/` 层，不涉及 Tauri/Rust。
