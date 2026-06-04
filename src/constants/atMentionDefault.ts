import {
  normalizeSessionExecutionEngine,
  SESSION_EXECUTION_ENGINE_LABELS,
  type SessionExecutionEngine,
} from "./sessionExecutionEngine";

export type AtMentionDefaultTarget =
  | { kind: "execution_engine"; engine: SessionExecutionEngine }
  | { kind: "terminal"; employeeName: string };

export const DEFAULT_AT_MENTION_DEFAULT_TARGET: AtMentionDefaultTarget = {
  kind: "execution_engine",
  engine: "claude",
};

export function normalizeAtMentionDefaultTarget(raw: unknown): AtMentionDefaultTarget {
  if (!raw || typeof raw !== "object") return DEFAULT_AT_MENTION_DEFAULT_TARGET;
  const record = raw as { kind?: unknown; engine?: unknown; employeeName?: unknown };
  if (record.kind === "terminal") {
    const employeeName = typeof record.employeeName === "string" ? record.employeeName.trim() : "";
    if (employeeName) return { kind: "terminal", employeeName };
  }
  if (record.kind === "execution_engine" || record.engine != null) {
    return {
      kind: "execution_engine",
      engine: normalizeSessionExecutionEngine(
        typeof record.engine === "string" ? record.engine : undefined,
      ),
    };
  }
  return DEFAULT_AT_MENTION_DEFAULT_TARGET;
}

/** 配置中心 Select 的 value 编码。 */
export function encodeAtMentionDefaultSelectValue(target: AtMentionDefaultTarget): string {
  if (target.kind === "terminal") {
    return `terminal:${target.employeeName}`;
  }
  return `execution_engine:${target.engine}`;
}

export function decodeAtMentionDefaultSelectValue(raw: string): AtMentionDefaultTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("terminal:")) {
    const employeeName = trimmed.slice("terminal:".length).trim();
    return employeeName ? { kind: "terminal", employeeName } : null;
  }
  if (trimmed.startsWith("execution_engine:")) {
    const engine = trimmed.slice("execution_engine:".length).trim();
    return engine
      ? { kind: "execution_engine", engine: normalizeSessionExecutionEngine(engine) }
      : null;
  }
  return null;
}

export function atMentionDefaultTargetLabel(target: AtMentionDefaultTarget): string {
  if (target.kind === "terminal") return target.employeeName;
  return SESSION_EXECUTION_ENGINE_LABELS[target.engine].title;
}

export function atMentionDefaultTargetsEqual(
  left: AtMentionDefaultTarget,
  right: AtMentionDefaultTarget,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "terminal") {
    return (
      right.kind === "terminal" &&
      left.employeeName.trim() === right.employeeName.trim()
    );
  }
  return right.kind === "execution_engine" && left.engine === right.engine;
}

export function atMentionDefaultTargetFromSlashOption(input: {
  type: string;
  name?: string;
  executionEngine?: SessionExecutionEngine;
}): AtMentionDefaultTarget | null {
  if (input.type === "execution_engine" && input.executionEngine) {
    return { kind: "execution_engine", engine: input.executionEngine };
  }
  const terminalName = input.name?.trim() ?? "";
  if (input.type === "agent" && terminalName) {
    return { kind: "terminal", employeeName: terminalName };
  }
  return null;
}

export function isSlashOptionAtMentionDefault(
  input: { type: string; name?: string; executionEngine?: SessionExecutionEngine },
  target: AtMentionDefaultTarget,
): boolean {
  const mapped = atMentionDefaultTargetFromSlashOption(input);
  if (!mapped) return false;
  return atMentionDefaultTargetsEqual(mapped, target);
}
