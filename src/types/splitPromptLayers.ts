/**
 * PRD 拆分提示词分层存储（spec §3 T1），与 `splitPromptTemplate.ts` 渲染器配合。
 * 合并顺序：代码平台默认 → `app_settings.split_prompt_layers:platform_default`（迁移种子）
 * → 项目层 → 仓库层；后者非空字段覆盖前者。
 */

export const SPLIT_PROMPT_STANDARD_VARIABLES = [
  "PRD_MARKDOWN",
  "REQUIREMENTS_INDEX_JSON",
  "REPO_CONTEXT_JSON",
  "OUTPUT_SCHEMA_REF",
] as const;

export type SplitPromptStandardVariable = (typeof SPLIT_PROMPT_STANDARD_VARIABLES)[number];

/** 单作用域（项目或仓库）内持久化的分层模板。 */
export interface SplitPromptTemplateLayers {
  templateId: string;
  version: string;
  /** 为 false 时该层不生效，回退为平台默认整段提示词。 */
  enabled: boolean;
  /** 系统/角色层 */
  systemBody: string;
  /** 仓库策略层（前/后端侧重点、目录约定等） */
  repoStrategyBody: string;
  /** 用户模板层，须包含标准占位符 */
  userBody: string;
  /** 声明占位符，供 UI 与审计展示 */
  variables: readonly string[];
}
