import type { ClaudeHookHandler } from "../../types";
import { EVENT_HELP_TEXT, getDefaultSupportedTypes, getSupportedTypesMap } from "./constants";

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

export function getSupportedTypesByEvent(eventName?: string): ClaudeHookHandler["type"][] {
  if (!eventName) return getDefaultSupportedTypes();
  return getSupportedTypesMap()[eventName] ?? getDefaultSupportedTypes();
}

export function getSupportedTypesText(eventName: string): string {
  return getSupportedTypesByEvent(eventName).join(" / ");
}

export function handlerSummary(h: ClaudeHookHandler): string {
  if (h.type === "command") return h.command?.trim() || "(空命令)";
  if (h.type === "http") return h.url?.trim() || "(空 URL)";
  return h.prompt?.trim() || "(空 prompt)";
}

