/** 主会话与列视图：首屏最多挂载的消息条数（减轻 DOM / React 树） */
export const CLAUDE_MESSAGE_LIST_INITIAL_VISIBLE = 120;
/** 「显示更早消息」每次增加的条数 */
export const CLAUDE_MESSAGE_LIST_LOAD_MORE_STEP = 120;

/** 从磁盘 JSONL 初次懒加载时仅读取尾部行数（降低 IPC 与解析内存）；完整对齐仍由用户触发的全量 reload 完成 */
export const CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL = 2000;

/** 回合结束后与磁盘对齐时只读尾部行数，避免长会话全量 jsonl 反复进内存 */
export const CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD = 800;

/** React 内存中每会话最多保留的消息条数（超出标记 partial，UI 可提示加载更早） */
export const IN_MEMORY_SESSION_MESSAGES_MAX = 120;

/** 单仓库磁盘索引合并后最多保留的无消息历史标签数（其余仅保留 preview 在磁盘） */
export const MAX_REPO_DISK_INDEX_SESSIONS = 48;

/** 写入 tabs 持久化时，每会话最多保留的尾部消息条数 */
export const PERSIST_SESSION_MESSAGES_MAX = 80;
