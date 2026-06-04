import {
  SESSION_EXECUTION_ENGINE_LABELS,
  SESSION_EXECUTION_ENGINES,
  type SessionExecutionEngine,
} from "../constants/sessionExecutionEngine";
import type { ClaudeSession, SessionConversationTaskItem } from "../types";
import { extractBoundEmployeeNameFromSessionRepositoryName } from "../services/workflowGraphHelpers";
import { findTerminalWorkerTab, normalizeTerminalDispatchName } from "../services/terminalDispatch";
import {
  parseExecutionEnvironmentWorkerRepositoryName,
} from "./executionEnvironmentDispatch";
import { resolveExecutionEnvironmentWorkerConversationTaskStatus } from "./sessionConversationTasks";

export type EmployeeTerminalConversationStatus =
  | SessionConversationTaskItem["status"]
  | "idle";

function parseEngineFromTaskSubtitle(subtitle: string | undefined): SessionExecutionEngine | null {
  const raw = subtitle?.trim() ?? "";
  if (!raw) return null;
  const head = raw.split(" · ")[0]?.trim() ?? raw;
  for (const engine of SESSION_EXECUTION_ENGINES) {
    const labels = SESSION_EXECUTION_ENGINE_LABELS[engine];
    if (head === labels.short || head === labels.title || head.toLowerCase() === engine) {
      return engine;
    }
  }
  return null;
}

function employeeMatchesEngineByName(employeeName: string, engine: SessionExecutionEngine): boolean {
  const norm = normalizeTerminalDispatchName(employeeName);
  const labels = SESSION_EXECUTION_ENGINE_LABELS[engine];
  const candidates = new Set<string>([
    engine,
    labels.short.toLowerCase(),
    normalizeTerminalDispatchName(labels.short),
    normalizeTerminalDispatchName(labels.title),
  ]);
  return candidates.has(norm);
}

function findWorkerSession(
  sessions: readonly ClaudeSession[],
  workerSessionId: string,
): ClaudeSession | undefined {
  const key = workerSessionId.trim();
  if (!key) return undefined;
  return (
    sessions.find((session) => session.id === key) ??
    sessions.find((session) => session.claudeSessionId?.trim() === key)
  );
}

function countEmployeesMatchingEngine(
  employeeNames: readonly string[],
  engine: SessionExecutionEngine,
): number {
  return employeeNames.filter((name) => employeeMatchesEngineByName(name, engine)).length;
}

function dispatchTaskBelongsToEmployee(
  task: SessionConversationTaskItem,
  employeeName: string,
  sessions: readonly ClaudeSession[],
  panelEmployeeNames: readonly string[],
): boolean {
  const worker = task.sessionId ? findWorkerSession(sessions, task.sessionId) : undefined;
  if (worker) {
    const bound = extractBoundEmployeeNameFromSessionRepositoryName(worker.repositoryName);
    if (bound && normalizeTerminalDispatchName(bound) === normalizeTerminalDispatchName(employeeName)) {
      return true;
    }
    if (task.source === "execution_environment") {
      const engine =
        parseExecutionEnvironmentWorkerRepositoryName(worker.repositoryName)?.engine ??
        parseEngineFromTaskSubtitle(task.subtitle);
      if (engine && employeeMatchesEngineByName(employeeName, engine)) {
        return countEmployeesMatchingEngine(panelEmployeeNames, engine) === 1;
      }
    }
    return false;
  }

  if (task.source === "execution_environment") {
    const engine = parseEngineFromTaskSubtitle(task.subtitle);
    if (engine && employeeMatchesEngineByName(employeeName, engine)) {
      return countEmployeesMatchingEngine(panelEmployeeNames, engine) === 1;
    }
  }
  return false;
}

function pickDominantStatus(
  entries: Array<{ status: EmployeeTerminalConversationStatus; updatedAt: number }>,
): EmployeeTerminalConversationStatus {
  if (entries.length === 0) return "idle";
  if (entries.some((entry) => entry.status === "running")) return "running";
  const settled = entries.filter((entry) => entry.status !== "idle");
  if (settled.length === 0) return "idle";
  return settled.sort((left, right) => right.updatedAt - left.updatedAt)[0]!.status;
}

/** 终端行与「派发任务」同源：绑定 worker 标签或唯一引擎名匹配。 */
export function resolveEmployeeTerminalConversationStatus(input: {
  employeeName: string;
  repositoryPath: string;
  sessions: readonly ClaudeSession[];
  dispatchTasks: readonly SessionConversationTaskItem[];
  panelEmployeeNames: readonly string[];
}): EmployeeTerminalConversationStatus {
  const entries: Array<{ status: EmployeeTerminalConversationStatus; updatedAt: number }> = [];

  for (const task of input.dispatchTasks) {
    if (!dispatchTaskBelongsToEmployee(task, input.employeeName, input.sessions, input.panelEmployeeNames)) {
      continue;
    }
    entries.push({ status: task.status, updatedAt: task.updatedAt });
  }

  const terminalWorker = findTerminalWorkerTab(
    [...input.sessions],
    input.repositoryPath,
    input.employeeName,
  );
  if (terminalWorker) {
    entries.push({
      status: resolveExecutionEnvironmentWorkerConversationTaskStatus(terminalWorker),
      updatedAt:
        terminalWorker.messages[terminalWorker.messages.length - 1]?.timestamp ??
        terminalWorker.createdAt,
    });
  }

  return pickDominantStatus(entries);
}

export function buildEmployeeTerminalConversationStatusById(input: {
  employeeItems: ReadonlyArray<{ employeeId: string; name: string }>;
  repositoryPath: string;
  sessions: readonly ClaudeSession[];
  dispatchTasks: readonly SessionConversationTaskItem[];
}): Map<string, EmployeeTerminalConversationStatus> {
  const panelEmployeeNames = input.employeeItems.map((item) => item.name);
  const map = new Map<string, EmployeeTerminalConversationStatus>();
  for (const item of input.employeeItems) {
    map.set(
      item.employeeId,
      resolveEmployeeTerminalConversationStatus({
        employeeName: item.name,
        repositoryPath: input.repositoryPath,
        sessions: input.sessions,
        dispatchTasks: input.dispatchTasks,
        panelEmployeeNames,
      }),
    );
  }
  return map;
}
