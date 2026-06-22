import { message } from "antd";
import type { ClaudeSession } from "../types";
import {
  registerExecutionEnvironmentBatch,
  upsertExecutionEnvironmentDispatchItem,
} from "../stores/executionEnvironmentDispatchStore";
import {
  persistExecutionEnvironmentDispatchBatch,
  persistExecutionEnvironmentDispatchItem,
} from "./executionEnvironmentDispatchPersistence";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
} from "../constants/sessionExecutionEngine";
import {
  buildExecutionEnvironmentWorkerRepositoryName,
  buildExecutionEnvironmentWorkerUserBubble,
  isExecutionEnvironmentEngineAvailable,
  parseExecutionEnvironmentDispatch,
} from "../utils/executionEnvironmentDispatch";
import { applyComposerDefaultInstruction } from "../utils/composerDefaultInstruction";
import {
  loadDefaultInstructionResolveContext,
  resolveComposerDefaultInstructionOutbound,
} from "../utils/resolveComposerDefaultInstructionOutbound";

export type ExecutionEnvironmentDispatchDeps = {
  getSessions: () => ClaudeSession[];
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean; connectionKind?: "oneshot" | "streaming" },
  ) => Promise<string>;
  executeSession: (
    workerTabId: string,
    prompt: string,
    opts?: { userBubblePrompt?: string; defaultInstructionApplied?: string },
  ) => boolean;
  appendSystemMessage: (sessionId: string, text: string) => void;
  /**
   * 把派发对应的用户问题以用户气泡形式回写到主会话；用于在主会话保留
   * 派发历史，并支持「填入输入框」回填。
   * 未提供时不写入（保持兼容旧调用方）。
   */
  appendUserMessage?: (sessionId: string, text: string) => void;
};

function resolveEngineAvailability(deps: ExecutionEnvironmentDispatchDeps) {
  return {
    codexAvailable: deps.codexAvailable ?? true,
    cursorAvailable: deps.cursorAvailable ?? true,
    geminiAvailable: deps.geminiAvailable ?? false,
    opencodeAvailable: deps.opencodeAvailable ?? false,
  };
}

function repositoryDisplayBase(repositoryName: string): string {
  const marker = "/执行环境:";
  const employeeMarker = "/员工:";
  let name = repositoryName.trim();
  const execIdx = name.indexOf(marker);
  if (execIdx >= 0) name = name.slice(0, execIdx).trim();
  const empIdx = name.indexOf(employeeMarker);
  if (empIdx >= 0) name = name.slice(0, empIdx).trim();
  return name || repositoryName.trim();
}

