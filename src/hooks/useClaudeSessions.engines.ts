import type { MutableRefObject } from "react";
import { message } from "antd";
import type { ClaudeSession, SessionExecutionEngine } from "../types";
import {
  executeClaudeCode,
  resumeClaudeCode,
  spawnStreamingSession,
  sendStreamingUserMessage,
  closeStreamingSession,
} from "../services/claude";
import { executeCodexCode, executeCodexRpcCode } from "../services/codex";
import { executeOpencodeCode } from "../services/opencode";
import { executeQoderCode } from "../services/qoder";
import { executeCursorCode } from "../services/cursorAgentExecution";
import { getCachedDefaultExecutionEngine } from "../services/wiseDefaultConfigStore";
import type { CursorSdkAttachment } from "../services/cursorComposerPrompt";
import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import { resolveCursorLocalModelId } from "../utils/cursorModel";
import { resolveCodexExecModelId } from "../utils/codexModel";
import { resolveCodexResumeSessionId } from "../utils/codexSessionId";
import { resolveOpencodeExecModelId } from "../utils/opencodeModel";
import { resolveOpencodeResumeSessionId } from "../utils/opencodeSessionId";
import { resolveQoderResumeSessionId } from "../utils/qoderSessionId";
import { formatQoderModelLabel, resolveQoderExecModelId } from "../utils/qoderModel";
import { getCachedModelProfileStore } from "../stores/modelProfileStoreCache";
import {
  getCodexRpcReasoningEffort,
  setCodexRpcReasoningEffort,
} from "../stores/codexRpcReasoningEffortStore";
import {
  codexReasoningEffortLabel,
  normalizeCodexReasoningEffort,
} from "../constants/codexReasoningEffort";
import { resolveCursorResumeAgentId } from "../utils/cursorAgentId";
import {
  sessionUsesStreamingConnection,
  type ClaudeSessionConnectionKind,
} from "../constants/claudeConnection";
import type { ClaudeSpawnCliExtras } from "../services/claudeSpawnExtras";
import { notificationHub } from "../notifications";
import { appendSystemMessageBySessionId } from "../services/claudeSessionState";
import {
  CLAUDE_STREAM_RUNTIME_READY_POLL_MS,
  CLAUDE_STREAM_RUNTIME_READY_WAIT_MS,
  attachClaudeInvocationStream,
  attachClaudeSessionStreamForTurn,
  isClaudeConversationMissingError,
  type ClaudeStreamRuntimeHandlers,
} from "./useClaudeSessions.helpers";
import type { UseClaudeSessionsOptions } from "./useClaudeSessions.types";
import {
  applyStreamingProcessReclaim,
  deleteStreamingProcessEntry,
  setStreamingProcessEntry,
  touchStreamingProcessActivity,
  type StreamingProcessActivityEntry,
} from "./useClaudeSessions.streamingReclaim";

export type ClaudeEngineHandlersDeps = {
  streamRuntimeRef: MutableRefObject<ClaudeStreamRuntimeHandlers | null>;
  sessionIdMapRef: MutableRefObject<Map<string, string>>;
  sessionsRef: MutableRefObject<ClaudeSession[]>;
  claudeInvocationInflightRef: MutableRefObject<
    Map<string, { tabId: string; detach: () => void }>
  >;
  expectedTurnNonceByTabIdRef: MutableRefObject<Map<string, number>>;
  streamingProcessByTabRef: MutableRefObject<Map<string, { claudeSessionId: string | null }>>;
  streamingProcessActivityByTabRef: MutableRefObject<Map<string, StreamingProcessActivityEntry>>;
  streamingSessionStreamDetachByTabRef: MutableRefObject<Map<string, () => void>>;
  streamingTargetIdRef: MutableRefObject<string | null>;
  defaultConnectionKindRef: MutableRefObject<ClaudeSessionConnectionKind>;
  claudeSessionsOptionsRef: MutableRefObject<UseClaudeSessionsOptions | undefined>;
  detachClaudeInvocationStreamsForTab: (tabSessionId: string) => void;
  keepInvocationStreamAfterTurnComplete: (tabId: string) => boolean;
  resolveSpawnExtrasForClaudePrompt: (
    tabSessionId: string,
    prompt: string,
  ) => Promise<ClaudeSpawnCliExtras | null>;
  commitSessions: (updater: (prev: ClaudeSession[]) => ClaudeSession[]) => void;
  scheduleStreamStallTimer: (tabId: string) => void;
};

