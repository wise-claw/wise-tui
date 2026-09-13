import { useEffect, useRef, type MutableRefObject } from "react";
import type { PendingExecutionTask, Repository, WorkflowTemplateItem } from "../types";
import { buildClaudeOutgoingPrompt } from "../services/claudeComposerPrompt";
import {
  hydrateAutomationPause,
  isGlobalAutomationPaused,
  isRepositoryAutomationPaused,
} from "../services/automationPauseStore";
import { patchRepositoryScheduledClaudeTask, readRepositoryScheduledClaudeTasks } from "../services/repositoryScheduledClaudeTasksStore";
import { runShellCommand } from "../services/terminal";
import {
  resolveScheduledTaskExecutionKind,
} from "../utils/scheduledTaskExecution";
import { buildScheduledTaskScriptCommand } from "../utils/scheduledTaskScript";
import {
  SCHEDULED_TASK_RETRY_BUSY,
  SCHEDULED_TASK_RETRY_DISPATCH,
  SCHEDULED_TASK_SKIP_CRON,
  SCHEDULED_TASK_SKIP_EMPTY,
  SCHEDULED_TASK_SKIP_PROMPT_EMPTY,
  SCHEDULED_TASK_SKIP_WORKFLOW,
  buildScheduledTaskResultPatch,
  evaluateScheduledTaskGate,
  type ScheduledTaskLastKind,
} from "../utils/scheduledTaskReliability";
import { startAdaptiveInterval } from "../utils/adaptivePoll";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";

const TICK_MS = 45_000;
const TICK_MS_HIDDEN = 180_000;

type ScheduledTaskDispatch = Pick<
  PendingExecutionTask,
  "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName"
>;

interface Params {
  repositoriesRef: MutableRefObject<Repository[]>;
  workflowTemplatesRef: MutableRefObject<WorkflowTemplateItem[]>;
  createSessionRef: MutableRefObject<
    (
      repositoryPath: string,
      repositoryName: string,
      opts?: { skipActivate?: boolean; connectionKind?: "oneshot" | "streaming" },
    ) => Promise<string>
  >;
  executeSessionRef: MutableRefObject<(sessionId: string, prompt: string) => boolean>;
  /** 支持团队工作流派发（与 Composer 执行路径一致）。 */
  executeWithDispatchRef: MutableRefObject<
    (sessionId: string, prompt: string, dispatchTarget?: ScheduledTaskDispatch) => Promise<boolean>
  >;
  closeSessionRef: MutableRefObject<(sessionId: string) => void | Promise<void>>;
}

function truncateMessage(text: string, max = 240): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function buildScheduledTaskSessionName(repoName: string, taskTitle: string, suffix?: string): string {
  const base = repoName.trim() || "仓库";
  const title = taskTitle.trim() || "未命名任务";
  const stamp = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const mid = suffix?.trim() ? `${title}·${suffix.trim()}` : title;
  return `${base}/定时任务:${mid}·${stamp}`;
}

async function recordScheduledTaskResult(
  repoPath: string,
  task: { id: string; cronExpression: string },
  input: {
    nextFireMs?: number;
    nowMs: number;
    consumeSlot: boolean;
    kind: ScheduledTaskLastKind;
    message?: string;
  },
): Promise<void> {
  await patchRepositoryScheduledClaudeTask(
    repoPath,
    task.id,
    buildScheduledTaskResultPatch({
      ...input,
      cronExpression: task.cronExpression,
    }),
  );
}

/**
 * 按侧栏仓库列表轮询：到达 cron 下一档时执行仓库定时任务（Claude 提示词 / Shell 脚本）。
 * Claude：默认新建独立会话；若配置了 workflowId 则按团队工作流派发。
 * 忙时 / 暂停不消耗 Cron 槽，空闲或恢复后补跑一档。
 */
