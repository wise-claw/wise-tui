/** 自动检查只保留版本信息，原生 Update 资源由检查任务负责释放。 */
export const APP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const APP_UPDATE_STARTUP_DELAY_MS = 10000;

export interface AppUpdateSummary {
  version: string;
  body?: string;
}

export function createAppUpdateAutoChecker(options: {
  check: () => Promise<AppUpdateSummary | null>;
  onAvailable: (update: AppUpdateSummary) => void;
  now?: () => number;
}) {
  let enabled = false;
  let stopped = false;
  let running = false;
  let lastAttempt: number | null = null;
  let notifiedVersion = "";
  const now = options.now ?? Date.now;

  return {
    setEnabled(value: boolean) { enabled = value; },
    stop() { stopped = true; },
    async tick() {
      if (stopped || !enabled || running) return;
      const time = now();
      if (lastAttempt !== null && time - lastAttempt < APP_UPDATE_CHECK_INTERVAL_MS) return;
      lastAttempt = time;
      running = true;
      try {
        const update = await options.check();
        if (!stopped && enabled && update && update.version !== notifiedVersion) {
          notifiedVersion = update.version;
          options.onAvailable(update);
        }
      } catch {
        // 后台检查失败保持安静，下一周期重试；手动检查显示具体错误。
      } finally { running = false; }
    },
  };
}
