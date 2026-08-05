import { getAppSettingJson, setAppSettingJson } from "./appSettingsStore";

export const STREAMING_PROCESS_RECLAIM_SETTINGS_KEY = "wise.streamingProcessReclaim.v1";

/** 空闲超过该分钟数回收长驻子进程 */
export const DEFAULT_STREAMING_PROCESS_RECLAIM_IDLE_MINUTES = 10;
/** 全局最多同时存活的 streaming / 长驻执行子进程 */
export const DEFAULT_STREAMING_PROCESS_RECLAIM_MAX_LIVE = 10;
/** spawn 后宽限秒数，避免误杀启动中进程 */
export const DEFAULT_STREAMING_PROCESS_RECLAIM_GRACE_SECONDS = 60;
/** 定时扫描间隔（毫秒） */
export const DEFAULT_STREAMING_PROCESS_RECLAIM_SCAN_INTERVAL_MS = 5 * 60_000;

export type StreamingProcessReclaimConfig = {
  enabled: boolean;
  idleMinutes: number;
  maxLiveProcesses: number;
  graceSeconds: number;
  scanIntervalMs: number;
};

export function defaultStreamingProcessReclaimConfig(): StreamingProcessReclaimConfig {
  return {
    enabled: true,
    idleMinutes: DEFAULT_STREAMING_PROCESS_RECLAIM_IDLE_MINUTES,
    maxLiveProcesses: DEFAULT_STREAMING_PROCESS_RECLAIM_MAX_LIVE,
    graceSeconds: DEFAULT_STREAMING_PROCESS_RECLAIM_GRACE_SECONDS,
    scanIntervalMs: DEFAULT_STREAMING_PROCESS_RECLAIM_SCAN_INTERVAL_MS,
  };
}

export function normalizeStreamingProcessReclaimConfig(
  raw: Partial<StreamingProcessReclaimConfig> | null | undefined,
): StreamingProcessReclaimConfig {
  const d = defaultStreamingProcessReclaimConfig();
  const idleMinutes = Math.min(
    24 * 60,
    Math.max(1, Math.round(raw?.idleMinutes ?? d.idleMinutes)),
  );
  const maxLiveProcesses = Math.min(
    32,
    Math.max(1, Math.round(raw?.maxLiveProcesses ?? d.maxLiveProcesses)),
  );
  const graceSeconds = Math.min(
    30 * 60,
    Math.max(0, Math.round(raw?.graceSeconds ?? d.graceSeconds)),
  );
  const scanIntervalMs = Math.min(
    10 * 60_000,
    Math.max(5_000, Math.round(raw?.scanIntervalMs ?? d.scanIntervalMs)),
  );
  return {
    enabled: raw?.enabled === undefined ? d.enabled : Boolean(raw.enabled),
    idleMinutes,
    maxLiveProcesses,
    graceSeconds,
    scanIntervalMs,
  };
}

export function streamingProcessReclaimPolicyFromConfig(config: StreamingProcessReclaimConfig): {
  enabled: boolean;
  idleMs: number;
  maxLiveProcesses: number;
  graceMs: number;
} {
  return {
    enabled: config.enabled,
    idleMs: config.idleMinutes * 60_000,
    maxLiveProcesses: config.maxLiveProcesses,
    graceMs: config.graceSeconds * 1000,
  };
}

let cachedConfig: StreamingProcessReclaimConfig | null = null;
let cachedConfigAtMs = 0;
const CONFIG_CACHE_TTL_MS = 60_000;

export function invalidateStreamingProcessReclaimConfigCache(): void {
  cachedConfig = null;
  cachedConfigAtMs = 0;
}

export async function loadStreamingProcessReclaimConfig(): Promise<StreamingProcessReclaimConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedConfigAtMs < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }
  const raw = await getAppSettingJson<Partial<StreamingProcessReclaimConfig>>(
    STREAMING_PROCESS_RECLAIM_SETTINGS_KEY,
  );
  const normalized = normalizeStreamingProcessReclaimConfig(raw);
  cachedConfig = normalized;
  cachedConfigAtMs = now;
  return normalized;
}

export async function saveStreamingProcessReclaimConfig(
  patch: Partial<StreamingProcessReclaimConfig>,
): Promise<StreamingProcessReclaimConfig> {
  const current = await loadStreamingProcessReclaimConfig();
  const next = normalizeStreamingProcessReclaimConfig({ ...current, ...patch });
  await setAppSettingJson(STREAMING_PROCESS_RECLAIM_SETTINGS_KEY, next);
  cachedConfig = next;
  cachedConfigAtMs = Date.now();
  return next;
}
