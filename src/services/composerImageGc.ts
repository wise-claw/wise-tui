import { invoke } from "@tauri-apps/api/core";

export const COMPOSER_IMAGE_GC_SETTINGS_KEY = "wise.composerImageGc.v1";

export const DEFAULT_COMPOSER_IMAGE_GC_TTL_DAYS = 30;
export const DEFAULT_COMPOSER_IMAGE_GC_GRACE_HOURS = 24;
export const DEFAULT_COMPOSER_IMAGE_GC_MAX_MB = 500;

export interface ComposerImageGcConfig {
  ttlDays: number;
  graceHours: number;
  maxMb: number;
}

export interface ComposerImageGcStats {
  totalFiles: number;
  totalBytes: number;
  referencedFiles: number;
  referencedBytes: number;
  gcEligibleFiles: number;
  gcEligibleBytes: number;
}

export interface ComposerImageGcResult {
  scannedFiles: number;
  referencedFiles: number;
  removedFiles: number;
  freedBytes: number;
  remainingBytes: number;
}

function normalizeComposerImageGcConfig(raw: Partial<ComposerImageGcConfig> | null): ComposerImageGcConfig {
  const ttlDays = Math.min(365, Math.max(1, Math.round(raw?.ttlDays ?? DEFAULT_COMPOSER_IMAGE_GC_TTL_DAYS)));
  const graceHours = Math.min(168, Math.max(1, Math.round(raw?.graceHours ?? DEFAULT_COMPOSER_IMAGE_GC_GRACE_HOURS)));
  const maxMb = Math.min(10_240, Math.max(0, Math.round(raw?.maxMb ?? DEFAULT_COMPOSER_IMAGE_GC_MAX_MB)));
  return { ttlDays, graceHours, maxMb };
}

export function defaultComposerImageGcConfig(): ComposerImageGcConfig {
  return normalizeComposerImageGcConfig(null);
}

export async function getComposerImageGcConfig(): Promise<ComposerImageGcConfig> {
  try {
    const raw = await invoke<ComposerImageGcConfig>("get_composer_image_gc_config");
    return normalizeComposerImageGcConfig(raw);
  } catch {
    return defaultComposerImageGcConfig();
  }
}

export async function saveComposerImageGcConfig(
  config: ComposerImageGcConfig,
): Promise<ComposerImageGcConfig> {
  const normalized = normalizeComposerImageGcConfig(config);
  return invoke<ComposerImageGcConfig>("set_composer_image_gc_config", { config: normalized });
}

export async function getComposerImageGcStats(): Promise<ComposerImageGcStats> {
  return invoke<ComposerImageGcStats>("get_composer_image_gc_stats");
}

/** 回收无引用且超过保留期的 Composer 图片（后台调用，失败静默）。 */
export async function runComposerImageGc(): Promise<ComposerImageGcResult | null> {
  try {
    return await invoke<ComposerImageGcResult>("run_composer_image_gc_command");
  } catch {
    return null;
  }
}

let gcTimer: ReturnType<typeof setTimeout> | null = null;

/** 附图落盘后防抖触发 GC，避免频繁扫描。 */
export function scheduleComposerImageGc(delayMs = 30_000): void {
  if (gcTimer) clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    gcTimer = null;
    void runComposerImageGc();
  }, delayMs);
}
