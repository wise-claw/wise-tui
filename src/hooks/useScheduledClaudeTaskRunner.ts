import { useEffect, useRef, type MutableRefObject } from "react";
import { CronExpressionParser } from "cron-parser";
import type { PendingExecutionTask, Repository, WorkflowTemplateItem } from "../types";
import { buildClaudeOutgoingPrompt } from "../services/claudeComposerPrompt";
import { patchRepositoryScheduledClaudeTask, readRepositoryScheduledClaudeTasks } from "../services/repositoryScheduledClaudeTasksStore";
import { runShellCommand } from "../services/terminal";
import {
  resolveScheduledTaskExecutionKind,
} from "../utils/scheduledTaskExecution";
import { buildScheduledTaskScriptCommand } from "../utils/scheduledTaskScript";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";
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

/**
 * 按侧栏仓库列表轮询：到达 cron 下一档时执行仓库定时任务（Claude 提示词 / Shell 脚本）。
 * Claude：默认新建独立会话；若配置了 workflowId 则按团队工作流派发。
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

        for (const repo of repos) {
          const repoPath = repo.path.trim();
          if (!repoPath) continue;

          let tasks: Awaited<ReturnType<typeof readRepositoryScheduledClaudeTasks>>;
          try {
            tasks = await readRepositoryScheduledClaudeTasks(repoPath);
          } catch {
            continue;
          }
          if (tasks.length === 0) continue;

          for (const task of tasks) {
            if (!task.enabled) continue;
            const cron = task.cronExpression.trim();
            if (!cron) continue;

            let nextFireMs: number;
            try {
              const iter = CronExpressionParser.parse(cron, {
                currentDate: new Date(task.lastScheduledSlotAt ?? 0),
              });
              nextFireMs = iter.next().getTime();
            } catch {
              continue;
            }

            if (nextFireMs > now) continue;

            const executionKind = resolveScheduledTaskExecutionKind(task);

            if (executionKind === "script") {
              const built = buildScheduledTaskScriptCommand(task);
              if (!built.ok) {
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: `${built.reason}，已跳过`,
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
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: ok,
                  lastExecuteMessage: ok ? undefined : detail,
                });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: `脚本执行失败：${msg}`,
                });
              }
              continue;
            }

            const md = task.contentMarkdown.trim();
            if (!md) {
              await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                lastScheduledSlotAt: nextFireMs,
                lastExecutedAt: now,
                lastExecuteOk: false,
                lastExecuteMessage: "执行内容为空，已跳过",
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
              await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                lastScheduledSlotAt: nextFireMs,
                lastExecutedAt: now,
                lastExecuteOk: false,
                lastExecuteMessage: `组装提示失败：${msg}`,
              });
              continue;
            }

            if (!outbound.trim()) {
              await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                lastScheduledSlotAt: nextFireMs,
                lastExecutedAt: now,
                lastExecuteOk: false,
                lastExecuteMessage: "组装提示结果为空",
              });
              continue;
            }

            const wfId = task.workflowId?.trim() ?? "";
            let workerSessionId: string | null = null;
            try {
              if (wfId) {
                const wf = workflowTemplates.find((t) => t.id === wfId);
                if (!wf) {
                  await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                    lastScheduledSlotAt: nextFireMs,
                    lastExecutedAt: now,
                    lastExecuteOk: false,
                    lastExecuteMessage: "所选团队工作流不存在或不可用，已跳过",
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
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: ok,
                  lastExecuteMessage: ok ? undefined : "工作流派发失败或未启动",
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
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: "新建会话未启动（可能已达并发上限）",
                });
                continue;
              }
              await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                lastScheduledSlotAt: nextFireMs,
                lastExecutedAt: now,
                lastExecuteOk: true,
                lastExecuteMessage: undefined,
              });
            } catch (e) {
              if (workerSessionId) void closeSession(workerSessionId);
              const msg = e instanceof Error ? e.message : String(e);
              await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                lastScheduledSlotAt: nextFireMs,
                lastExecutedAt: now,
                lastExecuteOk: false,
                lastExecuteMessage: `执行失败：${msg}`,
              });
            }
          }
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void tick();
    }, readVisiblePollIntervalMs(TICK_MS, TICK_MS_HIDDEN));
    void tick();
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void tick();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
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
