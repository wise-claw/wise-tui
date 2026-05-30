import { useEffect, useRef, type MutableRefObject } from "react";
import { CronExpressionParser } from "cron-parser";
import type { ClaudeSession, EmployeeItem, PendingExecutionTask, Repository, WorkflowTemplateItem } from "../types";
import { buildClaudeOutgoingPrompt } from "../services/claudeComposerPrompt";
import { listCcWorkflowStudioWorkflows } from "../services/ccWorkflowStudioFiles";
import { patchRepositoryScheduledClaudeTask, readRepositoryScheduledClaudeTasks } from "../services/repositoryScheduledClaudeTasksStore";
import { runShellCommand } from "../services/terminal";
import { resolveBoundMainSessionId, resolveMainOwnerAgentNameForRepositoryPath } from "../utils/repositoryMainSessionBinding";
import { isOmcMonitorEmployeeRecord } from "../utils/omcMonitorEmployeeSession";
import {
  ccWorkflowSlashCommand,
  resolveScheduledTaskExecutionKind,
} from "../utils/scheduledTaskExecution";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";

const TICK_MS = 45_000;
const TICK_MS_HIDDEN = 180_000;

interface Params {
  repositoriesRef: MutableRefObject<Repository[]>;
  sessionsRef: MutableRefObject<ClaudeSession[]>;
  bindingsRef: MutableRefObject<Record<string, string>>;
  employeesRef: MutableRefObject<EmployeeItem[]>;
  workflowTemplatesRef: MutableRefObject<WorkflowTemplateItem[]>;
  executeRef: MutableRefObject<
    (
      sessionId: string,
      prompt: string,
      dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
    ) => Promise<boolean>
  >;
  sendMessageRef: MutableRefObject<(sessionId: string, prompt: string) => void | Promise<void>>;
}

function truncateMessage(text: string, max = 240): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/**
 * 按侧栏仓库列表轮询：到达 cron 下一档时执行仓库定时任务（Claude 提示词 / Shell 脚本 / CC 工作流）。
 */
export function useScheduledClaudeTaskRunner({
  repositoriesRef,
  sessionsRef,
  bindingsRef,
  employeesRef,
  workflowTemplatesRef,
  executeRef,
  sendMessageRef,
}: Params): void {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const repos = repositoriesRef.current;
        const sessions = sessionsRef.current;
        const bindings = bindingsRef.current;
        const employees = employeesRef.current;
        const workflowTemplates = workflowTemplatesRef.current;
        const execute = executeRef.current;
        const sendMessage = sendMessageRef.current;
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

          const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repos, repoPath);
          const mainId = resolveBoundMainSessionId(repoPath, bindings, sessions, mainOwnerPick);
          const mainSess = mainId ? sessions.find((s) => s.id === mainId) : undefined;
          const mainSessionBusy =
            mainSess != null &&
            mainSess.repositoryPath.trim() === repoPath &&
            (mainSess.status === "running" || mainSess.status === "connecting");

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
              const script = task.contentMarkdown.trim();
              if (!script) {
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: "脚本内容为空，已跳过",
                });
                continue;
              }
              try {
                const result = await runShellCommand(repoPath, script);
                const ok = result.exit_code === 0;
                const detail = [
                  ok ? "脚本执行成功" : `脚本退出码 ${result.exit_code}`,
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

            if (!mainId || !mainSess || mainSess.repositoryPath.trim() !== repoPath) continue;
            if (mainSessionBusy) continue;

            if (executionKind === "workflow") {
              const ccWorkflowId = task.ccWorkflowId?.trim() ?? "";
              if (!ccWorkflowId) {
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: "未配置工作流，已跳过",
                });
                continue;
              }
              let workflows: Awaited<ReturnType<typeof listCcWorkflowStudioWorkflows>>;
              try {
                workflows = await listCcWorkflowStudioWorkflows(repoPath);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: `读取工作流列表失败：${msg}`,
                });
                continue;
              }
              const wf = workflows.find((item) => item.id === ccWorkflowId);
              if (!wf) {
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: "所选 CC 工作流不存在或不可用，已跳过",
                });
                continue;
              }
              const slash = ccWorkflowSlashCommand(wf.name);
              if (!slash) {
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: "工作流名称为空，已跳过",
                });
                continue;
              }
              try {
                await sendMessage(mainId, slash);
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: true,
                  lastExecuteMessage: `已发送 ${slash}`,
                });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: `工作流执行失败：${msg}`,
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
            const empId = task.employeeId?.trim() ?? "";
            let dispatch:
              | Pick<
                  PendingExecutionTask,
                  "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName"
                >
              | undefined;

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
              dispatch = {
                targetType: "team",
                targetWorkflowId: wf.id,
                targetWorkflowName: wf.name.trim(),
              };
            } else if (empId) {
              const emp = employees.find((e) => e.id === empId && !isOmcMonitorEmployeeRecord(e));
              if (!emp) {
                await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
                  lastScheduledSlotAt: nextFireMs,
                  lastExecutedAt: now,
                  lastExecuteOk: false,
                  lastExecuteMessage: "所选员工不存在或不可用，已跳过",
                });
                continue;
              }
              dispatch = { targetType: "employee", targetEmployeeName: emp.name.trim() };
            }

            const ok = await execute(mainId, outbound, dispatch);
            await patchRepositoryScheduledClaudeTask(repoPath, task.id, {
              lastScheduledSlotAt: nextFireMs,
              lastExecutedAt: now,
              lastExecuteOk: ok,
              lastExecuteMessage: ok ? undefined : "执行被拒绝或未启动（可能仍受并发限制）",
            });
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
  }, [bindingsRef, employeesRef, executeRef, repositoriesRef, sendMessageRef, sessionsRef, workflowTemplatesRef]);
}
