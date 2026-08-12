import { message } from "antd";
import type { ClaudeSession } from "../types";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
} from "../constants/sessionExecutionEngine";
import {
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
    opts?: {
      skipActivate?: boolean;
      connectionKind?: "oneshot" | "streaming";
      initialExecutionEngine?: SessionExecutionEngine;
      /** 关联的需求 id：会话执行完成且结果表明已处理时由需求模块标记为「待验证」。 */
      requirementId?: string;
    },
  ) => Promise<string>;
  executeSession: (
    workerTabId: string,
    prompt: string,
    opts?: { userBubblePrompt?: string; defaultInstructionApplied?: string },
  ) => boolean;
  appendSystemMessage: (sessionId: string, text: string) => void;
  /**
   * 创建成功后打开新建会话窗口（切到首个已启动的会话）。
   * 不传则保持后台跑、不切换当前主会话。
   */
  activateWorkerSession?: (workerSessionId: string) => void;
  /** 测试可注入；默认 `loadDefaultInstructionResolveContext`。 */
  loadInstructionResolveContext?: typeof loadDefaultInstructionResolveContext;
  /** executeSession 返回 false（并发门闸/未真正 spawn）或创建失败时清理空壳 worker 会话，避免侧栏留 idle 幽灵 tab。 */
  closeSession?: (sessionId: string) => void | Promise<void>;
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

/**
 * `@Claude Code` / `@Codex RPC` 等：直接新建普通会话并执行，不再走「派发」worker / 侧栏派发行。
 * 引擎写在新会话的 `executionEngine` 上；主会话不被占用。
 */
export async function dispatchExecutionEnvironmentFromMainSession(
  deps: ExecutionEnvironmentDispatchDeps,
  input: {
    mainSessionId: string;
    prompt: string;
    userBubblePrompt?: string;
    defaultInstructionApplied?: string;
    requirementId?: string;
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
    const warningText = `${engineTitle} 未就绪，无法新建会话；请先在配置中心探测或切换其他执行引擎。`;
    message.warning(warningText);
    deps.appendSystemMessage(input.mainSessionId, `[系统] ${warningText}`);
    return false;
  }

  const displayBase = repositoryDisplayBase(mainSession.repositoryName);
  const bubble = buildExecutionEnvironmentWorkerUserBubble(
    input.userBubblePrompt?.trim() || input.prompt.trim(),
  );
  const defaultInstructionApplied = input.defaultInstructionApplied?.trim() || "";
  // 无默认指令时跳过 slash catalog IPC：否则每次 @引擎 都多一轮等待。
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

  let started = 0;
  let blocked = 0;
  let firstStartedSessionId: string | null = null;

  const sessionSpecs = Array.from({ length: plan.sessionCount }, (_, i) => {
    const label =
      plan.sessionCount > 1 ? `${displayBase} · ${i + 1}` : displayBase;
    return { index: i, label };
  });

  // Claude Code：streaming；Codex/Cursor 等仍 oneshot。
  const connectionKind = plan.executionEngine === "claude" ? "streaming" : "oneshot";
  const createOutcomes = await Promise.allSettled(
    sessionSpecs.map((spec) =>
      deps.createSession(mainSession.repositoryPath, spec.label, {
        skipActivate: true,
        connectionKind,
        initialExecutionEngine: plan.executionEngine,
        ...(input.requirementId ? { requirementId: input.requirementId } : {}),
      }),
    ),
  );
  const sessionIds: string[] = [];
  for (const outcome of createOutcomes) {
    if (outcome.status === "fulfilled") sessionIds.push(outcome.value);
  }
  if (sessionIds.length !== sessionSpecs.length) {
    // 部分创建失败：清理已成功创建的空壳，避免泄漏；整体提示失败（此前 Promise.all 会形成未处理 rejection）。
    for (const id of sessionIds) void deps.closeSession?.(id);
    message.error("新建执行环境会话失败，请稍后重试。");
    return false;
  }

  for (let i = 0; i < sessionSpecs.length; i += 1) {
    const sessionId = sessionIds[i]!;
    const spawnOk = deps.executeSession(sessionId, workerPrompt, {
      userBubblePrompt: bubble,
      ...(resolvedDefaultInstruction ? { defaultInstructionApplied: resolvedDefaultInstruction } : {}),
    });
    if (spawnOk === false) {
      blocked += 1;
      // 清理未真正启动的空壳 worker 会话：executeSession 被并发门闸挡住时不会自行清理，
      // 留着会在侧栏出现永远 idle 的幽灵 tab（started===0 时更是整批泄漏）。
      void deps.closeSession?.(sessionId);
      continue;
    }
    if (!firstStartedSessionId) firstStartedSessionId = sessionId;
    started += 1;
  }

  if (started === 0) {
    message.warning("新建会话未启动：可能已达并发上限，请稍后重试。");
    return false;
  }
  if (blocked > 0) {
    message.warning(`已新建 ${started} 个会话，${blocked} 路因并发限制未启动。`);
  }
  if (firstStartedSessionId) {
    deps.activateWorkerSession?.(firstStartedSessionId);
  }
  return true;
}
