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
