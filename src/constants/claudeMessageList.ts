/** 消息列表：全量 DOM + 尾部窗口，避免虚拟滚动空白 */
export const CHAT_MESSAGE_LIST_RENDER_MODE = "full-dom" as const;

/** 超过该行数启用尾部窗口（仅渲染最近 N 条） */
export const CHAT_MESSAGE_LIST_WINDOW_THRESHOLD = 50;

/** 初次展示最近消息条数 */
export const CHAT_MESSAGE_LIST_INITIAL_VISIBLE = 48;

/** 每次加载更早消息的条数 */
export const CHAT_MESSAGE_LIST_LOAD_STEP = 28;

/** 滚到距顶部小于该值时自动加载更早消息 */
export const CHAT_MESSAGE_LIST_SCROLL_LOAD_PX = 160;

/** 多屏伴生窗格：更小的尾部窗口，减轻 6/8 屏 DOM 压力 */
export const CHAT_MESSAGE_LIST_COMPANION_INITIAL_VISIBLE = 24;

/** 多屏伴生窗格：每次加载更早消息的条数 */
export const CHAT_MESSAGE_LIST_COMPANION_LOAD_STEP = 16;

/** 主窗格 visibleCount 上限：增量浏览（加载更早/尾部扩展）封顶，防止长会话 DOM 无限膨胀。
 *  注意：定位旧消息（ensureMessageVisible）豁免此 cap，由贴底回收回落。 */
export const CHAT_MESSAGE_LIST_MAX_VISIBLE = 160;

/** 伴生窗格 visibleCount 上限 */
export const CHAT_MESSAGE_LIST_COMPANION_MAX_VISIBLE = 96;

/** 贴底回收阈值（px）：距底部小于该值且 visibleCount 已扩张时，回收到 initialVisible */
export const CHAT_MESSAGE_LIST_BOTTOM_RECLAIM_PX = 64;
