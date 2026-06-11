/** 内置助手 Brief 输入框占位示例（助手对话 / 产物工作区） */
export const BUILTIN_ASSISTANT_BRIEF_PLACEHOLDERS: Record<string, string> = {};

export function builtinAssistantBriefPlaceholder(assistantId: string): string {
  return (
    BUILTIN_ASSISTANT_BRIEF_PLACEHOLDERS[assistantId] ??
    "描述你的目标、输入文件或审查范围，助手会结合当前工作区执行。"
  );
}
