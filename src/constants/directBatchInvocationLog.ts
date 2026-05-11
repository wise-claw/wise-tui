/**
 * 直连批量 OMC 单路子进程日志保留：环形捕获、落盘快照、详情抽屉解析须与 `stdout` 上限对齐，
 * 否则会出现「子进程实际输出更多，但持久化/重开已丢前半段」。
 */
export const DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES = 12_000;
export const DIRECT_BATCH_INVOCATION_STDERR_RETENTION_LINES = 6_000;

/**
 * 同一锚点会话 + 仓库下 `InvocationSnapshotBundle` 保留条数（直连批量与 BackgroundInvocationDock 共用，按 `updatedAt` 淘汰最旧）。
 */
export const BACKGROUND_INVOCATION_BUNDLE_MAX_ITEMS = 80;

/** `setAppSettingJson` 失败时的降级裁剪；仍应尽量保留可追溯正文 */
export const DIRECT_BATCH_BUNDLE_SLIM_STDOUT_LINES = 4_000;
export const DIRECT_BATCH_BUNDLE_SLIM_STDERR_LINES = 2_000;
