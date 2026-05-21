import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import { DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES } from "../constants/directBatchInvocationLog";
import {
  extractInitSessionIdFromInvocationStdoutLines,
  parseStreamLineSessionId,
} from "./claudeStreamParser";
import {
  computeOmcDirectBatchFailurePreviewLine,
  computeOmcDirectBatchPreviewLine,
} from "../utils/claudeInvocationText";
import { resolveClaudeCompleteSuccess } from "../utils/resolveClaudeCompleteSuccess";
import {
  WORKFLOW_UI_EVENT_INVOCATION_STREAM,
  type WorkflowInvocationStreamDetail,
} from "../constants/workflowUiEvents";
import { persistDirectBatchInvocationSnapshotForAnchorSession } from "./backgroundInvocationSnapshot";
import type {
  ClaudeConnectionMode,
  ClaudeHooksStatusResponse,
  ClaudeHookSourceScope,
  ClaudeHookUpsertPayload,
  ClaudeMcpAddPayload,
  ClaudeMcpRuntimeHealthEntry,
  ClaudeMcpStatusResponse,
  ClaudeProjectSkill,
  ClaudeProjectSkillFileEntry,
  ClaudeSubagentDetail,
  ClaudeSubagentItem,
  ClaudeSubagentScope,
  ClaudeSessionInfo,
} from "../types";

export async function executeClaudeCode(
  repositoryPath: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  /** 默认 oneshot：每轮独立子进程，支持多标签/多员工并发；persistent 为全局单槽位（会互杀）。 */
  connectionMode: ClaudeConnectionMode = "oneshot",
  /** 与侧栏一致的后台 spawn 槽位 key（`projectId:repositoryId`）；省略则不在 Rust 侧计数。 */
  concurrencyScopeKey?: string,
  concurrencyLimit?: number,
  /** 为 true 时追加 `--bare`，减少 hooks/记忆等对编排子进程的粘连 */
  bare?: boolean,
  trellisContextId?: string,
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  return invoke("execute_claude_code", {
    projectPath: repositoryPath,
    prompt,
    model,
    invocationKey,
    connectionMode,
    concurrencyScopeKey,
    concurrencyLimit,
    bare: bare ?? false,
    trellisContextId: normalizedTrellisContextId,
  });
}

export interface ClaudeInvocationResult {
  success: boolean;
  outputLines: string[];
  errorLines: string[];
  /** 与 Tauri `claude-output:invocation:{key}` 等事件一致；便于 OMC 员工侧关联子进程 */
  invocationKey?: string;
}

/** 直连批量 OMC：子进程 stdout 极密；环形缓冲容量与落盘 `MAX_DIRECT_BATCH_SNAPSHOT_STDOUT` 对齐（见 `directBatchInvocationLog`）。 */
const DIRECT_BATCH_LINE_RING_CAP = DIRECT_BATCH_INVOCATION_STDOUT_RETENTION_LINES;
const DIRECT_BATCH_MAX_LINE_CHARS = 8_000;
/** 仅在 `started` 上报一次，供侧栏 Drawer 展示派发正文；与快照存储上限同量级 */
const DIRECT_BATCH_DISPATCH_PROMPT_UI_MAX_CHARS = 100_000;

interface InvocationLineRing {
  cap: number;
  buf: string[];
  n: number;
}

/** 进行中直连批量子进程：详情抽屉晚订阅 Tauri 事件时仍可从与 `executeClaudeCodeAndWait` 相同的环形缓冲读取已产生的 stdout/stderr */
const directBatchInvocationRingByKey = new Map<string, { out: InvocationLineRing; err: InvocationLineRing }>();

/**
 * 读取当前仍在执行的直连批量 `invocationKey` 对应的环形缓冲快照（子进程结束后 Map 已删则返回空数组）。
 * 供 `OmcDirectBatchInvocationDetailDrawer` 与 `useClaudeInvocationLiveOutput` 合并，避免「打开执行记录后会话被清空」。
 */