export type ClaudeOneshotInvokeParams = {
  tabSessionId: string;
  turnNonce: number;
  invokeConc:
    | { concurrencyScopeKey: string; concurrencyLimit: number }
    | null
    | undefined;
  repositoryPath: string;
  prompt: string;
  modelArg: string | undefined;
  resumeClaudeSid: string | null;
};

export type ClaudeTurnInvokeParams = ClaudeOneshotInvokeParams & {
  cursorAttachments?: CursorSdkAttachment[];
  codexContextExecutionEngine?: SessionExecutionEngine;
  forceNewClaudeConversation?: boolean;
};

async function waitForStreamRuntime(
  streamRuntimeRef: MutableRefObject<ClaudeStreamRuntimeHandlers | null>,
): Promise<ClaudeStreamRuntimeHandlers> {
  if (!streamRuntimeRef.current) {
    const deadline = Date.now() + CLAUDE_STREAM_RUNTIME_READY_WAIT_MS;
    while (!streamRuntimeRef.current && Date.now() < deadline) {
      await new Promise<void>((r) => {
        window.setTimeout(r, CLAUDE_STREAM_RUNTIME_READY_POLL_MS);
      });
    }
    if (!streamRuntimeRef.current) {
      message.error("流式引擎尚未就绪或初始化超时，请稍后重试发送。");
      throw new Error("Claude stream runtime not ready");
    }
  }
  return streamRuntimeRef.current;
}

