import { useEffect, useRef, type MutableRefObject } from "react";
import { CronExpressionParser } from "cron-parser";
import type { ClaudeSession, EmployeeItem, PendingExecutionTask, Repository, WorkflowTemplateItem } from "../types";
import { buildClaudeOutgoingPrompt } from "../services/claudeComposerPrompt";
import { patchRepositoryScheduledClaudeTask, readRepositoryScheduledClaudeTasks } from "../services/repositoryScheduledClaudeTasksStore";
import { resolveBoundMainSessionId, resolveMainOwnerAgentNameForRepositoryPath } from "../utils/repositoryMainSessionBinding";
import { isOmcMonitorEmployeeRecord } from "../utils/omcMonitorEmployeeSession";

const TICK_MS = 45_000;

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
}

/**
 * 按侧栏仓库列表轮询：到达 cron 下一档时在对应仓库绑定主会话上调用 `handleComposerExecute`，
 * 可选分发到员工子标签（与手动发送一致）。
 */
export function useScheduledClaudeTaskRunner({
  repositoriesRef,
  sessionsRef,
  bindingsRef,
  employeesRef,
  workflowTemplatesRef,
  executeRef,
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
          if (!mainId) continue;

          const mainSess = sessions.find((s) => s.id === mainId);
          if (!mainSess || mainSess.repositoryPath.trim() !== repoPath) continue;
          if (mainSess.status === "running" || mainSess.status === "connecting") {
            continue;
          }

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
      void tick();
    }, TICK_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [bindingsRef, employeesRef, executeRef, repositoriesRef, sessionsRef, workflowTemplatesRef]);
}
