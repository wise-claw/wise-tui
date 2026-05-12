import type { TaskItem } from "../types";
import type { DirectOmcBatchTemplateId } from "../constants/omcBatchTemplates";
import { executeClaudeCodeAndWait, type ClaudeInvocationResult } from "./claude";
import { gitWorktreeAddOmcBatch } from "./git";
import { buildOmcClaudeCodeInvocationPrompt } from "./workflow/omcAdapter";
import {
  WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED,
  type WorkflowOmcBatchRuntimeDetail,
} from "../constants/workflowUiEvents";

export interface BoolRef {
  current: boolean;
}

export interface StartDirectOmcBatchParams {
  anchorSessionId: string;
  repositoryPath: string;
  /** 员工标签展示用仓库名（`createSession` 第二段前缀）；缺省则用 `repositoryPath` */
  repositoryDisplayName?: string;
  tasks: TaskItem[];
  templateId: DirectOmcBatchTemplateId;
  subagentType: string;
  concurrencyScopeKey?: string;
  concurrencyLimit?: number;
  userAbortRef: BoolRef;
  inFlightRef: BoolRef;
  buildTaskAppendix: (task: TaskItem) => string;
  syncSplitTaskList: () => Promise<void>;
  /** 单条 Claude Code 判定成功时：将可执行任务 `flowStatus` 写为 done；返回是否写入成功 */
  onExecutableTaskDoneAfterOmcSuccess?: (taskId: string) => Promise<boolean>;
  onAppendSystemMessage?: (sessionId: string, text: string) => void;
  /** 将本条实际派发的 `-p` 正文写入锚点会话（用户气泡，不触发 invoke），便于标签内可见 */
  onAppendDispatchUserMessage?: (sessionId: string, prompt: string) => void;
  /**
   * 单条任务在可执行任务中成功标为已完成时：向「OMC员工」工作标签追加一条系统提示（与主会话系统行语义一致）。
   */
  onNotifyOmcEmployeeDirectBatchTaskDone?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
    employeeMessage: string;
  }) => void;
}

function isClaudeSpawnSlotFullError(error: unknown): boolean {
  const s = error instanceof Error ? error.message : String(error);
  return s.includes("已达上限") || s.includes("并发已达");
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

/**
 * 直连批量 OMC：子进程只要跑完一轮 invoke（未抛错）即视为任务成功，不按退出码 / `OMC_RESULT` 再判「批次错误」。
 * 仅显式等待超时仍计失败。
 */
function classifyDirectBatchInvocationOutcome(inv: ClaudeInvocationResult): "done" | "failed" {
  const errJoined = inv.errorLines.join("\n");
  if (errJoined.includes("Invocation timeout after")) return "failed";
  return "done";
}

/** 将低优先级工作推迟到浏览器空闲，避免与渲染/输入抢主线程 */
function scheduleIdleCallback(fn: () => void, timeoutMs: number): void {
  const ric = globalThis.requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => {
      fn();
    }, { timeout: timeoutMs });
    return;
  }
  globalThis.setTimeout(fn, 0);
}

function emitOmcBatchRuntimeDetail(detail: WorkflowOmcBatchRuntimeDetail): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, { detail }));
  });
}

