import type { AssistantEntry, AssistantEntryKind } from "../types/assistant";
import {
  normalizeScheduledTaskScriptFilePath,
  shellSingleQuoteForZsh,
} from "./scheduledTaskScript";

export const ASSISTANT_ENTRY_KIND_OPTIONS: {
  value: AssistantEntryKind;
  label: string;
  description: string;
}[] = [
  {
    value: "dispatch_direct",
    label: "立即执行",
    description: "在仓库主会话上直接 executeSession 立即起 Claude Code（不入 workflow 队列）",
  },
  {
    value: "run_workflow",
    label: "直接派发执行",
    description: "选择团队工作流时按所选入队（leader worker 拉起）；不选工作流时与「立即执行」等价",
  },
  {
    value: "run_script",
    label: "执行脚本",
    description: "在仓库根目录通过 zsh 执行内联脚本或仓库内脚本文件",
  },
  {
    value: "open_link",
    label: "打开链接",
    description: "点击后在系统默认浏览器中打开 http(s) 链接",
  },
];

export function resolveAssistantEntryKind(
  assistant: Pick<AssistantEntry, "entryKind" | "source">,
): AssistantEntryKind {
  if (assistant.source !== "custom") return "dispatch_direct";
  const kind = assistant.entryKind;
  if (
    kind === "dispatch_direct" ||
    kind === "run_workflow" ||
    kind === "run_script" ||
    kind === "open_link"
  ) {
    return kind;
  }
  return "dispatch_direct";
}

export function assistantEntryKindLabel(kind: AssistantEntryKind): string {
  return ASSISTANT_ENTRY_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? "立即执行";
}

export function assistantEntryActionLabel(kind: AssistantEntryKind): string {
  switch (kind) {
    case "open_link":
      return "打开链接";
    case "run_workflow":
      return "派发执行";
    case "run_script":
      return "执行";
    case "dispatch_direct":
      return "立即执行";
    default:
      return "立即执行";
  }
}

/**
 * @deprecated 助手模板不再支持 conversation 形态；该函数保留仅为外部零散引用兜底，
 * 始终返回 `false`。请改用 `resolveAssistantEntryKind` 直接判定具体入口类型。
 */
export function isAssistantConversationEntry(
  _assistant: Pick<AssistantEntry, "entryKind" | "source">,
): boolean {
  return false;
}

/** 执行前规范化脚本：弯引号→直引号、去 BOM、剥 markdown 代码块外壳。 */
export function normalizeAssistantEntryScript(raw: string): string {
  let script = raw.replace(/\uFEFF/g, "").trim();
  script = script
    .replace(/[\u201C\u201D\u201E\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u2032\u2035]/g, "'");
  const fenceMatch = script.match(/^```(?:bash|sh|zsh|shell)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenceMatch?.[1] != null) {
    script = fenceMatch[1].trim();
  }
  return script;
}

export type AssistantRunScriptSource = "inline" | "file";

export function resolveAssistantRunScriptSource(
  assistant: Pick<AssistantEntry, "entryScript" | "entryScriptFilePath">,
): AssistantRunScriptSource {
  return normalizeScheduledTaskScriptFilePath(assistant.entryScriptFilePath) ? "file" : "inline";
}

export type ResolveAssistantRunScriptCommandResult =
  | { ok: true; command: string; mode: AssistantRunScriptSource; scriptFilePath?: string }
  | { ok: false; reason: string };

/**
 * 组装助手模板 run_script 的后台命令：
 * - 有合法仓库相对路径时：在仓库根用 zsh 执行该文件；
 * - 否则：把 `entryScript` 当作内联 shell（与历史行为一致）。
 */
export function resolveAssistantRunScriptCommand(
  assistant: Pick<AssistantEntry, "entryScript" | "entryScriptFilePath">,
): ResolveAssistantRunScriptCommandResult {
  const scriptFilePath = normalizeScheduledTaskScriptFilePath(assistant.entryScriptFilePath);
  if (scriptFilePath) {
    return {
      ok: true,
      mode: "file",
      scriptFilePath,
      command: `zsh -- ${shellSingleQuoteForZsh(`./${scriptFilePath}`)}`,
    };
  }
  const inline = normalizeAssistantEntryScript(assistant.entryScript ?? "");
  if (!inline) {
    return { ok: false, reason: "脚本内容为空" };
  }
  return { ok: true, mode: "inline", command: inline };
}