import { listen } from "@tauri-apps/api/event";
import {
  normalizeSessionExecutionEngine,
  type SessionExecutionEngine,
} from "../constants/sessionExecutionEngine";
import { resolveClaudeCompleteSuccess } from "../utils/resolveClaudeCompleteSuccess";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import {
  cancelClaudeInvocation,
  executeClaudeCode,
  type ClaudeInvocationResult,
} from "./claude";
import { executeCodexCode } from "./codex";
import { executeCursorCode } from "./cursorAgentExecution";
import { executeOpencodeCode } from "./opencode";
import { executeQoderCode } from "./qoder";

/** 支持 oneshot 等待的引擎；Gemini 主会话派发尚未落地。 */
export function supportsSessionEngineOneshotWait(engine: SessionExecutionEngine): boolean {
  return (
    engine === "claude" ||
    engine === "codex" ||
    engine === "cursor" ||
    engine === "opencode" ||
    engine === "qoder"
  );
}

async function spawnSessionEngineOneshot(input: {
  engine: SessionExecutionEngine;
  repositoryPath: string;
  prompt: string;
  model?: string;
  invocationKey: string;
}): Promise<void> {
  const { engine, repositoryPath, prompt, model, invocationKey } = input;
  switch (engine) {
    case "codex":
      await executeCodexCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
        undefined,
        undefined,
        undefined,
        true,
      );
      return;
    case "cursor":
      await executeCursorCode(repositoryPath, prompt, model, invocationKey);
      return;
    case "opencode":
      await executeOpencodeCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
        undefined,
        undefined,
        undefined,
        true,
      );
      return;
    case "qoder":
      await executeQoderCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
        undefined,
        undefined,
        undefined,
        true,
      );
      return;
    case "claude":
      await executeClaudeCode(repositoryPath, prompt, model, invocationKey, "oneshot");
      return;
    case "gemini":
      throw new Error("Gemini CLI 尚未支持 oneshot 调用");
    default: {
      const _exhaustive: never = engine;
      throw new Error(`未知执行引擎: ${_exhaustive}`);
    }
  }
}

/**
 * 按当前会话/仓库执行引擎启动 oneshot 子进程，并等待
 * `claude-*:invocation:{key}` 完成事件（各引擎共用该通道命名）。
 * 不含 OMC/streamUi；供 AI 润色提交信息等短任务使用。
 */
export async function executeSessionEngineAndWait(params: {
  executionEngine?: SessionExecutionEngine | null;
  repositoryPath: string;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  onInvocationKey?: (invocationKey: string) => void;
}): Promise<ClaudeInvocationResult> {
  const engine = normalizeSessionExecutionEngine(params.executionEngine);
  const invocationKey = crypto.randomUUID();
  params.onInvocationKey?.(invocationKey);

  if (!supportsSessionEngineOneshotWait(engine)) {
    return {
      success: false,
      outputLines: [],
      errorLines: [`${engine} 尚未支持 oneshot 润色`],
      invocationKey,
    };
  }

  const outputLines: string[] = [];
  const errorLines: string[] = [];
  const MAX_CAPTURED_LINES = 8000;
  const MAX_SINGLE_LINE_CHARS = 24_000;
  const timeoutMs = params.timeoutMs ?? 120_000;

  const outputEvent = `claude-output:invocation:${invocationKey}`;
  const errorEvent = `claude-error:invocation:${invocationKey}`;
  const completeEvent = `claude-complete:invocation:${invocationKey}`;

  let resolveDone: ((value: ClaudeInvocationResult) => void) | null = null;
  const donePromise = new Promise<ClaudeInvocationResult>((resolve) => {
    resolveDone = resolve;
  });

  const unlistenOutput = await listen<string>(outputEvent, (event) => {
    if (outputLines.length >= MAX_CAPTURED_LINES) return;
    const raw = typeof event.payload === "string" ? event.payload : String(event.payload ?? "");
    outputLines.push(
      raw.length > MAX_SINGLE_LINE_CHARS ? `${raw.slice(0, MAX_SINGLE_LINE_CHARS)}…[truncated]` : raw,
    );
  });
  const unlistenError = await listen<string>(errorEvent, (event) => {
    if (errorLines.length >= MAX_CAPTURED_LINES) return;
    const raw = typeof event.payload === "string" ? event.payload : String(event.payload ?? "");
    errorLines.push(
      raw.length > MAX_SINGLE_LINE_CHARS ? `${raw.slice(0, MAX_SINGLE_LINE_CHARS)}…[truncated]` : raw,
    );
  });
  const unlistenComplete = await listen<{ success?: boolean }>(completeEvent, (event) => {
    const success = resolveClaudeCompleteSuccess(event.payload);
    resolveDone?.({
      success,
      outputLines: [...outputLines],
      errorLines: [...errorLines],
      invocationKey,
    });
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    await spawnSessionEngineOneshot({
      engine,
      repositoryPath: params.repositoryPath,
      prompt: params.prompt,
      model: params.model,
      invocationKey,
    });

    const timeoutPromise = new Promise<ClaudeInvocationResult>((resolve) => {
      timeoutHandle = globalThis.setTimeout(() => {
        void (async () => {
          let cancelledHost = false;
          if (engine === "claude") {
            try {
              cancelledHost = await cancelClaudeInvocation(invocationKey);
            } catch {
              /* 非 Tauri 或命令失败：仍以超时结果为准 */
            }
          }
          const cancelHint =
            engine === "claude"
              ? cancelledHost
                ? "host subprocess terminated"
                : "host had no matching invocation child (IPC unavailable or already exited)"
              : `${engine} timeout without host cancel`;
          resolve({
            success: false,
            outputLines: [...outputLines],
            errorLines: [...errorLines, `Invocation timeout after ${timeoutMs}ms (${cancelHint})`],
            invocationKey,
          });
        })();
      }, timeoutMs);
    });

    return await Promise.race([donePromise, timeoutPromise]);
  } finally {
    if (timeoutHandle != null) globalThis.clearTimeout(timeoutHandle);
    safeUnlisten(unlistenOutput);
    safeUnlisten(unlistenError);
    safeUnlisten(unlistenComplete);
  }
}
