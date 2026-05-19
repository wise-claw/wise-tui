export type AssistantSource = "builtin" | "custom" | "extension";

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
}
