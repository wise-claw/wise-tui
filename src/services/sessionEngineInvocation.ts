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
  const INVOCATION_OUTPUT_DRAIN_MS = 80;
  const timeoutMs = params.timeoutMs ?? 120_000;

  const {
    output: outputEvent,
    error: errorEvent,
    complete: completeEvent,
  } = claudeInvocationStreamEvents(invocationKey);

  let resolveDone: ((value: ClaudeInvocationResult) => void) | null = null;
  let drainHandle: ReturnType<typeof setTimeout> | null = null;
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
    // complete 与 output 走不同事件名，短 oneshot 可能先完成再送达最后一行正文。
    drainHandle = globalThis.setTimeout(() => {
      drainHandle = null;
      resolveDone?.({
        success,
        outputLines: [...outputLines],
        errorLines: [...errorLines],
        invocationKey,
      });
    }, INVOCATION_OUTPUT_DRAIN_MS);
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    await spawnSessionEngineOneshot({
      engine,
      repositoryPath: params.repositoryPath,
      prompt: params.prompt,
      model: params.model,
      invocationKey,
      // Codex RPC 的取消以 session id 定位；短任务直接复用 invocation key，
      // 其它引擎也因此获得独立且可追踪的运行槽位。
      tabSessionId: invocationKey,
    });

    const timeoutPromise = new Promise<ClaudeInvocationResult>((resolve) => {
      timeoutHandle = globalThis.setTimeout(() => {
        void (async () => {
          let cancelledHost = false;
          try {
            if (engine === "codex-rpc") {
              await shutdownCodexRpc(invocationKey);
              cancelledHost = true;
            } else {
              // 此命令使用所有 CLI 引擎共享的 invocation 子进程注册表，
              // 名称虽沿用 Claude，实际也可终止 Codex/Cursor/OpenCode/Qoder。
              cancelledHost = await cancelClaudeInvocation(invocationKey);
            }
          } catch {
            /* 非 Tauri、已结束或命令失败：仍以超时结果为准 */
          }
          const cancelHint = cancelledHost
            ? "execution terminated"
            : "no matching execution found (IPC unavailable or already exited)";
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
    if (drainHandle != null) globalThis.clearTimeout(drainHandle);
    safeUnlisten(unlistenOutput);
    safeUnlisten(unlistenError);
    safeUnlisten(unlistenComplete);
  }
}