export function createClaudeEngineHandlers(deps: ClaudeEngineHandlersDeps) {
  const {
    streamRuntimeRef,
    sessionIdMapRef,
    sessionsRef,
    claudeInvocationInflightRef,
    expectedTurnNonceByTabIdRef,
    streamingProcessByTabRef,
    streamingProcessActivityByTabRef,
    streamingSessionStreamDetachByTabRef,
    streamingTargetIdRef,
    defaultConnectionKindRef,
    claudeSessionsOptionsRef,
    detachClaudeInvocationStreamsForTab,
    keepInvocationStreamAfterTurnComplete,
    resolveSpawnExtrasForClaudePrompt,
    commitSessions,
    scheduleStreamStallTimer,
  } = deps;

  const reclaimStreamingProcessesBeforeSpawn = async () => {
    await applyStreamingProcessReclaim({
      reserveSlotForSpawn: true,
      streamingProcessByTab: streamingProcessByTabRef.current,
      activityByTab: streamingProcessActivityByTabRef.current,
      sessions: sessionsRef.current.map((s) => ({ id: s.id, status: s.status })),
      getPendingCount: (tabId) => notificationHub.getBlockingControlPendingCount(tabId),
      detachSessionStream: (tabId) => {
        streamingSessionStreamDetachByTabRef.current.get(tabId)?.();
        streamingSessionStreamDetachByTabRef.current.delete(tabId);
      },
    });
  };

  const runClaudeOneshotWithInvocation = async (params: ClaudeOneshotInvokeParams) => {
    const {
      tabSessionId,
      turnNonce,
      invokeConc,
      repositoryPath,
      prompt,
      modelArg,
      resumeClaudeSid,
    } = params;
    await waitForStreamRuntime(streamRuntimeRef);
    // 新一轮子进程会替换或清空 stdin 映射；上一轮的 AskUserQuestion / 权限弹窗再提交必败
    notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
    const mappedTab = sessionIdMapRef.current.get(tabSessionId);
    if (mappedTab && mappedTab !== tabSessionId) {
      notificationHub.invalidateControlRequestsForSession(mappedTab, "已发起新一轮对话");
    }
    const rt = streamRuntimeRef.current;
    let detach: (() => void) | null = null;
    const inv = crypto.randomUUID();
    if (rt) {
      detachClaudeInvocationStreamsForTab(tabSessionId);
      try {
        detach = await attachClaudeInvocationStream(
          inv,
          tabSessionId,
          rt,
          turnNonce,
          () => {
            claudeInvocationInflightRef.current.delete(inv);
          },
          (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
          keepInvocationStreamAfterTurnComplete,
        );
        claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
      } catch {
        detach = null;
      }
    }
    // 仅当 invocation 监听已挂载时才传 key：Rust 会抑制共享 stdout；监听失败时必须不传 key，否则前端收不到流式行。
    const invocationKey = detach ? inv : undefined;
    if (rt && !detach) {
      message.warning("本会话流式监听未建立，已退回全局通道；若多标签同时跑 Claude，输出可能短暂串屏。");
    }
    const sk = invokeConc?.concurrencyScopeKey;
    const lim = invokeConc?.concurrencyLimit;
    const cliExtras = await resolveSpawnExtrasForClaudePrompt(tabSessionId, prompt);
    const spawnSession = sessionsRef.current.find((s) => s.id === tabSessionId) ?? null;
    const proxyBypassResolver = claudeSessionsOptionsRef.current?.resolveClaudeProxyBypassRef?.current;
    const anthropicProxyBypass =
      spawnSession && proxyBypassResolver ? proxyBypassResolver(spawnSession) : false;
    try {
      if (resumeClaudeSid) {
        try {
          await resumeClaudeCode(
            repositoryPath,
            resumeClaudeSid,
            prompt,
            modelArg,
            invocationKey,
            "oneshot",
            sk,
            lim,
            cliExtras,
            anthropicProxyBypass,
          );
        } catch (resumeError) {
          if (!isClaudeConversationMissingError(resumeError)) {
            throw resumeError;
          }
          // Claude 侧会话可能已被清理；自动回退到新会话启动，避免用户手动重发。
          await executeClaudeCode(
            repositoryPath,
            prompt,
            modelArg,
            invocationKey,
            "oneshot",
            sk,
            lim,
            undefined,
            cliExtras,
            anthropicProxyBypass,
          );
        }
      } else {
        await executeClaudeCode(
          repositoryPath,
          prompt,
          modelArg,
          invocationKey,
          "oneshot",
          sk,
          lim,
          undefined,
          cliExtras,
          anthropicProxyBypass,
        );
      }
    } catch (e) {
      detach?.();
      throw e;
    }
  };

  const runCodexOneshotWithInvocation = async (params: {
    tabSessionId: string;
    turnNonce: number;
    repositoryPath: string;
    prompt: string;
    modelArg: string | undefined;
    contextExecutionEngine: SessionExecutionEngine;
    codexResumeSessionId?: string | null;
    forceNewClaudeConversation?: boolean;
  }) => {
    const {
      tabSessionId,
      turnNonce,
      repositoryPath,
      prompt,
      modelArg,
      contextExecutionEngine,
      codexResumeSessionId,
      forceNewClaudeConversation,
    } = params;
    await waitForStreamRuntime(streamRuntimeRef);
    notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
    const rt = streamRuntimeRef.current;
    let detach: (() => void) | null = null;
    const inv = crypto.randomUUID();
    if (rt) {
      try {
        detach = await attachClaudeInvocationStream(
          inv,
          tabSessionId,
          rt,
          turnNonce,
          () => {
            claudeInvocationInflightRef.current.delete(inv);
          },
          (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
          keepInvocationStreamAfterTurnComplete,
        );
        claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
      } catch {
        detach = null;
      }
    }
    const invocationKey = detach ? inv : undefined;
    const codexModel = resolveCodexExecModelId({
      sessionModel: modelArg,
      contextExecutionEngine,
      store: getCachedModelProfileStore(),
    });
    const codexModelLabel = codexModel?.trim() || "默认";
    const resumeLabel = codexResumeSessionId?.trim() ? "续接会话" : "新会话";
    commitSessions((prev) =>
      appendSystemMessageBySessionId(
        prev,
        tabSessionId,
        `Codex 执行中（${resumeLabel}，模型：${codexModelLabel}）…`,
      ),
    );
    try {
      await executeCodexCode(
        repositoryPath,
        prompt,
        codexModel,
        invocationKey,
        tabSessionId,
        codexResumeSessionId ?? undefined,
        forceNewClaudeConversation === true,
      );
    } catch (e) {
      detach?.();
      throw e;
    }
  };

  const runCodexRpcOneshotWithInvocation = async (params: {
    tabSessionId: string;
    turnNonce: number;
    repositoryPath: string;
    prompt: string;
    modelArg: string | undefined;
    contextExecutionEngine: SessionExecutionEngine;
    codexResumeSessionId?: string | null;
  }) => {
    const {
      tabSessionId,
      turnNonce,
      repositoryPath,
      prompt,
      modelArg,
      contextExecutionEngine,
      codexResumeSessionId,
    } = params;
    await waitForStreamRuntime(streamRuntimeRef);
    notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
    const rt = streamRuntimeRef.current;
    let detach: (() => void) | null = null;
    const inv = crypto.randomUUID();
    if (rt) {
      try {
        detach = await attachClaudeInvocationStream(
          inv,
          tabSessionId,
          rt,
          turnNonce,
          () => {
            claudeInvocationInflightRef.current.delete(inv);
          },
          (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
          keepInvocationStreamAfterTurnComplete,
        );
        claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
      } catch {
        detach = null;
      }
    }
    const invocationKey = detach ? inv : undefined;
    const codexModel = resolveCodexExecModelId({
      sessionModel: modelArg,
      contextExecutionEngine,
      store: getCachedModelProfileStore(),
    });
    const effort = normalizeCodexReasoningEffort(
      sessionsRef.current.find((s) => s.id === tabSessionId)?.codexReasoningEffort ??
        getCodexRpcReasoningEffort(tabSessionId),
    );
    setCodexRpcReasoningEffort(tabSessionId, effort);
    const codexModelLabel = codexModel?.trim() || "默认";
    const effortLabel = codexReasoningEffortLabel(effort);
    const resumeLabel = codexResumeSessionId?.trim() ? "续接会话" : "新会话";
    commitSessions((prev) =>
      appendSystemMessageBySessionId(
        prev,
        tabSessionId,
        `Codex RPC 执行中（${resumeLabel}，模型：${codexModelLabel}，推理：${effortLabel}）…`,
      ),
    );
    try {
      await executeCodexRpcCode(
        repositoryPath,
        prompt,
        codexModel,
        invocationKey,
        tabSessionId,
        codexResumeSessionId ?? undefined,
        effort,
      );
    } catch (e) {
      detach?.();
      throw e;
    }
  };

  const runOpencodeOneshotWithInvocation = async (params: {
    tabSessionId: string;
    turnNonce: number;
    repositoryPath: string;
    prompt: string;
    modelArg: string | undefined;
    contextExecutionEngine: SessionExecutionEngine;
    opencodeResumeSessionId?: string | null;
    forceNewClaudeConversation?: boolean;
  }) => {
    const {
      tabSessionId,
      turnNonce,
      repositoryPath,
      prompt,
      modelArg,
      opencodeResumeSessionId,
      forceNewClaudeConversation,
    } = params;
    // Composer 选择的模型优先；上下文引擎在 invoke 入口已固定为 opencode。
    void params.contextExecutionEngine;
    await waitForStreamRuntime(streamRuntimeRef);
    notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
    const rt = streamRuntimeRef.current;
    let detach: (() => void) | null = null;
    const inv = crypto.randomUUID();
    if (rt) {
      try {
        detach = await attachClaudeInvocationStream(
          inv,
          tabSessionId,
          rt,
          turnNonce,
          () => {
            claudeInvocationInflightRef.current.delete(inv);
          },
          (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
          keepInvocationStreamAfterTurnComplete,
        );
        claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
      } catch {
        detach = null;
      }
    }
    const invocationKey = detach ? inv : undefined;
    const opencodeModel = resolveOpencodeExecModelId({
      sessionModel: modelArg,
      contextExecutionEngine: "opencode",
      store: getCachedModelProfileStore(),
    });
    const opencodeModelLabel = opencodeModel?.trim() || "默认";
    const resumeLabel = opencodeResumeSessionId?.trim() ? "续接会话" : "新会话";
    commitSessions((prev) =>
      appendSystemMessageBySessionId(
        prev,
        tabSessionId,
        `OpenCode 执行中（${resumeLabel}，模型：${opencodeModelLabel}）…`,
      ),
    );
    try {
      await executeOpencodeCode(
        repositoryPath,
        prompt,
        opencodeModel,
        invocationKey,
        tabSessionId,
        opencodeResumeSessionId ?? undefined,
        forceNewClaudeConversation === true,
      );
    } catch (e) {
      detach?.();
      throw e;
    }
  };

  const runQoderOneshotWithInvocation = async (params: {
    tabSessionId: string;
    turnNonce: number;
    repositoryPath: string;
    prompt: string;
    modelArg: string | undefined;
    qoderResumeSessionId?: string | null;
    forceNewClaudeConversation?: boolean;
  }) => {
    const {
      tabSessionId,
      turnNonce,
      repositoryPath,
      prompt,
      modelArg,
      qoderResumeSessionId,
      forceNewClaudeConversation,
    } = params;
    await waitForStreamRuntime(streamRuntimeRef);
    notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
    const rt = streamRuntimeRef.current;
    let detach: (() => void) | null = null;
    const inv = crypto.randomUUID();
    if (rt) {
      try {
        detach = await attachClaudeInvocationStream(
          inv,
          tabSessionId,
          rt,
          turnNonce,
          () => {
            claudeInvocationInflightRef.current.delete(inv);
          },
          (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
          keepInvocationStreamAfterTurnComplete,
        );
        claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
      } catch {
        detach = null;
      }
    }
    const invocationKey = detach ? inv : undefined;
    const qoderModel = resolveQoderExecModelId(modelArg);
    const qoderModelLabel = formatQoderModelLabel(modelArg?.trim() || "auto");
    const resumeLabel = qoderResumeSessionId?.trim() ? "续接会话" : "新会话";
    commitSessions((prev) =>
      appendSystemMessageBySessionId(
        prev,
        tabSessionId,
        `Qoder CLI 执行中（${resumeLabel}，模型：${qoderModelLabel}）…`,
      ),
    );
    try {
      await executeQoderCode(
        repositoryPath,
        prompt,
        qoderModel,
        invocationKey,
        tabSessionId,
        qoderResumeSessionId ?? undefined,
        forceNewClaudeConversation === true,
      );
    } catch (e) {
      detach?.();
      throw e;
    }
  };

  const runCursorOneshotWithInvocation = async (params: {
    tabSessionId: string;
    turnNonce: number;
    repositoryPath: string;
    prompt: string;
    modelArg: string | undefined;
    cursorAgentId: string | null;
    cursorAttachments?: CursorSdkAttachment[];
  }) => {
    const {
      tabSessionId,
      turnNonce,
      repositoryPath,
      prompt,
      modelArg,
      cursorAgentId,
      cursorAttachments,
    } = params;
    await waitForStreamRuntime(streamRuntimeRef);
    notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
    streamingTargetIdRef.current = tabSessionId;
    scheduleStreamStallTimer(tabSessionId);
    commitSessions((prev) =>
      appendSystemMessageBySessionId(prev, tabSessionId, "Cursor Agent 执行中…"),
    );
    const rt = streamRuntimeRef.current;
    let detach: (() => void) | null = null;
    const inv = crypto.randomUUID();
    if (rt) {
      try {
        detach = await attachClaudeInvocationStream(
          inv,
          tabSessionId,
          rt,
          turnNonce,
          () => {
            claudeInvocationInflightRef.current.delete(inv);
          },
          (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
          keepInvocationStreamAfterTurnComplete,
        );
        claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
      } catch {
        detach = null;
      }
    }
    const invocationKey = detach ? inv : undefined;
    const resolvedModel = resolveCursorLocalModelId(modelArg ?? CURSOR_SDK_DEFAULT_MODEL);
    // Cursor CLI 自行读取工作区/用户 mcp.json（--approve-mcps）；勿在 invoke 前组装 MCP（可达数秒且 Rust 侧已丢弃）。
    try {
      await executeCursorCode(
        repositoryPath,
        prompt,
        resolvedModel,
        invocationKey,
        tabSessionId,
        cursorAgentId ?? undefined,
        undefined,
        cursorAttachments,
      );
    } catch (e) {
      detach?.();
      throw e;
    }
  };

  const runClaudeStreamingWithInvocation = async (params: ClaudeOneshotInvokeParams) => {
    const {
      tabSessionId,
      turnNonce,
      invokeConc,
      repositoryPath,
      prompt,
      modelArg,
      resumeClaudeSid,
    } = params;

    await waitForStreamRuntime(streamRuntimeRef);

    notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
    const mappedTab = sessionIdMapRef.current.get(tabSessionId);
    if (mappedTab && mappedTab !== tabSessionId) {
      notificationHub.invalidateControlRequestsForSession(mappedTab, "已发起新一轮对话");
    }

    const liveSid =
      sessionsRef.current.find((s) => s.id === tabSessionId)?.claudeSessionId?.trim() ??
      sessionIdMapRef.current.get(tabSessionId)?.trim() ??
      resumeClaudeSid?.trim() ??
      null;

    const entry = streamingProcessByTabRef.current.get(tabSessionId);
    const isFollowUp = Boolean(entry && liveSid && entry.claudeSessionId?.trim() === liveSid);

    if (isFollowUp && liveSid) {
      const rt = streamRuntimeRef.current;
      let detachFollowUp: (() => void) | null = null;
      const followInv = crypto.randomUUID();
      if (rt) {
        try {
          detachFollowUp = await attachClaudeSessionStreamForTurn(
            liveSid,
            tabSessionId,
            rt,
            turnNonce,
            () => {
              claudeInvocationInflightRef.current.delete(followInv);
            },
            (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
            (tabId) => {
              if (!streamingProcessByTabRef.current.has(tabId)) return false;
              const session = sessionsRef.current.find((s) => s.id === tabId);
              return Boolean(
                session && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current),
              );
            },
          );
          claudeInvocationInflightRef.current.set(followInv, {
            tabId: tabSessionId,
            detach: detachFollowUp,
          });
        } catch {
          detachFollowUp = null;
        }
      }
      try {
        touchStreamingProcessActivity(
          streamingProcessActivityByTabRef.current,
          tabSessionId,
        );
        await sendStreamingUserMessage(liveSid, prompt);
        return;
      } catch (err) {
        detachFollowUp?.();
        claudeInvocationInflightRef.current.delete(followInv);
        const errText = err instanceof Error ? err.message : String(err);
        const stdinGone = errText.includes("没有可写 stdin") || errText.includes("stdin");
        const conversationMissing = isClaudeConversationMissingError(err);
        if (!stdinGone && !conversationMissing) {
          deleteStreamingProcessEntry(
            streamingProcessByTabRef.current,
            streamingProcessActivityByTabRef.current,
            tabSessionId,
          );
          throw err;
        }
        // 长驻子进程可能已退出，或 Claude 侧会话已清理（No conversation found）；
        // 回退为新一轮 spawn，避免用户手动重发。
      }
    }

    if (liveSid) {
      await closeStreamingSession(liveSid).catch(() => {
        /* 旧进程可能已退出 */
      });
    }
    deleteStreamingProcessEntry(
      streamingProcessByTabRef.current,
      streamingProcessActivityByTabRef.current,
      tabSessionId,
    );

    const rt = streamRuntimeRef.current;
    let detach: (() => void) | null = null;
    const inv = crypto.randomUUID();
    if (rt) {
      try {
        detach = await attachClaudeInvocationStream(
          inv,
          tabSessionId,
          rt,
          turnNonce,
          () => {
            claudeInvocationInflightRef.current.delete(inv);
          },
          (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
          keepInvocationStreamAfterTurnComplete,
        );
        claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
      } catch {
        detach = null;
      }
    }
    const invocationKey = detach ? inv : undefined;
    if (rt && !detach) {
      message.warning("本会话流式监听未建立，已退回全局通道；若多标签同时跑 Claude，输出可能短暂串屏。");
    }

    const sk = invokeConc?.concurrencyScopeKey;
    const lim = invokeConc?.concurrencyLimit;
    const cliExtras = await resolveSpawnExtrasForClaudePrompt(tabSessionId, prompt);

    try {
      await reclaimStreamingProcessesBeforeSpawn();
      await spawnStreamingSession({
        repositoryPath,
        initialPrompt: prompt,
        model: modelArg,
        sessionIdToResume: liveSid,
        invocationKey,
        concurrencyScopeKey: sk,
        concurrencyLimit: lim,
        cliExtras,
      });
      setStreamingProcessEntry(
        streamingProcessByTabRef.current,
        streamingProcessActivityByTabRef.current,
        tabSessionId,
        liveSid,
      );
    } catch (e) {
      detach?.();
      deleteStreamingProcessEntry(
        streamingProcessByTabRef.current,
        streamingProcessActivityByTabRef.current,
        tabSessionId,
      );
      throw e;
    }
  };

  const invokeClaudeTurn = async (params: ClaudeTurnInvokeParams) => {
    const session = sessionsRef.current.find((s) => s.id === params.tabSessionId);
    const resolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
    const engine: SessionExecutionEngine =
      session && resolver ? resolver(session) : getCachedDefaultExecutionEngine();
    if (engine === "codex") {
      const contextExecutionEngine =
        params.codexContextExecutionEngine ??
        (session && resolver ? resolver(session) : getCachedDefaultExecutionEngine());
      const codexResumeSessionId =
        params.forceNewClaudeConversation || !session
          ? null
          : resolveCodexResumeSessionId(session, params.tabSessionId, sessionIdMapRef.current);
      await runCodexOneshotWithInvocation({
        tabSessionId: params.tabSessionId,
        turnNonce: params.turnNonce,
        repositoryPath: params.repositoryPath,
        prompt: params.prompt,
        modelArg: params.modelArg,
        contextExecutionEngine,
        codexResumeSessionId,
        forceNewClaudeConversation: params.forceNewClaudeConversation,
      });
      return;
    }
    if (engine === "codex-rpc") {
      const contextExecutionEngine =
        params.codexContextExecutionEngine ?? (session && resolver ? resolver(session) : "claude");
      const codexResumeSessionId =
        params.forceNewClaudeConversation || !session
          ? null
          : resolveCodexResumeSessionId(session, params.tabSessionId, sessionIdMapRef.current, {
              requireUuid: true,
            });
      await runCodexRpcOneshotWithInvocation({
        tabSessionId: params.tabSessionId,
        turnNonce: params.turnNonce,
        repositoryPath: params.repositoryPath,
        prompt: params.prompt,
        modelArg: params.modelArg,
        contextExecutionEngine,
        codexResumeSessionId,
      });
      return;
    }
    if (engine === "cursor") {
      const cursorAgentId = session
        ? resolveCursorResumeAgentId(session, params.tabSessionId, sessionIdMapRef.current)
        : null;
      await runCursorOneshotWithInvocation({
        tabSessionId: params.tabSessionId,
        turnNonce: params.turnNonce,
        repositoryPath: params.repositoryPath,
        prompt: params.prompt,
        modelArg: params.modelArg,
        cursorAgentId,
        cursorAttachments: params.cursorAttachments,
      });
      return;
    }
    if (engine === "opencode") {
      const opencodeResumeSessionId =
        params.forceNewClaudeConversation || !session
          ? null
          : resolveOpencodeResumeSessionId(session, params.tabSessionId, sessionIdMapRef.current);
      // OpenCode 路径：上下文引擎固定为 opencode，避免误用 Claude 档案模型。
      await runOpencodeOneshotWithInvocation({
        tabSessionId: params.tabSessionId,
        turnNonce: params.turnNonce,
        repositoryPath: params.repositoryPath,
        prompt: params.prompt,
        modelArg: params.modelArg,
        contextExecutionEngine: "opencode",
        opencodeResumeSessionId,
        forceNewClaudeConversation: params.forceNewClaudeConversation,
      });
      return;
    }
    if (engine === "qoder") {
      const qoderResumeSessionId =
        params.forceNewClaudeConversation || !session
          ? null
          : resolveQoderResumeSessionId(session, params.tabSessionId, sessionIdMapRef.current);
      await runQoderOneshotWithInvocation({
        tabSessionId: params.tabSessionId,
        turnNonce: params.turnNonce,
        repositoryPath: params.repositoryPath,
        prompt: params.prompt,
        modelArg: params.modelArg,
        qoderResumeSessionId,
        forceNewClaudeConversation: params.forceNewClaudeConversation,
      });
      return;
    }
    if (sessionUsesStreamingConnection(session, defaultConnectionKindRef.current)) {
      await runClaudeStreamingWithInvocation(params);
    } else {
      await runClaudeOneshotWithInvocation(params);
    }
  };

  return {
    runClaudeOneshotWithInvocation,
    runCodexOneshotWithInvocation,
    runCodexRpcOneshotWithInvocation,
    runOpencodeOneshotWithInvocation,
    runQoderOneshotWithInvocation,
    runCursorOneshotWithInvocation,
    runClaudeStreamingWithInvocation,
    invokeClaudeTurn,
  };
}
