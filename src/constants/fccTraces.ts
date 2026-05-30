/** FCC 请求列表面板：首屏与每次滚动加载条数。 */
export const FCC_TRACES_PAGE_SIZE = 50;

/** 单次 IPC 拉取条数（与分页步长一致）。 */
export const FCC_TRACES_FETCH_LIMIT = 50;

/** 内存中最多保留的 trace 条数（超出丢弃最旧），避免 FCC 面板长期轮询撑爆堆。 */
export const FCC_TRACES_IN_MEMORY_MAX = 250;
