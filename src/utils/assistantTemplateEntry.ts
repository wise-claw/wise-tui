import type { AssistantEntry, AssistantEntryKind } from "../types/assistant";

export const ASSISTANT_ENTRY_KIND_OPTIONS: {
  value: AssistantEntryKind;
  label: string;
  description: string;
}[] = [
  {
    value: "conversation",
    label: "对话助手",
    description: "在 Cockpit 中打开对话，注入系统提示词与运行环境",
  },
  {
    value: "open_link",
    label: "打开链接",
    description: "点击后在系统默认浏览器中打开 http(s) 链接",
  },
  {
    value: "run_workflow",
    label: "执行工作流",
    description: "在仓库主会话中按所选团队工作流分发执行",
  },
  {
    value: "run_script",
    label: "执行脚本",
    description: "在仓库根目录通过 zsh -c 执行 Shell 命令或多行脚本",
  },
];

export function resolveAssistantEntryKind(
  assistant: Pick<AssistantEntry, "entryKind" | "source">,
): AssistantEntryKind {
  if (assistant.source !== "custom") return "conversation";
  const kind = assistant.entryKind;
  if (kind === "open_link" || kind === "run_workflow" || kind === "run_script") return kind;
  return "conversation";
}

export function assistantEntryKindLabel(kind: AssistantEntryKind): string {
  return ASSISTANT_ENTRY_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? "对话助手";
}

export function assistantEntryActionLabel(kind: AssistantEntryKind): string {
  switch (kind) {
    case "open_link":
      return "打开链接";
    case "run_workflow":
    case "run_script":
      return "执行";
    default:
      return "打开";
  }
}

export function isAssistantConversationEntry(
  assistant: Pick<AssistantEntry, "entryKind" | "source">,
): boolean {
  return resolveAssistantEntryKind(assistant) === "conversation";
}
