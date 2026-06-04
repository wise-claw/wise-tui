/** 监控侧栏 / `useMonitorOverview` 指纹轮询间隔（毫秒）；流式正文由指纹分桶节流。 */
export const MONITOR_SESSIONS_SYNC_INTERVAL_MS = 2800;

/** 外部 Trellis CLI ingest：轮询读入的 jsonl 尾行（非详情全量） */
export const MONITOR_TRELLIS_INGEST_TAIL_LINES = 600;

/** 监控抽屉关闭时的轻量 ingest 尾行（仅 ownership graph，不扫全量 jsonl） */
export const MONITOR_TRELLIS_INGEST_TAIL_LINES_BACKGROUND = 180;

/** 每个 Trellis 根路径 ingest 时最多扫描的会话数 */
export const MONITOR_TRELLIS_INGEST_MAX_SESSIONS = 10;

/** `useMonitorOverview` 内存中保留的外部 Trellis agent run 上限 */
export const MONITOR_TRELLIS_RUNS_IN_MEMORY_MAX = 64;

/** 已完成外部 Trellis run 在内存中保留时长（毫秒） */
export const MONITOR_TRELLIS_RUN_STALE_MS = 7 * 24 * 60 * 60 * 1000;