export function peekDirectBatchInvocationRingSnapshot(invocationKey: string): {
  stdoutLines: string[];
  stderrLines: string[];
} {
  const k = typeof invocationKey === "string" ? invocationKey.trim() : "";
  if (!k) return { stdoutLines: [], stderrLines: [] };
  const hit = directBatchInvocationRingByKey.get(k);
  if (!hit) return { stdoutLines: [], stderrLines: [] };
  return {
    stdoutLines: invocationLineRingToOrdered(hit.out),
    stderrLines: invocationLineRingToOrdered(hit.err),
  };
}

function createInvocationLineRing(cap: number): InvocationLineRing {
  return { cap, buf: new Array(cap), n: 0 };
}

function invocationLineRingPush(ring: InvocationLineRing, line: string): void {
  ring.buf[ring.n % ring.cap] = line;
  ring.n += 1;
}

function invocationLineRingToOrdered(ring: InvocationLineRing): string[] {
  const count = Math.min(ring.n, ring.cap);
  if (count === 0) return [];
  if (ring.n <= ring.cap) {
    return ring.buf.slice(0, ring.n);
  }
  const out: string[] = new Array(count);
  const start = ring.n - count;
  for (let i = 0; i < count; i++) {
    out[i] = ring.buf[(start + i) % ring.cap]!;
  }
  return out;
}

function dispatchInvocationStreamUi(detail: WorkflowInvocationStreamDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_INVOCATION_STREAM, { detail }));
}

type ClaudeInvocationStreamUi = Omit<
  WorkflowInvocationStreamDetail,
  | "phase"
  | "invocationKey"
  | "lineCount"
  | "errCount"
  | "previewLine"
  | "success"
  | "dispatchPrompt"
  | "subprocessSessionId"
>;

type InvocationStreamAttribution = Pick<
  WorkflowInvocationStreamDetail,
  | "ownerKind"
  | "ownerRepositoryId"
  | "ownerRepositoryName"
  | "ownerRepositoryPath"
  | "repositoryType"
  | "stage"
  | "subagentType"
>;

function invocationStreamAttribution(streamUi: ClaudeInvocationStreamUi): InvocationStreamAttribution {
  return {
    ownerKind: streamUi.ownerKind,
    ownerRepositoryId: streamUi.ownerRepositoryId,
    ownerRepositoryName: streamUi.ownerRepositoryName,
    ownerRepositoryPath: streamUi.ownerRepositoryPath,
    repositoryType: streamUi.repositoryType,
    stage: streamUi.stage,
    subagentType: streamUi.subagentType,
  };
}