export function useScheduledClaudeTaskRunner({
  repositoriesRef,
  workflowTemplatesRef,
  createSessionRef,
  executeSessionRef,
  executeWithDispatchRef,
  closeSessionRef,
}: Params): void {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!isCurrentPrimaryMainWorkspaceWindowSync()) return;
    let stopPoll: (() => void) | null = null;
    const tick = async () => {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const repos = repositoriesRef.current;
        const workflowTemplates = workflowTemplatesRef.current;
        const createSession = createSessionRef.current;
        const executeSession = executeSessionRef.current;
        const executeWithDispatch = executeWithDispatchRef.current;
        const closeSession = closeSessionRef.current;
        const now = Date.now();
        if (isGlobalAutomationPaused()) return;

        for (const repo of repos) {
          const repoPath = repo.path.trim();
          if (!repoPath) continue;
          if (isRepositoryAutomationPaused(repoPath)) continue;

          let tasks: Awaited<ReturnType<typeof readRepositoryScheduledClaudeTasks>>;
          try {
            tasks = await readRepositoryScheduledClaudeTasks(repoPath);
          } catch {
            continue;
          }
          if (tasks.length === 0) continue;

          for (const task of tasks) {
            const gate = evaluateScheduledTaskGate({
              enabled: task.enabled,
              cronExpression: task.cronExpression,
              lastScheduledSlotAt: task.lastScheduledSlotAt,
              nowMs: now,
              pausedGlobal: false,
              pausedRepository: false,
            });
            if (gate.status === "disabled" || gate.status === "hold" || gate.status === "paused") {
              continue;
            }
            if (gate.status === "invalid_cron") {
              if (task.lastExecuteKind !== "skipped" || task.lastExecuteMessage !== SCHEDULED_TASK_SKIP_CRON) {
                await recordScheduledTaskResult(repoPath, task, {
                  nowMs: now,
                  consumeSlot: false,
                  kind: "skipped",
                  message: SCHEDULED_TASK_SKIP_CRON,
                });
              }
              continue;
            }

            const nextFireMs = gate.nextFireMs;
            const executionKind = resolveScheduledTaskExecutionKind(task);

            if (executionKind === "script") {
              const built = buildScheduledTaskScriptCommand(task);
              if (!built.ok) {
                await recordScheduledTaskResult(repoPath, task, {
                  nextFireMs,
                  nowMs: now,
                  consumeSlot: true,
                  kind: "skipped",
                  message: `${built.reason}，已跳过`,
                });
                continue;
              }
              try {
                const result = await runShellCommand(repoPath, built.command);
                const ok = result.exit_code === 0;
                const detail = [
                  ok
                    ? built.mode === "file"
                      ? `脚本文件执行成功（${built.scriptFilePath}）`
                      : "脚本执行成功"
                    : `脚本退出码 ${result.exit_code}`,
                  result.stderr.trim() ? `stderr: ${truncateMessage(result.stderr)}` : "",
                  !ok && result.stdout.trim() ? `stdout: ${truncateMessage(result.stdout)}` : "",
                ]
                  .filter(Boolean)
                  .join("；");
                await recordScheduledTaskResult(repoPath, task, {
                  nextFireMs,
                  nowMs: now,
                  consumeSlot: true,
                  kind: ok ? "ok" : "failed",
                  message: ok ? undefined : detail,
                });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                await recordScheduledTaskResult(repoPath, task, {
                  nextFireMs,
                  nowMs: now,
                  consumeSlot: true,
                  kind: "failed",
                  message: `脚本执行失败：${msg}`,
                });
              }
              continue;
            }

            const md = task.contentMarkdown.trim();
            if (!md) {
              await recordScheduledTaskResult(repoPath, task, {
                nextFireMs,
                nowMs: now,
                consumeSlot: true,
                kind: "skipped",
                message: SCHEDULED_TASK_SKIP_EMPTY,
              });
              continue;
            }

            let outbound: string;
            try {
              outbound = await buildClaudeOutgoingPrompt({
                prompt: [{ type: "text", text: md, start: 0, end: md.length }],
                contextItems: [],
                images: [],
                repositoryPath: repoPath,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await recordScheduledTaskResult(repoPath, task, {
                nextFireMs,
                nowMs: now,
                consumeSlot: true,
                kind: "failed",
                message: `组装提示失败：${msg}`,
              });
              continue;
            }

            if (!outbound.trim()) {
              await recordScheduledTaskResult(repoPath, task, {
                nextFireMs,
                nowMs: now,
                consumeSlot: true,
                kind: "skipped",
                message: SCHEDULED_TASK_SKIP_PROMPT_EMPTY,
              });
              continue;
            }

            const wfId = task.workflowId?.trim() ?? "";
            let workerSessionId: string | null = null;
            try {
              if (wfId) {
                const wf = workflowTemplates.find((t) => t.id === wfId);
                if (!wf) {
                  await recordScheduledTaskResult(repoPath, task, {
                    nextFireMs,
                    nowMs: now,
                    consumeSlot: true,
                    kind: "skipped",
                    message: SCHEDULED_TASK_SKIP_WORKFLOW,
                  });
                  continue;
                }
                workerSessionId = await createSession(
                  repoPath,
                  buildScheduledTaskSessionName(repo.name, task.title, "工作流"),
                  { skipActivate: true, connectionKind: "streaming" },
                );
                const ok = await executeWithDispatch(workerSessionId, outbound, {
                  targetType: "team",
                  targetWorkflowId: wf.id,
                  targetWorkflowName: wf.name.trim(),
                });
                if (ok === false) {
                  void closeSession(workerSessionId);
                  await recordScheduledTaskResult(repoPath, task, {
                    nextFireMs,
                    nowMs: now,
                    consumeSlot: false,
                    kind: "retrying",
                    message: SCHEDULED_TASK_RETRY_DISPATCH,
                  });
                  continue;
                }
                await recordScheduledTaskResult(repoPath, task, {
                  nextFireMs,
                  nowMs: now,
                  consumeSlot: true,
                  kind: "ok",
                });
                continue;
              }

              workerSessionId = await createSession(
                repoPath,
                buildScheduledTaskSessionName(repo.name, task.title),
                { skipActivate: true, connectionKind: "streaming" },
              );
              const ok = executeSession(workerSessionId, outbound);
              if (ok === false) {
                void closeSession(workerSessionId);
                await recordScheduledTaskResult(repoPath, task, {
                  nextFireMs,
                  nowMs: now,
                  consumeSlot: false,
                  kind: "retrying",
                  message: SCHEDULED_TASK_RETRY_BUSY,
                });
                continue;
              }
              await recordScheduledTaskResult(repoPath, task, {
                nextFireMs,
                nowMs: now,
                consumeSlot: true,
                kind: "ok",
              });
            } catch (e) {
              if (workerSessionId) void closeSession(workerSessionId);
              const msg = e instanceof Error ? e.message : String(e);
              await recordScheduledTaskResult(repoPath, task, {
                nextFireMs,
                nowMs: now,
                consumeSlot: true,
                kind: "failed",
                message: `执行失败：${msg}`,
              });
            }
          }
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void hydrateAutomationPause().then(() => {
      if (cancelled) return;
      stopPoll = startAdaptiveInterval(tick, TICK_MS, TICK_MS_HIDDEN);
      if (cancelled) {
        stopPoll();
        stopPoll = null;
        return;
      }
      void tick();
    });
    return () => {
      cancelled = true;
      stopPoll?.();
    };
  }, [
    closeSessionRef,
    createSessionRef,
    executeSessionRef,
    executeWithDispatchRef,
    repositoriesRef,
    workflowTemplatesRef,
  ]);
}
