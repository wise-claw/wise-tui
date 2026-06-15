import type { EmployeeItem } from "../types";
import {
  plainBodyHasExplicitSlashCommand,
  resolveAppliedComposerDefaultInstruction,
  splitLeadingAtMentionPrefix,
  type ComposerSendDispatchTargetType,
} from "./composerDefaultInstruction";
import type { DefaultInstructionResolveContext } from "./resolveComposerDefaultInstructionOutbound";

/** 提取将接受默认指令的正文段（去掉开头 @ 对象前缀）。 */
export function resolveDefaultInstructionBody(plain: string): string {
  const trimmed = plain.trim();
  if (!trimmed) return "";
  const { mentionPrefix, body } = splitLeadingAtMentionPrefix(trimmed);
  return mentionPrefix ? body : trimmed;
}

/** 终端默认指令优先于全局默认指令。 */
export function pickDefaultInstructionByPriority(
  globalDefault?: string | null,
  terminalDefault?: string | null,
): string {
  const terminal = terminalDefault?.trim() || "";
  const global = globalDefault?.trim() || "";
  return terminal || global;
}

export function resolveEffectiveDefaultInstructionConfig(
  plain: string,
  opts: {
    globalDefault?: string | null;
    terminalDefault?: string | null;
    dispatchTargetType?: ComposerSendDispatchTargetType;
  },
): string {
  const body = resolveDefaultInstructionBody(plain);
  if (plainBodyHasExplicitSlashCommand(body)) return "";

  const { globalDefault, terminalDefault, dispatchTargetType = "main" } = opts;
  if (dispatchTargetType === "employee") {
    return pickDefaultInstructionByPriority(globalDefault, terminalDefault);
  }
  return globalDefault?.trim() || "";
}

export function resolveEffectiveDefaultInstructionApplied(
  plain: string,
  opts: {
    globalDefault?: string | null;
    terminalDefault?: string | null;
    dispatchTargetType?: ComposerSendDispatchTargetType;
  },
  resolveContext?: DefaultInstructionResolveContext,
): string {
  const config = resolveEffectiveDefaultInstructionConfig(plain, opts);
  if (!config) return "";
  return resolveAppliedComposerDefaultInstruction(plain, config, resolveContext);
}

export function resolveTerminalDefaultInstructionForEmployee(
  employees: readonly EmployeeItem[] | undefined,
  targetEmployeeName?: string,
): string {
  const name = targetEmployeeName?.trim();
  if (!name || !employees?.length) return "";
  const hit = employees.find((item) => item.enabled && item.name.trim() === name);
  return hit?.defaultInstruction?.trim() || "";
}

/**
 * 主会话 composer 发送时传给 buildClaudeComposerSendPayload 的默认指令前缀。
 * @终端 派发不在 composer 层前缀，由 terminalDispatch 按优先级处理。
 */
export function resolveComposerSendDefaultInstructionPrefix(
  plain: string,
  globalDefaultInstruction: string,
  dispatchTargetType: ComposerSendDispatchTargetType,
  terminalDefault?: string | null,
): string {
  if (dispatchTargetType === "employee") return "";
  return resolveEffectiveDefaultInstructionConfig(plain, {
    globalDefault: globalDefaultInstruction,
    terminalDefault,
    dispatchTargetType,
  });
}

/** 主会话 composer 发送气泡上展示的已应用默认指令（@终端 由 worker 气泡单独解析）。 */
export function resolveComposerSendDefaultInstructionApplied(
  plain: string,
  globalDefaultInstruction: string,
  dispatchTargetType: ComposerSendDispatchTargetType,
  resolveContext?: DefaultInstructionResolveContext,
  terminalDefault?: string | null,
): string {
  if (dispatchTargetType === "employee") return "";
  return resolveEffectiveDefaultInstructionApplied(
    plain,
    {
      globalDefault: globalDefaultInstruction,
      terminalDefault,
      dispatchTargetType,
    },
    resolveContext,
  );
}
