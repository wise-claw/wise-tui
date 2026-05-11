/** 主会话与列视图：首屏最多挂载的消息条数（减轻 DOM / React 树） */
export const CLAUDE_MESSAGE_LIST_INITIAL_VISIBLE = 120;
/** 「显示更早消息」每次增加的条数 */
export const CLAUDE_MESSAGE_LIST_LOAD_MORE_STEP = 120;

/** 从磁盘 JSONL 初次懒加载时仅读取尾部行数（降低 IPC 与解析内存）；完整对齐仍由全量 reload 完成 */
export const CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL = 8000;

/** 写入 tabs 持久化时，每会话最多保留的尾部消息条数 */
export const PERSIST_SESSION_MESSAGES_MAX = 80;