function newBatchId(): string {
  return `exec-env-batch:${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 从主会话向执行环境派发一次性任务：按解析结果创建 N 个 worker 标签并各自 invoke。
 */
export async function dispatchExecutionEnvironmentFromMainSession(
  deps: ExecutionEnvironmentDispatchDeps,
  input: {
    mainSessionId: string;
    prompt: string;
    userBubblePrompt?: string;
    defaultInstructionApplied?: string;
  },
): Promise<boolean> {
  const mainSession = deps.getSessions().find((item) => item.id === input.mainSessionId);
  if (!mainSession) return false;

  const plan = parseExecutionEnvironmentDispatch(input.prompt);
  if (!plan || !plan.cleanedPrompt.trim()) {
    const warningText = "请在 @执行引擎（如 Claude Code / Codex）后补充可执行的任务正文。";
    message.warning(warningText);
    deps.appendSystemMessage(input.mainSessionId, `[系统] ${warningText}`);
    return false;
  }

  if (!isExecutionEnvironmentEngineAvailable(plan.executionEngine, resolveEngineAvailability(deps))) {
    const engineTitle = SESSION_EXECUTION_ENGINE_LABELS[plan.executionEngine].title;
    const warningText = `${engineTitle} 未就绪，无法派发；请先在配置中心探测或切换其他执行引擎。`;
    message.warning(warningText);
    deps.appendSystemMessage(input.mainSessionId, `[系统] ${warningText}`);
    return false;
  }

  const batchId = newBatchId();
  const batchCreatedAt = Date.now();
  const displayBase = repositoryDisplayBase(mainSession.repositoryName);
  const bubble = buildExecutionEnvironmentWorkerUserBubble(
    input.userBubblePrompt?.trim() || input.prompt.trim(),
  );
  const defaultInstructionApplied = input.defaultInstructionApplied?.trim() || "";
  const resolveContext = await loadDefaultInstructionResolveContext(mainSession.repositoryPath);
  const resolvedDefaultInstruction = defaultInstructionApplied
    ? resolveComposerDefaultInstructionOutbound(defaultInstructionApplied, resolveContext)
    : "";
  const workerPrompt = resolvedDefaultInstruction
    ? applyComposerDefaultInstruction(plan.cleanedPrompt, resolvedDefaultInstruction, resolveContext)
    : plan.cleanedPrompt;
  const preview = workerPrompt.slice(0, 72);

  registerExecutionEnvironmentBatch({
    batchId,
    anchorSessionId: mainSession.id,
    repositoryPath: mainSession.repositoryPath,
    executionEngine: plan.executionEngine,
    sessionCount: plan.sessionCount,
    previewText: preview,
    createdAt: batchCreatedAt,
  });

  void persistExecutionEnvironmentDispatchBatch({
    batchId,
    anchorSessionId: mainSession.id,
    repositoryPath: mainSession.repositoryPath,
    executionEngine: plan.executionEngine,
    sessionCount: plan.sessionCount,
    previewText: preview,
    batchHint: plan.batchHint ?? null,
    createdAtMs: batchCreatedAt,
  }).catch(() => {
    /* 持久化失败不阻断派发 */
  });

  const engineTitle = SESSION_EXECUTION_ENGINE_LABELS[plan.executionEngine].title;
  const summaryLines = [
    "任务分发记录",
    "- 类型：执行环境",
    `- 目标：${engineTitle}`,
    `- 引擎：${engineTitle}`,
    `- 批次：${batchId}`,
    `- 并发会话：${plan.sessionCount}`,
    plan.batchHint ? `- 批量描述：${plan.batchHint}` : null,
    `- 正文：${preview || "（无）"}`,
    `- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
  ].filter(Boolean);
  deps.appendSystemMessage(mainSession.id, summaryLines.join("\n"));
  // 主会话写回原始用户输入（带 @-mention），便于在主会话查看派发历史以及
  // 「填入输入框」回填后能直接再次派发。
  const anchorUserPrompt = input.prompt.trim();
  if (anchorUserPrompt) {
    deps.appendUserMessage?.(mainSession.id, anchorUserPrompt);
  }

  let started = 0;
  let blocked = 0;

  for (let i = 0; i < plan.sessionCount; i += 1) {
    const label = plan.sessionCount > 1 ? `任务 ${i + 1}` : "任务";
    const workerName = buildExecutionEnvironmentWorkerRepositoryName(
      displayBase,
      label,
      plan.executionEngine,
    );
    const workerTabId = await deps.createSession(mainSession.repositoryPath, workerName, {
      skipActivate: true,
      connectionKind: "oneshot",
    });

    upsertExecutionEnvironmentDispatchItem({
      batchId,
      anchorSessionId: mainSession.id,
      workerSessionId: workerTabId,
      label,
      previewText: preview,
      batchIndex: i + 1,
      sessionCount: plan.sessionCount,
    });
    void persistExecutionEnvironmentDispatchItem({
      itemKey: `exec-env:${batchId}:${workerTabId}`,
      batchId,
      anchorSessionId: mainSession.id,
      workerSessionId: workerTabId,
      label,
      previewText: preview,
      batchIndex: i + 1,
      sessionCount: plan.sessionCount,
      updatedAtMs: Date.now(),
    }).catch(() => {
      /* 持久化失败不阻断派发 */
    });

    const spawnOk = deps.executeSession(workerTabId, workerPrompt, {
      userBubblePrompt: bubble,
      ...(resolvedDefaultInstruction ? { defaultInstructionApplied: resolvedDefaultInstruction } : {}),
    });
    if (spawnOk === false) {
      blocked += 1;
      const worker = deps.getSessions().find((s) => s.id === workerTabId);
      const failPreview = worker?.status === "error" ? "派发失败" : preview;
      upsertExecutionEnvironmentDispatchItem({
        batchId,
        anchorSessionId: mainSession.id,
        workerSessionId: workerTabId,
        label,
        previewText: failPreview,
        batchIndex: i + 1,
        sessionCount: plan.sessionCount,
      });
      void persistExecutionEnvironmentDispatchItem({
        itemKey: `exec-env:${batchId}:${workerTabId}`,
        batchId,
        anchorSessionId: mainSession.id,
        workerSessionId: workerTabId,
        label,
        previewText: failPreview,
        batchIndex: i + 1,
        sessionCount: plan.sessionCount,
        updatedAtMs: Date.now(),
      }).catch(() => {});
      continue;
    }
    started += 1;
  }

  if (started === 0) {
    message.warning("执行环境派发未启动：可能已达并发上限，请稍后重试。");
    return false;
  }
  if (blocked > 0) {
    message.warning(`执行环境已启动 ${started} 路，${blocked} 路因并发限制未启动。`);
  }
  return true;
}

