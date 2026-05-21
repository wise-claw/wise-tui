import { DEFAULT_PRD_SPLIT_ASSISTANT_ID } from "../services/assistantPromptLayers";

/** 会话快捷条「更多」与助手 Hub 一致的内置助手目录。 */
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
  {
    id: "builtin:excel-data",
    menuLabel: "Excel 数据助手",
  },
  {
    id: "builtin:code-review",
    menuLabel: "代码审查助手",
  },
  {
    id: "builtin:tech-docs",
    menuLabel: "技术文档助手",
  },
  {
    id: "builtin:test-gen",
    menuLabel: "测试生成助手",
  },
  {
    id: "builtin:release-notes",
    menuLabel: "发布说明助手",
  },
] as const;

export type SessionQuickBuiltinAssistantId =
  (typeof SESSION_QUICK_BUILTIN_ASSISTANTS)[number]["id"];

/** 研发向内置助手（助手 Hub「研发助手」分区） */
export const ENGINEERING_BUILTIN_ASSISTANT_IDS: ReadonlySet<SessionQuickBuiltinAssistantId> =
  new Set([
    "builtin:excel-data",
    "builtin:code-review",
    "builtin:tech-docs",
    "builtin:test-gen",
    "builtin:release-notes",
  ]);

export function isEngineeringBuiltinAssistantId(
  id: string,
): id is SessionQuickBuiltinAssistantId {
  return ENGINEERING_BUILTIN_ASSISTANT_IDS.has(id as SessionQuickBuiltinAssistantId);
}

export function isSessionQuickBuiltinAssistantId(
  id: string,
): id is SessionQuickBuiltinAssistantId {
  return SESSION_QUICK_BUILTIN_ASSISTANTS.some((row) => row.id === id);
}
