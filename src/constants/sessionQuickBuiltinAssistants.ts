import { DEFAULT_PRD_SPLIT_ASSISTANT_ID } from "../services/assistantPromptLayers";

/** 会话快捷条「更多」与助手 Hub 一致的内置助手目录。 */
export const SESSION_QUICK_BUILTIN_ASSISTANTS = [
  {
    id: DEFAULT_PRD_SPLIT_ASSISTANT_ID,
    menuLabel: "需求拆分助手",
  },
] as const;

export type SessionQuickBuiltinAssistantId =
  (typeof SESSION_QUICK_BUILTIN_ASSISTANTS)[number]["id"];

export function isSessionQuickBuiltinAssistantId(
  id: string,
): id is SessionQuickBuiltinAssistantId {
  return SESSION_QUICK_BUILTIN_ASSISTANTS.some((row) => row.id === id);
}
