import type { EmployeeItem } from "../types";
import { applyComposerDefaultInstruction } from "./composerDefaultInstruction";
import type { DefaultInstructionResolveContext } from "./resolveComposerDefaultInstructionOutbound";
import {
  pickDefaultInstructionByPriority,
  resolveEffectiveDefaultInstructionApplied,
} from "./resolveEffectiveDefaultInstruction";

/** @终端 派发：为正文自动前缀终端 / 主会话默认指令。 */
export function resolveTerminalTaskPromptWithDefaults(
  taskPrompt: string,
  terminal: EmployeeItem,
  sessionDefaultInstruction?: string | null,
  resolveContext?: DefaultInstructionResolveContext,
): string {
  const cleaned = taskPrompt.trim();
  const prefix = pickDefaultInstructionByPriority(
    sessionDefaultInstruction,
    terminal.defaultInstruction,
  );
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
  return resolveEffectiveDefaultInstructionApplied(
    taskPrompt.trim(),
    {
      globalDefault: sessionDefaultInstruction,
      terminalDefault: terminal.defaultInstruction,
      dispatchTargetType: "employee",
    },
    resolveContext,
  );
}
