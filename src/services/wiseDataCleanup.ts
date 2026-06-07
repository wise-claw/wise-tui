import { invoke } from "@tauri-apps/api/core";

export interface WiseDataCategoryUsage {
  id: string;
  label: string;
  description: string;
  path: string;
  fileCount: number;
  byteSize: number;
  exists: boolean;
  /** 仍被会话引用的文件数（composer_images）。 */
  referencedFileCount?: number;
  /** 可安全自动回收的文件数（composer_images）。 */
  gcEligibleFileCount?: number;
  /** 可安全自动回收的字节数（composer_images）。 */
  gcEligibleByteSize?: number;
}

export interface WiseDataCleanupResult {
  categoryId: string;
  removedFiles: number;
  freedBytes: number;
}

export async function openWiseHomeDir(): Promise<void> {
  await invoke("open_wise_home_dir");
}

export async function listWiseDataCleanupCategories(): Promise<WiseDataCategoryUsage[]> {
  return invoke<WiseDataCategoryUsage[]>("list_wise_data_cleanup_categories");
}

export async function cleanupWiseDataCategories(
  categoryIds: string[],
): Promise<WiseDataCleanupResult[]> {
  return invoke<WiseDataCleanupResult[]>("cleanup_wise_data_categories", { categoryIds });
}

/** Composer + PRD 图片缓存（不含拆分快照与子进程配置）。 */
export const WISE_IMAGE_CLEANUP_CATEGORY_IDS = ["composer_images", "prd_images"] as const;
