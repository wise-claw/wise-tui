import type { AtMentionDefaultTarget } from "../constants/atMentionDefault";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeTerminalDispatchName } from "../services/terminalDispatch";

export type AtMentionPopoverOption = {
  type: "agent" | "team" | "file" | "command" | "execution_engine";
  name?: string;
  executionEngine?: SessionExecutionEngine;
};

function optionMatchesTarget(opt: AtMentionPopoverOption, target: AtMentionDefaultTarget): boolean {
  if (target.kind === "execution_engine") {
    return opt.type === "execution_engine" && opt.executionEngine === target.engine;
  }
  if (target.kind === "terminal") {
    const name = opt.name?.trim() ?? "";
    return (
      opt.type === "agent" &&
      normalizeTerminalDispatchName(name) === normalizeTerminalDispatchName(target.employeeName)
    );
  }
  return false;
}

/** @ 空查询打开时，将键盘焦点落到配置的默认执行环境或终端项。 */
export function resolveAtMentionSelectedIndex(
  options: readonly AtMentionPopoverOption[],
  target: AtMentionDefaultTarget,
): number {
  if (options.length === 0) return 0;
  const index = options.findIndex((opt) => optionMatchesTarget(opt, target));
  return index >= 0 ? index : 0;
}