async function runDirectOmcBatchJob(
  params: StartDirectOmcBatchParams & { batchEpoch: number; parallelCap: number },
): Promise<void> {
  const {
    anchorSessionId: anchorSid,
    repositoryPath: repoPath,
    repositoryDisplayName: repoDisplayName,
    tasks: tasksSnapshot,
    templateId: templateIdSnapshot,
    subagentType: subagentSnapshot,
    concurrencyScopeKey: scopeKey,
    concurrencyLimit: scopeLimit,
    userAbortRef,
    inFlightRef,
    buildTaskAppendix,
    syncSplitTaskList,
    onExecutableTaskDoneAfterOmcSuccess,
    onAppendSystemMessage,
    onAppendDispatchUserMessage,
    onNotifyOmcEmployeeDirectBatchTaskDone,
    batchEpoch,
    parallelCap,
  } = params;

  const syntheticRunId = `direct-omc-batch:${batchEpoch}`;
  let doneCount = 0;
  let failedCount = 0;
  let userAbortedBatch = false;
  let nextIndex = 0;

  const runSingleTask = async (task: TaskItem, index: number): Promise<void> => {
    if (userAbortRef.current) {
      userAbortedBatch = true;
      failedCount += 1;
      return;
    }
    const attempt = batchEpoch + index + 1;
    const slotWaitDeadline = Date.now() + 600_000;
    const finishedBeforeRun = doneCount + failedCount;
    emitOmcBatchRuntimeDetail({
      active: true,
      sessionId: anchorSid,
      runningCount: tasksSnapshot.length,
      updatedAt: Date.now(),
      resetInvocationUi: false,
      directBatchTaskTotal: tasksSnapshot.length,
      directBatchTaskFinished: finishedBeforeRun,
      directBatchClaudeCodeSessions: parallelCap,
    });

    let wt: Awaited<ReturnType<typeof gitWorktreeAddOmcBatch>>;
    try {
      wt = await gitWorktreeAddOmcBatch(repoPath, task.id, attempt);
    } catch (err) {
      console.error("git worktree add (OMC batch) failed:", err);
      failedCount += 1;
      emitOmcBatchRuntimeDetail({
        active: true,
        sessionId: anchorSid,
        runningCount: tasksSnapshot.length,
        updatedAt: Date.now(),
        resetInvocationUi: false,
        directBatchTaskTotal: tasksSnapshot.length,
        directBatchTaskFinished: doneCount + failedCount,
        directBatchClaudeCodeSessions: parallelCap,
      });
      return;
    }

    const prompt = buildOmcClaudeCodeInvocationPrompt(
      {
        workflowRunId: syntheticRunId,
        sessionId: anchorSid,
        taskId: task.id,
        templateId: templateIdSnapshot,
        subagentType: subagentSnapshot,
        attempt,
        taskPromptAppendix: buildTaskAppendix(task),
      },
      {
        hostPreparedWorktree: { worktreePath: wt.worktreePath, branchName: wt.branchName },
        noGitWritesInSession: true,
      },
    );
    onAppendDispatchUserMessage?.(anchorSid, prompt);

    let inv: Awaited<ReturnType<typeof executeClaudeCodeAndWait>>;
    for (;;) {
      if (userAbortRef.current) {
        userAbortedBatch = true;
        failedCount += 1;
        return;
      }
      try {
        inv = await executeClaudeCodeAndWait({
          repositoryPath: wt.worktreePath,
          prompt,
          connectionMode: "oneshot",
          bare: true,
          timeoutMs: 180_000,
          concurrencyScopeKey: scopeKey,
          concurrencyLimit: scopeLimit,
          streamUi: {
            sessionId: anchorSid,
            repositoryPath: repoPath,
            taskId: task.id,
            taskTitle: task.title.trim() || undefined,
            templateId: templateIdSnapshot,
            attempt,
            omcInvocationSource: "direct_batch",
          },
        });
        break;
      } catch (e) {
        if (isClaudeSpawnSlotFullError(e) && Date.now() < slotWaitDeadline) {
          await sleepMs(700);
          continue;
        }
        failedCount += 1;
        emitOmcBatchRuntimeDetail({
          active: true,
          sessionId: anchorSid,
          runningCount: tasksSnapshot.length,
          updatedAt: Date.now(),
          resetInvocationUi: false,
          directBatchTaskTotal: tasksSnapshot.length,
        directBatchTaskFinished: doneCount + failedCount,
        directBatchClaudeCodeSessions: parallelCap,
      });
        return;
      }
    }
    const outcome = classifyDirectBatchInvocationOutcome(inv);
    let executablePersistOk = true;
    if (outcome === "done") {
      if (onExecutableTaskDoneAfterOmcSuccess) {
        try {
          executablePersistOk = await onExecutableTaskDoneAfterOmcSuccess(task.id);
        } catch (err) {
          executablePersistOk = false;
          console.error("mark executable task done after OMC success failed:", err);
        }
      }
      doneCount += 1;
    } else {
      failedCount += 1;
    }
    if (outcome === "done" && onAppendSystemMessage) {
      const titleShort = task.title.replace(/\s+/g, " ").trim().slice(0, 80) || task.id;
      const body = onExecutableTaskDoneAfterOmcSuccess
        ? executablePersistOk
          ? `[系统] 批量 OMC：任务 \`${task.id}\`（${titleShort}）已由 Claude Code 正常执行完毕，已在可执行任务中标记为已完成。`
          : `[系统] 批量 OMC：任务 \`${task.id}\`（${titleShort}）Claude Code 已正常结束，但自动写入「已完成」失败，请在任务列表中手动标记完成。`
        : `[系统] 批量 OMC：任务 \`${task.id}\`（${titleShort}）已由 Claude Code 正常执行完毕。`;
      scheduleIdleCallback(() => {
        onAppendSystemMessage(anchorSid, body);
        if (
          onNotifyOmcEmployeeDirectBatchTaskDone &&
          onExecutableTaskDoneAfterOmcSuccess &&
          executablePersistOk
        ) {
          const employeeMessage = `[系统]【OMC员工】批量 OMC 任务 \`${task.id}\`（${titleShort}）已完成，主会话已在可执行任务中标记为已完成。`;
          onNotifyOmcEmployeeDirectBatchTaskDone({
            repositoryPath: repoPath,
            repositoryDisplayName: (repoDisplayName ?? "").trim() || repoPath,
            employeeMessage,
          });
        }
      }, 600);
    }
    emitOmcBatchRuntimeDetail({
      active: true,
      sessionId: anchorSid,
      runningCount: tasksSnapshot.length,
      updatedAt: Date.now(),
      resetInvocationUi: false,
      directBatchTaskTotal: tasksSnapshot.length,
      directBatchTaskFinished: doneCount + failedCount,
      directBatchClaudeCodeSessions: parallelCap,
    });
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (userAbortRef.current) {
        userAbortedBatch = true;
        return;
      }
      const i = nextIndex;
      nextIndex += 1;
      if (i >= tasksSnapshot.length) return;
      await runSingleTask(tasksSnapshot[i]!, i);
    }
  };

  try {
    if (tasksSnapshot.length > 0) {
      const workerCount = Math.min(parallelCap, tasksSnapshot.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }
  } finally {
    const batchEndDetail = {
      active: false as const,
      sessionId: anchorSid,
      runningCount: 0,
      updatedAt: Date.now(),
    };
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
          detail: batchEndDetail,
        }),
      );
    });

    scheduleIdleCallback(() => {
      void syncSplitTaskList().catch(() => {
        /* ignore */
      });
    }, 4000);

    const aborted = userAbortedBatch || userAbortRef.current;
    if (aborted) {
      userAbortRef.current = false;
    }

    inFlightRef.current = false;
  }
}

