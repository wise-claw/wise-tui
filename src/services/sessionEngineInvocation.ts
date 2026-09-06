import { listen } from "@tauri-apps/api/event";
import {
  normalizeSessionExecutionEngine,
  type SessionExecutionEngine,
} from "../constants/sessionExecutionEngine";
import { claudeInvocationStreamEvents } from "../constants/claudeStreamEvents";
import { resolveClaudeCompleteSuccess } from "../utils/resolveClaudeCompleteSuccess";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import {
  cancelClaudeInvocation,
  executeClaudeCode,
  type ClaudeInvocationResult,
} from "./claude";
import { executeCodexCode, executeCodexRpcCode } from "./codex";
import { shutdownCodexRpc } from "./codexRpc";
import { executeCursorCode } from "./cursorAgentExecution";
import { executeOpencodeCode } from "./opencode";
import { executeQoderCode } from "./qoder";

/** 支持 oneshot 等待的引擎；Gemini 主会话派发尚未落地。 */
export function supportsSessionEngineOneshotWait(engine: SessionExecutionEngine): boolean {
  return (
    engine === "claude" ||
    engine === "codex" ||
    engine === "codex-rpc" ||
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
  tabSessionId?: string;
}): Promise<void> {
  const { engine, repositoryPath, prompt, model, invocationKey, tabSessionId } = input;
  switch (engine) {
    case "codex":
      await executeCodexCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
        undefined,
        undefined,
        true,
        true,
      );
      return;
    case "codex-rpc":
      await executeCodexRpcCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
        tabSessionId,
        undefined,
        "low",
        true,
      );
      return;
    case "cursor":
      await executeCursorCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
        tabSessionId,
      );
      return;
    case "opencode":
      await executeOpencodeCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
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
        true,
      );
      return;
    case "claude":
      // 提交信息等短任务不需要项目 hooks、记忆或 stdio 权限控制通道。
      await executeClaudeCode(
        repositoryPath,
        prompt,
        model,
        invocationKey,
        "oneshot",
        undefined,
        undefined,
        true,
      );
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
  const INVOCATION_OUTPUT_DRAIN_MS = 120;
  const timeoutMs = params.timeoutMs ?? 120_000;

  const {
    output: outputEvent,
    error: errorEvent,
    complete: completeEvent,
  } = claudeInvocationStreamEvents(invocationKey);

  let resolveDone!: (value: ClaudeInvocationResult) => void;
  let drainHandle: ReturnType<typeof setTimeout> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let completedSuccess: boolean | null = null;
  let disposed = false;
  let timedOut = false;
  let spawnStarted = false;
  const unlisteners: Array<() => void> = [];
  const donePromise = new Promise<ClaudeInvocationResult>((resolve) => {
    resolveDone = resolve;
  });
  const result = (success: boolean): ClaudeInvocationResult => ({
    success,
    outputLines: [...outputLines],
    errorLines: [...errorLines],
    invocationKey,
  });
  const cancelHost = async () => {
    try {
      if (engine === "codex-rpc") await shutdownCodexRpc(invocationKey);
      else await cancelClaudeInvocation(invocationKey);
    } catch {
      /* 超时结果不依赖取消 IPC 是否可用。 */
    }
  };
  const settle = (success: boolean) => {
    if (disposed) return;
    if (drainHandle != null) globalThis.clearTimeout(drainHandle);
    drainHandle = globalThis.setTimeout(() => {
      drainHandle = null;
      resolveDone(result(success));
    }, INVOCATION_OUTPUT_DRAIN_MS);
  };
  const capture = (lines: string[], payload: unknown) => {
    if (disposed || lines.length >= MAX_CAPTURED_LINES) return;
    const raw = typeof payload === "string" ? payload : String(payload ?? "");
    lines.push(raw.length > MAX_SINGLE_LINE_CHARS
      ? `${raw.slice(0, MAX_SINGLE_LINE_CHARS)}…[truncated]` : raw);
    if (completedSuccess !== null) settle(completedSuccess);
  };
  const attach = async <T>(eventName: string, handler: (payload: T) => void) => {
    if (disposed) return;
    const unlisten = await listen<T>(eventName, (event) => {
      if (!disposed) handler(event.payload);
    });
    // listen 的 IPC 也可能晚于超时返回，必须立即释放迟到的订阅。
    if (disposed) safeUnlisten(unlisten);
    else unlisteners.push(unlisten);
  };

  try {
    // 截止时间覆盖监听注册、启动 IPC 和输出等待；取消 IPC 卡住不能延长用户等待。
    timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      errorLines.push(`Invocation timeout after ${timeoutMs}ms (cancellation requested)`);
      resolveDone(result(false));
      if (spawnStarted) void cancelHost();
    }, timeoutMs);
    const start = (async () => {
      await attach<string>(outputEvent, (payload) => capture(outputLines, payload));
      await attach<string>(errorEvent, (payload) => capture(errorLines, payload));
      await attach<{ success?: boolean }>(completeEvent, (payload) => {
        if (completedSuccess !== null) return;
        completedSuccess = resolveClaudeCompleteSuccess(payload);
        settle(completedSuccess);
      });
      if (disposed || timedOut) return donePromise;
      spawnStarted = true;
      try {
        await spawnSessionEngineOneshot({
          engine,
          repositoryPath: params.repositoryPath,
          prompt: params.prompt,
          model: params.model,
          invocationKey,
          tabSessionId: invocationKey,
        });
      } finally {
        // 启动可能在首次取消之后才注册进程，迟到返回时再次回收同一 invocation。
        if (timedOut) void cancelHost();
      }
      return donePromise;
    })();
    return await Promise.race([donePromise, start]);
  } finally {
    disposed = true;
    if (timeoutHandle != null) globalThis.clearTimeout(timeoutHandle);
    if (drainHandle != null) globalThis.clearTimeout(drainHandle);
    unlisteners.forEach(safeUnlisten);
  }
}
