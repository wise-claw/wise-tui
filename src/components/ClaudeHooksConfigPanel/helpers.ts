import type { ClaudeHookHandler } from "../../types";
import {
  EVENT_HELP_TEXT,
  type HookDisplayType,
  getDefaultDisplaySupportedTypes,
  getDefaultEditableSupportedTypes,
  getDisplaySupportedTypesMap,
} from "./constants";

export function getHelpTextByTitle(title: string, eventName?: string): string {
  if (title.includes("PostToolUse / PostToolUseFailure")) {
    return `${EVENT_HELP_TEXT.PostToolUse} ${EVENT_HELP_TEXT.PostToolUseFailure}`;
  }
  if (title.includes("SubagentStart / SubagentStop")) {
    return `${EVENT_HELP_TEXT.SubagentStart} ${EVENT_HELP_TEXT.SubagentStop}`;
  }
  if (title.includes("Stop / StopFailure")) {
    return `${EVENT_HELP_TEXT.Stop} ${EVENT_HELP_TEXT.StopFailure}`;
  }
  if (eventName) return EVENT_HELP_TEXT[eventName] ?? "该流程说明暂未配置。";
  return "该步骤用于表示 Claude Code 生命周期中的中间过程。";
}

export function getDisplaySupportedTypesByEvent(eventName?: string): HookDisplayType[] {
  if (!eventName) return getDefaultDisplaySupportedTypes();
  return getDisplaySupportedTypesMap()[eventName] ?? getDefaultDisplaySupportedTypes();
}

/** Wise 编辑器当前可创建的 hook 类型（不含 mcp_tool）。 */
export function getSupportedTypesByEvent(eventName?: string): ClaudeHookHandler["type"][] {
  if (!eventName) return getDefaultEditableSupportedTypes();
  return getDisplaySupportedTypesByEvent(eventName).filter(
    (type): type is ClaudeHookHandler["type"] => type !== "mcp_tool",
  );
}

export function getSupportedTypesText(eventName: string): string {
  return getDisplaySupportedTypesByEvent(eventName).join(" / ");
}

export function handlerSummary(h: ClaudeHookHandler): string {
  if (h.type === "command") return h.command?.trim() || "(空命令)";
  if (h.type === "http") return h.url?.trim() || "(空 URL)";
  return h.prompt?.trim() || "(空 prompt)";
}

function normalizeHookRelativePath(raw: string): string {
  let path = raw.trim().replace(/^['"]|['"]$/g, "");
  if (path.startsWith("./")) {
    path = path.slice(2);
  }
  if (!path || path.startsWith("/") || path.startsWith("~")) {
    return "";
  }
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function extractPathTokenFromCommand(command: string): string | null {
  const tokens = command.trim().split(/\s+/);
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.startsWith("-")) {
      continue;
    }
    const normalized = normalizeHookRelativePath(token);
    if (!normalized) {
      continue;
    }
    if (normalized.includes("/") || normalized.startsWith(".") || /\.[a-z0-9]+$/i.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

/** 从 command 处理器解析仓库内相对路径；无法解析时返回 null。 */
export function resolveHookHandlerTargetPath(
  handler: ClaudeHookHandler,
  matcher?: string | null,
): string | null {
  if (handler.type !== "command") {
    return null;
  }
  const command = handler.command?.trim() ?? "";
  if (!command) {
    return null;
  }
  const fromCommand = extractPathTokenFromCommand(command);
  if (fromCommand) {
    return fromCommand;
  }
  const matcherText = matcher?.trim();
  if (matcherText && matcherText !== "*") {
    if (matcherText.includes("/")) {
      return normalizeHookRelativePath(matcherText);
    }
    return `.claude/hooks/${matcherText}`;
  }
  return null;
}

