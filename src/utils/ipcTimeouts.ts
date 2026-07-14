/** 通用 IPC 超时（毫秒）：防止磁盘/网络挂起把 UI 永久钉在 loading。 */

export const REPO_EXPLORER_LIST_TIMEOUT_MS = 45_000;
export const REPO_EXPLORER_SEARCH_TIMEOUT_MS = 60_000;
export const REPO_FILE_MUTATION_TIMEOUT_MS = 30_000;

export const SKILLS_SCAN_TIMEOUT_MS = 60_000;
export const SKILLS_DETECT_TIMEOUT_MS = 30_000;

/** 看门狗默认：操作超过此时长仍未结束 → 标记为卡住并允许用户解除。 */
export const OPERATION_STUCK_AFTER_MS = 25_000;
/** busy flag 安全阀：超过此时长强制清除 submitting/loading。 */
export const BUSY_FLAG_MAX_MS = 90_000;
