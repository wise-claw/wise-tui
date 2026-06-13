import type { EmployeeItem } from "../types";
import type { DefaultInstructionResolveContext } from "./resolveComposerDefaultInstructionOutbound";
import {
  resolveAppliedComposerDefaultInstruction,
  applyComposerDefaultInstruction,
} from "./composerDefaultInstruction";
import { resolveComposerDefaultInstructionOutbound } from "./resolveComposerDefaultInstructionOutbound";

/** @终端 派发：为正文自动前缀终端 / 主会话默认指令。 */
export function resolveTerminalTaskPromptWithDefaults(
  taskPrompt: string,
  terminal: EmployeeItem,
  sessionDefaultInstruction?: string | null,
  resolveContext?: DefaultInstructionResolveContext,
): string {
  const cleaned = taskPrompt.trim();
  const terminalDefault = terminal.defaultInstruction?.trim();
  const sessionDefault = sessionDefaultInstruction?.trim();
  const prefix = terminalDefault || sessionDefault || "";
  if (!prefix) return cleaned;
  return applyComposerDefaultInstruction(cleaned, prefix, resolveContext);
}

/** 终端 worker 气泡展示：解析会作用于该正文的默认指令（真实斜杠路径）。 */
export function resolveTerminalDefaultInstructionApplied(
  taskPrompt: string,
  terminal: EmployeeItem,
  sessionDefaultInstruction?: string | null,
  resolveContext?: DefaultInstructionResolveContext,
): string {
  const terminalDefault = terminal.defaultInstruction?.trim();
  const sessionDefault = sessionDefaultInstruction?.trim();
  const prefix = terminalDefault || sessionDefault || "";
  if (!prefix) return "";
  const applied = resolveAppliedComposerDefaultInstruction(
    taskPrompt.trim(),
    prefix,
    resolveContext,
  );
  if (applied) return applied;
  return resolveComposerDefaultInstructionOutbound(prefix, resolveContext);
}
