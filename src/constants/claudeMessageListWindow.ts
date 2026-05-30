/** 主会话与列视图：首屏最多挂载的消息条数（减轻 DOM / React 树） */
export const CLAUDE_MESSAGE_LIST_INITIAL_VISIBLE = 80;
/** 「显示更早消息」每次增加的条数 */
export const CLAUDE_MESSAGE_LIST_LOAD_MORE_STEP = 80;

/** 切 tab / 伴生窗格首次懒加载：只读 jsonl 尾部少量行 */
export const CLAUDE_DISK_JSONL_TAIL_LINES_LAZY = 300;

/** 用户点击「加载更早轮次」时每次追加读取的行数 */
export const CLAUDE_DISK_JSONL_TAIL_LINES_LOAD_MORE = 350;

/** 渐进加载上限；超过后需用户显式「加载完整历史」 */
export const CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL = 1000;

/** 回合结束后与磁盘对齐时只读尾部行数，避免长会话全量 jsonl 反复进内存 */
export const CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD = 400;

/** React 内存中每会话最多保留的消息条数（超出标记 partial，UI 可提示加载更早） */
export const IN_MEMORY_SESSION_MESSAGES_MAX = 80;

/** 全部标签合计最多保留的消息条数（超出时优先清空非活动/非运行会话正文） */
export const IN_MEMORY_GLOBAL_MESSAGES_BUDGET = 180;

/** 单条 message part 文本/tool 输出在内存中的字符上限 */
export const IN_MEMORY_MESSAGE_PART_TEXT_MAX = 12_000;

/** 单仓库磁盘索引合并后最多保留的无消息历史标签数（其余仅保留 preview 在磁盘） */
export const MAX_REPO_DISK_INDEX_SESSIONS = 24;

/** 写入 tabs 持久化时，每会话最多保留的尾部消息条数 */
export const PERSIST_SESSION_MESSAGES_MAX = 48;
