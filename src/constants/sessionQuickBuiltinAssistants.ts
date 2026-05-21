import { DEFAULT_PRD_SPLIT_ASSISTANT_ID } from "../services/assistantPromptLayers";

/** 会话快捷条「更多」中直接打开的 3 个内置助手（与助手 Hub 卡片一致）。 */
export const SESSION_QUICK_BUILTIN_ASSISTANTS = [
  {
    id: DEFAULT_PRD_SPLIT_ASSISTANT_ID,
    menuLabel: "需求拆分助手",
  },
  {
    id: "builtin:word-doc",
    menuLabel: "Word 文档助手",
  },
  {
    id: "builtin:ppt-deck",
    menuLabel: "PPT 演示助手",
  },
] as const;

export type SessionQuickBuiltinAssistantId =
  (typeof SESSION_QUICK_BUILTIN_ASSISTANTS)[number]["id"];
