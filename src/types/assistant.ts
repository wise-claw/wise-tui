export type AssistantSource = "builtin" | "custom" | "extension";

/**
 * 自定义助手模板的入口类型。
 *
 * - `dispatch_direct`（立即执行）：在仓库主会话上直接 `executeSession` 立即起 Claude Code 子进程，不入 workflow 队列。
 * - `run_workflow`（直接派发执行）：按所选工作流入队，由 leader worker 拉起。
 * - `run_script`：在仓库根目录通过 `zsh -c` 执行 Shell 脚本。
 * - `open_link`：在系统默认浏览器中打开 http(s) 链接。
 *
 * 内置/扩展助手未显式设置时统一 fallback 到 `dispatch_direct`。
 */
export type AssistantEntryKind = "dispatch_direct" | "run_workflow" | "run_script" | "open_link";

export interface AssistantEntry {
  id: string;
  source: AssistantSource;
  name: string;
  description: string;
  avatarColor: string | null;
  engineId: string;
  model: string | null;
  /** Pre-loaded for builtin/custom; null for extension (call get_system_prompt). */
  systemPrompt: string | null;
  /** Set only when source === "custom". */
  customId?: string;
  /** Set only when source === "extension". */
  extensionId?: string;
  /** Set only for extension assistants. */
  systemPromptPath?: string;
  builtIn?: boolean;
  tools?: string[];
  defaultWorkflows?: AssistantWorkflowRef[];
  defaultSkills?: AssistantBundleRef[];
  defaultMcps?: AssistantBundleRef[];
  /** 仅 custom 助手：入口类型，缺省为 conversation。 */
  entryKind?: AssistantEntryKind;
  /** entryKind === open_link */
  entryUrl?: string | null;
  /** entryKind === run_workflow */
  entryWorkflowId?: string | null;
  /** entryKind === run_script */
  entryScript?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantWorkflowRef {
  id: string;
  stage: string;
  label: string;
  description: string;
}

export interface AssistantBundleRef {
  id: string;
  label: string;
  sourcePath?: string;
}

export interface CustomAssistantInput {
  /** When set, edits the row with this id. Otherwise insert. */
  id?: string;
  name: string;
  description?: string;
  avatarColor?: string | null;
  engineId: string;
  systemPrompt?: string;
  model?: string | null;
  entryKind?: AssistantEntryKind;
  entryUrl?: string;
  entryWorkflowId?: string | null;
  entryScript?: string;
}
