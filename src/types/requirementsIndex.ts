/**
 * requirements-index.json 逻辑模型（spec §4.1 / I1），与 `.task/requirements-index.schema.json` 一致。
 * 任务侧 `sourceRequirementIds[]` 必须引用此处存在的 `id`。
 */

export const REQUIREMENTS_INDEX_SCHEMA_VERSION = 1 as const;

export interface RequirementsIndexEntry {
  id: string;
  content: string;
  start: number;
  end: number;
}

export interface RequirementsIndex {
  version: typeof REQUIREMENTS_INDEX_SCHEMA_VERSION;
  /** 物化到磁盘时由后端注入；纯前端 bundle 可不填。 */
  runId?: string;
  requirements: RequirementsIndexEntry[];
}