/**
 * 异步启动批量直连 OMC：短延迟后派发 batch-runtime 并起 `runDirectOmcBatchJob`；
 * 实际执行在 `await executeClaudeCodeAndWait` 与 Tauri 子进程，不在主线程空转等待。
 */
export function scheduleDirectOmcBatchAfterMacrotask(params: StartDirectOmcBatchParams): void {
  /** 串行执行：同时仅一路子进程 stdout 回调，避免多路洪泛叠加仍拖死主线程（槽位 key 仍参与排队） */
  const parallelCap = 1;
  const batchEpoch = Date.now();
  const anchorSid = params.anchorSessionId;

  globalThis.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
        detail: {
          active: true,
          sessionId: anchorSid,
          runningCount: params.tasks.length,
          updatedAt: Date.now(),
          resetInvocationUi: true,
          directBatchTaskTotal: params.tasks.length,
          directBatchTaskFinished: 0,
          directBatchClaudeCodeSessions: 0,
        },
      }),
    );
    void runDirectOmcBatchJob({ ...params, batchEpoch, parallelCap }).catch((err) => {
      console.error("direct OMC batch job failed:", err);
      window.dispatchEvent(
        new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
          detail: {
            active: false,
            sessionId: anchorSid,
            runningCount: 0,
            updatedAt: Date.now(),
          },
        }),
      );
      params.inFlightRef.current = false;
    });
  }, 48);
}