export async function executeClaudeCodeAndWait(params: {
  repositoryPath: string;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  connectionMode?: ClaudeConnectionMode;
  concurrencyScopeKey?: string;
  concurrencyLimit?: number;
  /** 透传 `executeClaudeCode`：编排/OMC 子进程建议 true */
  bare?: boolean;
  /** 若提供，则向会话 UI 派发轻量进度事件（右下角摘要），不写入主聊天 */
  streamUi?: ClaudeInvocationStreamUi;
}): Promise<ClaudeInvocationResult> {
  const invocationKey = crypto.randomUUID();
  const outputLines: string[] = [];
  const errorLines: string[] = [];
  /** 防止子进程海量流式行撑爆内存与主线程（仍足够解析 OMC_RESULT） */
  const MAX_CAPTURED_LINES = 8000;
  const MAX_SINGLE_LINE_CHARS = 24_000;
  const timeoutMs = params.timeoutMs ?? 120_000;
  const streamUi = params.streamUi;
  const isDirectBatchStream = streamUi?.omcInvocationSource === "direct_batch";
  const directOutRing = isDirectBatchStream ? createInvocationLineRing(DIRECT_BATCH_LINE_RING_CAP) : null;
  const directErrRing = isDirectBatchStream ? createInvocationLineRing(DIRECT_BATCH_LINE_RING_CAP) : null;
  if (isDirectBatchStream && directOutRing && directErrRing) {
    directBatchInvocationRingByKey.set(invocationKey, { out: directOutRing, err: directErrRing });
  }

  function persistDirectBatchSnapshotIfNeeded(success: boolean, outSnap: string[], errSnap: string[]): void {
    if (!streamUi || !isDirectBatchStream) return;
    void persistDirectBatchInvocationSnapshotForAnchorSession({
      anchorSessionId: streamUi.sessionId,
      repositoryPath: streamUi.repositoryPath,
      invocationKey,
      taskId: streamUi.taskId,
      templateId: streamUi.templateId,
      attempt: streamUi.attempt,
      stdoutLines: outSnap,
      stderrLines: errSnap,
      success,
      dispatchPromptRaw: typeof params.prompt === "string" ? params.prompt : undefined,
    }).catch(() => {
      /* 持久化失败不阻塞 invoke 流程 */
    });
  }
  const PROGRESS_EMIT_MS = 480;
  let lastProgressEmit = 0;

  const outputEvent = `claude-output:invocation:${invocationKey}`;
  const errorEvent = `claude-error:invocation:${invocationKey}`;
  const completeEvent = `claude-complete:invocation:${invocationKey}`;

  let resolveDone: ((value: ClaudeInvocationResult) => void) | null = null;
  const donePromise = new Promise<ClaudeInvocationResult>((resolve) => {
    resolveDone = resolve;
  });

  function snapshotOutputLines(): string[] {
    if (directOutRing) return invocationLineRingToOrdered(directOutRing);
    return [...outputLines];
  }
  function snapshotErrorLines(): string[] {
    if (directErrRing) return invocationLineRingToOrdered(directErrRing);
    return [...errorLines];
  }

  function emitProgress(force: boolean): void {
    if (!streamUi || isDirectBatchStream) return;
    const now = Date.now();
    if (!force && now - lastProgressEmit < PROGRESS_EMIT_MS) return;
    lastProgressEmit = now;
    const previewLine = outputLines.length > 0 ? outputLines[outputLines.length - 1] : undefined;
    // 不在 progress 上附带完整 prompt，避免高频事件体积过大
    dispatchInvocationStreamUi({
      phase: "progress",
      invocationKey,
      sessionId: streamUi.sessionId,
      repositoryPath: streamUi.repositoryPath,
      omcInvocationSource: streamUi.omcInvocationSource,
      taskId: streamUi.taskId,
      ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
      templateId: streamUi.templateId,
      attempt: streamUi.attempt,
      ...invocationStreamAttribution(streamUi),
      lineCount: outputLines.length,
      errCount: errorLines.length,
      previewLine: previewLine && previewLine.length > 160 ? `${previewLine.slice(0, 160)}…` : previewLine,
    });
  }

  /**
   * 直连批量：仍不派发 progress（避免 digest 洪泛）；派发轻量 started/complete 供侧栏 OMC 员工「进行中」
   * 列表与 `omcDirectBatchInvocationsStore` 更新。`BackgroundInvocationDock` 忽略 `omcInvocationSource === "direct_batch"`，
   * 避免为 oneshot 再挂 Tauri 逐行监听拖死主线程；子进程结束时由 `persistDirectBatchInvocationSnapshotForAnchorSession` 写入锚点会话快照供事后回溯。
   */
  if (streamUi && !isDirectBatchStream) {
    dispatchInvocationStreamUi({
      phase: "started",
      invocationKey,
      sessionId: streamUi.sessionId,
      repositoryPath: streamUi.repositoryPath,
      omcInvocationSource: streamUi.omcInvocationSource,
      taskId: streamUi.taskId,
      ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
      templateId: streamUi.templateId,
      attempt: streamUi.attempt,
      ...invocationStreamAttribution(streamUi),
      lineCount: 0,
      errCount: 0,
      ...(params.prompt !== undefined ? { dispatchPrompt: params.prompt } : {}),
    });
  } else if (streamUi && isDirectBatchStream) {
    const rawPrompt = typeof params.prompt === "string" ? params.prompt : "";
    const dispatchPrompt =
      rawPrompt.length > DIRECT_BATCH_DISPATCH_PROMPT_UI_MAX_CHARS
        ? `${rawPrompt.slice(0, DIRECT_BATCH_DISPATCH_PROMPT_UI_MAX_CHARS)}\n\n…[truncated for UI]`
        : rawPrompt;
    dispatchInvocationStreamUi({
      phase: "started",
      invocationKey,
      sessionId: streamUi.sessionId,
      repositoryPath: streamUi.repositoryPath,
      omcInvocationSource: "direct_batch",
      taskId: streamUi.taskId,
      ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
      templateId: streamUi.templateId,
      attempt: streamUi.attempt,
      ...invocationStreamAttribution(streamUi),
      lineCount: 0,
      errCount: 0,
      ...(dispatchPrompt.trim().length > 0 ? { dispatchPrompt } : {}),
    });
  }

  let directBatchSubprocessSidDispatched = false;
  const unlistenOutput = await listen<string>(outputEvent, (event) => {
    if (directOutRing) {
      const pl = event.payload;
      const raw = typeof pl === "string" ? pl : String(pl ?? "");
      const line =
        raw.length > DIRECT_BATCH_MAX_LINE_CHARS
          ? `${raw.slice(0, DIRECT_BATCH_MAX_LINE_CHARS)}…[truncated]`
          : raw;
      invocationLineRingPush(directOutRing, line);
      if (
        streamUi &&
        isDirectBatchStream &&
        !directBatchSubprocessSidDispatched &&
        typeof streamUi.sessionId === "string"
      ) {
        const sid =
          parseStreamLineSessionId(line)?.trim() ||
          extractInitSessionIdFromInvocationStdoutLines([line])?.trim() ||
          "";
        if (sid.length > 0) {
          directBatchSubprocessSidDispatched = true;
          const outSnap = snapshotOutputLines();
          const errSnap = snapshotErrorLines();
          dispatchInvocationStreamUi({
            phase: "progress",
            invocationKey,
            sessionId: streamUi.sessionId,
            repositoryPath: streamUi.repositoryPath,
            omcInvocationSource: "direct_batch",
            ...(streamUi.taskId?.trim() ? { taskId: streamUi.taskId.trim() } : {}),
            ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
            ...(streamUi.templateId?.trim() ? { templateId: streamUi.templateId.trim() } : {}),
            ...(typeof streamUi.attempt === "number" ? { attempt: streamUi.attempt } : {}),
            ...invocationStreamAttribution(streamUi),
            lineCount: outSnap.length,
            errCount: errSnap.length,
            subprocessSessionId: sid,
          });
        }
      }
      return;
    }
    if (outputLines.length >= MAX_CAPTURED_LINES) return;
    const pl = event.payload;
    const raw = typeof pl === "string" ? pl : String(pl ?? "");
    outputLines.push(
      raw.length > MAX_SINGLE_LINE_CHARS ? `${raw.slice(0, MAX_SINGLE_LINE_CHARS)}…[truncated]` : raw,
    );
    emitProgress(outputLines.length % 120 === 0);
  });
  const unlistenError = await listen<string>(errorEvent, (event) => {
    if (directErrRing) {
      const pl = event.payload;
      const raw = typeof pl === "string" ? pl : String(pl ?? "");
      const line =
        raw.length > DIRECT_BATCH_MAX_LINE_CHARS
          ? `${raw.slice(0, DIRECT_BATCH_MAX_LINE_CHARS)}…[truncated]`
          : raw;
      invocationLineRingPush(directErrRing, line);
      return;
    }
    if (errorLines.length >= MAX_CAPTURED_LINES) return;
    const pl = event.payload;
    const raw = typeof pl === "string" ? pl : String(pl ?? "");
    errorLines.push(
      raw.length > MAX_SINGLE_LINE_CHARS ? `${raw.slice(0, MAX_SINGLE_LINE_CHARS)}…[truncated]` : raw,
    );
    emitProgress(errorLines.length % 24 === 0);
  });
  const unlistenComplete = await listen<{ success?: boolean }>(completeEvent, (event) => {
    const success = resolveClaudeCompleteSuccess(event.payload);
    const outSnap = snapshotOutputLines();
    const errSnap = snapshotErrorLines();
    if (streamUi && !isDirectBatchStream) {
      dispatchInvocationStreamUi({
        phase: "complete",
        invocationKey,
        sessionId: streamUi.sessionId,
        repositoryPath: streamUi.repositoryPath,
        omcInvocationSource: streamUi.omcInvocationSource,
        taskId: streamUi.taskId,
        ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
        templateId: streamUi.templateId,
        attempt: streamUi.attempt,
        ...invocationStreamAttribution(streamUi),
        lineCount: outSnap.length,
        errCount: errSnap.length,
        success,
        ...(params.prompt !== undefined ? { dispatchPrompt: params.prompt } : {}),
      });
    } else if (streamUi && isDirectBatchStream) {
      const previewLine = success
        ? computeOmcDirectBatchPreviewLine(outSnap, errSnap, 160)
        : computeOmcDirectBatchFailurePreviewLine(outSnap, errSnap, 160);
      dispatchInvocationStreamUi({
        phase: "complete",
        invocationKey,
        sessionId: streamUi.sessionId,
        repositoryPath: streamUi.repositoryPath,
        omcInvocationSource: "direct_batch",
        taskId: streamUi.taskId,
        ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
        templateId: streamUi.templateId,
        attempt: streamUi.attempt,
        ...invocationStreamAttribution(streamUi),
        lineCount: outSnap.length,
        errCount: errSnap.length,
        success,
        ...(previewLine && previewLine.length > 0 ? { previewLine } : {}),
      });
      persistDirectBatchSnapshotIfNeeded(success, outSnap, errSnap);
    }
    resolveDone?.({ success, outputLines: outSnap, errorLines: errSnap, invocationKey });
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  function resolveTimeoutResult(
    resolve: (value: ClaudeInvocationResult) => void,
    cancelledHost: boolean,
  ): void {
    const outSnap = snapshotOutputLines();
    const errSnap = snapshotErrorLines();
    if (streamUi && !isDirectBatchStream) {
      dispatchInvocationStreamUi({
        phase: "complete",
        invocationKey,
        sessionId: streamUi.sessionId,
        repositoryPath: streamUi.repositoryPath,
        omcInvocationSource: streamUi.omcInvocationSource,
        taskId: streamUi.taskId,
        ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
        templateId: streamUi.templateId,
        attempt: streamUi.attempt,
        ...invocationStreamAttribution(streamUi),
        lineCount: outSnap.length,
        errCount: errSnap.length,
        success: false,
        ...(params.prompt !== undefined ? { dispatchPrompt: params.prompt } : {}),
      });
    } else if (streamUi && isDirectBatchStream) {
      const previewLine = computeOmcDirectBatchFailurePreviewLine(outSnap, errSnap, 160);
      dispatchInvocationStreamUi({
        phase: "complete",
        invocationKey,
        sessionId: streamUi.sessionId,
        repositoryPath: streamUi.repositoryPath,
        omcInvocationSource: "direct_batch",
        taskId: streamUi.taskId,
        ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
        templateId: streamUi.templateId,
        attempt: streamUi.attempt,
        ...invocationStreamAttribution(streamUi),
        lineCount: outSnap.length,
        errCount: errSnap.length,
        success: false,
        ...(previewLine && previewLine.length > 0 ? { previewLine } : {}),
      });
      persistDirectBatchSnapshotIfNeeded(false, outSnap, errSnap);
    }
    const cancelHint = cancelledHost
      ? "host subprocess terminated"
      : "host had no matching invocation child (IPC unavailable or already exited)";
    resolve({
      success: false,
      outputLines: outSnap,
      errorLines: [...errSnap, `Invocation timeout after ${timeoutMs}ms (${cancelHint})`],
      invocationKey,
    });
  }

  try {
    await executeClaudeCode(
      params.repositoryPath,
      params.prompt,
      params.model,
      invocationKey,
      params.connectionMode ?? "oneshot",
      params.concurrencyScopeKey,
      params.concurrencyLimit,
      params.bare,
    );
    // 计时从 spawn 成功之后开始，避免超时先于 `active_child_by_invocation` 注册导致无法 cancel。
    const timeoutPromise = new Promise<ClaudeInvocationResult>((resolve) => {
      timeoutHandle = globalThis.setTimeout(() => {
        void (async () => {
          let cancelledHost = false;
          try {
            cancelledHost = await cancelClaudeInvocation(invocationKey);
          } catch {
            /* 非 Tauri 或命令失败：仍以超时结果为准 */
          }
          resolveTimeoutResult(resolve, cancelledHost);
        })();
      }, timeoutMs);
    });
    return await Promise.race([donePromise, timeoutPromise]);
  } catch (err) {
    if (streamUi?.omcInvocationSource === "direct_batch") {
      const outSnap = snapshotOutputLines();
      const errSnap = snapshotErrorLines();
      const msg = err instanceof Error ? err.message : String(err);
      const previewLine = msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
      dispatchInvocationStreamUi({
        phase: "complete",
        invocationKey,
        sessionId: streamUi.sessionId,
        repositoryPath: streamUi.repositoryPath,
        omcInvocationSource: "direct_batch",
        taskId: streamUi.taskId,
        ...(streamUi.taskTitle?.trim() ? { taskTitle: streamUi.taskTitle.trim() } : {}),
        templateId: streamUi.templateId,
        attempt: streamUi.attempt,
        ...invocationStreamAttribution(streamUi),
        lineCount: outSnap.length,
        errCount: errSnap.length,
        success: false,
        previewLine,
      });
      persistDirectBatchSnapshotIfNeeded(false, outSnap, errSnap);
    }
    throw err;
  } finally {
    if (timeoutHandle != null) globalThis.clearTimeout(timeoutHandle);
    if (isDirectBatchStream) {
      directBatchInvocationRingByKey.delete(invocationKey);
    }
    safeUnlisten(unlistenOutput);
    safeUnlisten(unlistenError);
    safeUnlisten(unlistenComplete);
  }
}

export async function resumeClaudeCode(
  repositoryPath: string,
  sessionId: string,
  prompt: string,
  model?: string,
  invocationKey?: string,
  connectionMode: ClaudeConnectionMode = "oneshot",
  concurrencyScopeKey?: string,
  concurrencyLimit?: number,
  trellisContextId?: string,
): Promise<void> {
  const normalizedTrellisContextId = trellisContextId?.trim() || null;
  return invoke("resume_claude_code", {
    projectPath: repositoryPath,
    sessionId,
    prompt,
    model,
    invocationKey,
    connectionMode,
    concurrencyScopeKey,
    concurrencyLimit,
    trellisContextId: normalizedTrellisContextId,
  });
}

export async function cancelClaudeExecution(sessionId: string): Promise<void> {
  return invoke("cancel_claude_execution", { sessionId });
}

/** @returns 是否在宿主侧找到并终止了对应 invocation 的子进程 */
export async function cancelClaudeInvocation(invocationKey: string): Promise<boolean> {
  return invoke<boolean>("cancel_claude_invocation", { invocationKey });
}

/** 向当前 Claude 子进程 stdin 写入一行（stream-json / control 协议）。 */
export async function submitClaudeStdinLine(line: string, sessionId?: string): Promise<void> {
  return invoke("claude_submit_stdin_line", { line, sessionId: sessionId ?? null });
}

export async function listRunningClaudeSessions(): Promise<ClaudeSessionInfo[]> {
  return invoke("list_running_claude_sessions");
}

/** Reads `env.ANTHROPIC_MODEL` from `~/.claude/settings.json` and optional `{repositoryPath}/.claude/settings.json`. */
export async function getClaudeConfigModel(
  repositoryPath?: string | null,
): Promise<string | null> {
  try {
    return await invoke<string | null>("get_claude_config_model", {
      projectPath: repositoryPath ?? null,
    });
  } catch {
    return null;
  }
}

/** 与 Claude Code `settings.json` 对齐：默认模型 + 合并后的 `availableModels`（用于作曲器下拉）。 */
export interface ClaudeModelPickerOptions {
  defaultModel: string | null;
  availableModels: string[];
}

export async function getClaudeModelPickerOptions(
  repositoryPath?: string | null,
): Promise<ClaudeModelPickerOptions> {
  try {
    return await invoke<ClaudeModelPickerOptions>("get_claude_model_picker_options", {
      projectPath: repositoryPath ?? null,
    });
  } catch {
    return { defaultModel: null, availableModels: [] };
  }
}

/** Reads MCP 配置（异步 IPC，不跑 `claude mcp list`）。 */
export async function getClaudeMcpStatus(repositoryPath?: string | null): Promise<ClaudeMcpStatusResponse> {
  return invoke<ClaudeMcpStatusResponse>("get_claude_mcp_status", {
    projectPath: repositoryPath ?? null,
  });
}

/** 异步：`claude mcp list` 健康检查，前端按 name 合并到列表。 */
export async function getClaudeMcpRuntimeHealth(
  repositoryPath?: string | null,
): Promise<ClaudeMcpRuntimeHealthEntry[]> {
  return invoke<ClaudeMcpRuntimeHealthEntry[]>("get_claude_mcp_runtime_health", {
    projectPath: repositoryPath ?? null,
  });
}

export async function addClaudeMcpServer(payload: ClaudeMcpAddPayload): Promise<void> {
  return invoke("add_claude_mcp_server", {
    scope: payload.scope,
    transport: payload.transport,
    name: payload.name,
    url: payload.url ?? null,
    command: payload.command ?? null,
    commandArgs: payload.args ?? null,
    headers: payload.headers ?? null,
    envPairs: payload.envPairs ?? null,
    projectPath: payload.repositoryPath ?? null,
  });
}

export async function removeClaudeMcpServer(input: {
  name: string;
  scope: string;
  sourcePath: string;
  repositoryPath?: string | null;
  claudeJsonProjectKey?: string | null;
}): Promise<void> {
  return invoke("remove_claude_mcp_server", {
    projectPath: input.repositoryPath ?? null,
    name: input.name,
    scope: input.scope,
    sourcePath: input.sourcePath,
    claudeJsonProjectKey: input.claudeJsonProjectKey ?? null,
  });
}

export async function setClaudeMcpServerEnabled(input: {
  name: string;
  scope: string;
  sourcePath: string;
  enabled: boolean;
  repositoryPath?: string | null;
  claudeJsonProjectKey?: string | null;
}): Promise<void> {
  return invoke("set_claude_mcp_server_enabled", {
    projectPath: input.repositoryPath ?? null,
    serverName: input.name,
    scope: input.scope,
    sourcePath: input.sourcePath,
    enabled: input.enabled,
    claudeJsonProjectKey: input.claudeJsonProjectKey ?? null,
  });
}

export async function listClaudeProjectSkills(
  repositoryPath: string,
): Promise<ClaudeProjectSkill[]> {
  return invoke<ClaudeProjectSkill[]>("list_claude_project_skills", { projectPath: repositoryPath });
}

/** 枚举用户级 `~/.claude/skills/`（与 `skills add -g` 一致） */
export async function listClaudeUserSkills(): Promise<ClaudeProjectSkill[]> {
  return invoke<ClaudeProjectSkill[]>("list_claude_user_skills");
}

/** 枚举 ~/.claude/plugins/cache 下各插件包内的 skills/（只读） */
export async function listClaudePluginCacheSkills(): Promise<ClaudeProjectSkill[]> {
  return invoke<ClaudeProjectSkill[]>("list_claude_plugin_cache_skills");
}

export async function createClaudeProjectSkill(
  repositoryPath: string,
  skillName: string,
): Promise<void> {
  return invoke("create_claude_project_skill", { projectPath: repositoryPath, skillName });
}

export async function deleteClaudeProjectSkill(
  repositoryPath: string,
  skillName: string,
): Promise<void> {
  return invoke("delete_claude_project_skill", { projectPath: repositoryPath, skillName });
}


export async function listClaudeProjectSkillFiles(
  repositoryPath: string,
  skillName: string,
): Promise<ClaudeProjectSkillFileEntry[]> {
  return invoke<ClaudeProjectSkillFileEntry[]>("list_claude_project_skill_files", {
    projectPath: repositoryPath,
    skillName,
  });
}

export async function getClaudeProjectSkillFile(
  repositoryPath: string,
  skillName: string,
  relativePath: string,
): Promise<string> {
  return invoke<string>("get_claude_project_skill_file", {
    projectPath: repositoryPath,
    skillName,
    relativePath,
  });
}

export async function saveClaudeProjectSkillFile(
  repositoryPath: string,
  skillName: string,
  relativePath: string,
  content: string,
): Promise<void> {
  return invoke("save_claude_project_skill_file", {
    projectPath: repositoryPath,
    skillName,
    relativePath,
    content,
  });
}

export async function deleteClaudeProjectSkillFile(
  repositoryPath: string,
  skillName: string,
  relativePath: string,
): Promise<void> {
  return invoke("delete_claude_project_skill_file", {
    projectPath: repositoryPath,
    skillName,
    relativePath,
  });
}


export async function formatClaudeProjectSkillFile(
  repositoryPath: string,
  skillName: string,
  relativePath: string,
  content: string,
): Promise<string> {
  return invoke<string>("format_claude_project_skill_file", {
    projectPath: repositoryPath,
    skillName,
    relativePath,
    content,
  });
}

export async function listClaudeSubagents(repositoryPath?: string | null): Promise<ClaudeSubagentItem[]> {
  return invoke<ClaudeSubagentItem[]>("list_claude_subagents", {
    projectPath: repositoryPath ?? null,
  });
}

export async function listClaudeAvailableAgents(repositoryPath?: string | null): Promise<string[]> {
  return invoke<string[]>("list_claude_available_agents", {
    projectPath: repositoryPath ?? null,
  });
}

export async function createClaudeSubagent(input: {
  scope: ClaudeSubagentScope;
  name: string;
  description: string;
  repositoryPath?: string | null;
}): Promise<void> {
  return invoke("create_claude_subagent", {
    scope: input.scope,
    name: input.name,
    description: input.description,
    projectPath: input.repositoryPath ?? null,
  });
}

export async function getClaudeSubagentDetail(input: {
  scope: ClaudeSubagentScope;
  name: string;
  repositoryPath?: string | null;
}): Promise<ClaudeSubagentDetail> {
  return invoke<ClaudeSubagentDetail>("get_claude_subagent_detail", {
    scope: input.scope,
    name: input.name,
    projectPath: input.repositoryPath ?? null,
  });
}

export async function saveClaudeSubagent(input: {
  scope: ClaudeSubagentScope;
  name: string;
  rawContent: string;
  repositoryPath?: string | null;
}): Promise<void> {
  return invoke("save_claude_subagent", {
    scope: input.scope,
    name: input.name,
    rawContent: input.rawContent,
    projectPath: input.repositoryPath ?? null,
  });
}

export async function deleteClaudeSubagent(input: {
  scope: ClaudeSubagentScope;
  name: string;
  repositoryPath?: string | null;
}): Promise<void> {
  return invoke("delete_claude_subagent", {
    scope: input.scope,
    name: input.name,
    projectPath: input.repositoryPath ?? null,
  });
}

export async function openClaudeUserAgentsDir(): Promise<void> {
  return invoke("open_claude_user_agents_dir");
}

export async function getClaudeUserAgentsDir(): Promise<string> {
  return invoke<string>("get_claude_user_agents_dir");
}

export async function getClaudeHooksStatus(repositoryPath?: string | null): Promise<ClaudeHooksStatusResponse> {
  return invoke<ClaudeHooksStatusResponse>("get_claude_hooks_status", {
    projectPath: repositoryPath ?? null,
  });
}

/** True when `~/.claude/plugins/cache/omc/oh-my-claudecode` is present (same check as Rust OMC hooks/subagents). */
export async function isOmcPluginInstalled(): Promise<boolean> {
  return invoke<boolean>("is_omc_plugin_installed");
}

export async function upsertClaudeHook(payload: ClaudeHookUpsertPayload): Promise<void> {
  return invoke("upsert_claude_hook", {
    scope: payload.scope,
    projectPath: payload.repositoryPath ?? null,
    eventName: payload.eventName,
    matcher: payload.matcher ?? null,
    handler: payload.handler,
    targetGroupId: payload.targetGroupId ?? null,
    targetHandlerId: payload.targetHandlerId ?? null,
  });
}

export async function removeClaudeHook(input: {
  scope: ClaudeHookSourceScope;
  eventName: string;
  groupId: string;
  handlerId: string;
  repositoryPath?: string | null;
}): Promise<void> {
  return invoke("remove_claude_hook", {
    scope: input.scope,
    eventName: input.eventName,
    groupId: input.groupId,
    handlerId: input.handlerId,
    projectPath: input.repositoryPath ?? null,
  });
}

export async function setClaudeDisableAllHooks(input: {
  scope: ClaudeHookSourceScope;
  disableAllHooks: boolean;
  repositoryPath?: string | null;
}): Promise<void> {
  return invoke("set_claude_disable_all_hooks", {
    scope: input.scope,
    disableAllHooks: input.disableAllHooks,
    projectPath: input.repositoryPath ?? null,
  });
}
