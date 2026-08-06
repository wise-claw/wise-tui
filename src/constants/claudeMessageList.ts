/** 消息列表：全量 DOM + 尾部窗口，避免虚拟滚动空白 */
export const CHAT_MESSAGE_LIST_RENDER_MODE = "full-dom" as const;

/** 超过该行数启用尾部窗口（仅渲染最近 N 条） */
export const CHAT_MESSAGE_LIST_WINDOW_THRESHOLD = 50;

/**
 * 初次展示最近消息条数。
 *
 * 必须 > {@link CHAT_MESSAGE_LIST_WINDOW_THRESHOLD}：窗口刚启用（行数 = 阈值 + 1）时
 * 初始窗口应能覆盖全部行，否则一进入窗口化就冒出「加载更早消息（还有 3 条）」这种
 * 无意义按钮。历次 DOM 预算下调（100→72→56）都守住了该关系，48 是调优时漏掉的。
 */
export const CHAT_MESSAGE_LIST_INITIAL_VISIBLE = 52;

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

/**
 * 贴底回收静置延迟（ms）：在底部停稳该时长后才回收窗口（真 debounce：贴底滚动会重置计时）。
 *
 * 回收一次最多卸载 maxVisible - initialVisible 行。若在滚动过程中同步执行，卸载与随后
 * 向上滚动的重新挂载（含 Markdown 重新解析）会交替发生，表现为「滚动时消息空白重绘」。
 * 流式贴底跟随会持续产生 scroll，必须重置计时，否则约 idleMs 就会在执行中途回收。
 */
export const CHAT_MESSAGE_LIST_RECLAIM_IDLE_MS = 900;
