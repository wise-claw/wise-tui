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
  qoderAvailable?: boolean;
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
  /** 测试可注入；默认 `loadDefaultInstructionResolveContext`。 */
  loadInstructionResolveContext?: typeof loadDefaultInstructionResolveContext;
};

function resolveEngineAvailability(deps: ExecutionEnvironmentDispatchDeps) {
  return {
    codexAvailable: deps.codexAvailable ?? true,
    cursorAvailable: deps.cursorAvailable ?? true,
    geminiAvailable: deps.geminiAvailable ?? false,
    opencodeAvailable: deps.opencodeAvailable ?? false,
    qoderAvailable: deps.qoderAvailable ?? false,
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
  // 无默认指令时跳过 slash catalog IPC：否则每次 @Claude Code 派发都多一轮等待。
  let resolvedDefaultInstruction = "";
  let resolveContext: Awaited<ReturnType<typeof loadDefaultInstructionResolveContext>> | null = null;
  if (defaultInstructionApplied) {
    const loadContext =
      deps.loadInstructionResolveContext ?? loadDefaultInstructionResolveContext;
    resolveContext = await loadContext(mainSession.repositoryPath);
    resolvedDefaultInstruction = resolveComposerDefaultInstructionOutbound(
      defaultInstructionApplied,
      resolveContext,
    );
  }
  const workerPrompt = resolvedDefaultInstruction && resolveContext
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

  let started = 0;
  let blocked = 0;

  const workerSpecs = Array.from({ length: plan.sessionCount }, (_, i) => {
    const label = plan.sessionCount > 1 ? `任务 ${i + 1}` : "任务";
    return {
      index: i,
      label,
      workerName: buildExecutionEnvironmentWorkerRepositoryName(
        displayBase,
        label,
        plan.executionEngine,
      ),
    };
  });

  // 并行建 worker 会话，避免「清空输入框 → 首路执行」之间串行等待 N 次 createSession。
  const workerTabIds = await Promise.all(
    workerSpecs.map((spec) =>
      deps.createSession(mainSession.repositoryPath, spec.workerName, {
        skipActivate: true,
        connectionKind: "oneshot",
      }),
    ),
  );

  for (let i = 0; i < workerSpecs.length; i += 1) {
    const spec = workerSpecs[i]!;
    const workerTabId = workerTabIds[i]!;
    const batchIndex = i + 1;

    upsertExecutionEnvironmentDispatchItem({
      batchId,
      anchorSessionId: mainSession.id,
      workerSessionId: workerTabId,
      label: spec.label,
      previewText: preview,
      batchIndex,
      sessionCount: plan.sessionCount,
    });
    void persistExecutionEnvironmentDispatchItem({
      itemKey: `exec-env:${batchId}:${workerTabId}`,
      batchId,
      anchorSessionId: mainSession.id,
      workerSessionId: workerTabId,
      label: spec.label,
      previewText: preview,
      batchIndex,
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
        label: spec.label,
        previewText: failPreview,
        batchIndex,
        sessionCount: plan.sessionCount,
      });
      void persistExecutionEnvironmentDispatchItem({
        itemKey: `exec-env:${batchId}:${workerTabId}`,
        batchId,
        anchorSessionId: mainSession.id,
        workerSessionId: workerTabId,
        label: spec.label,
        previewText: failPreview,
        batchIndex,
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

