import { normalizeSessionExecutionEngine, type SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { EmployeeItem, Repository } from "../types";
import { extractBoundEmployeeNameFromDisplay } from "./sessionOwnerHints";
import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";

type ClaudeSessionLike = {
  repositoryPath: string;
  repositoryName: string;
};

export function resolveSessionExecutionEngine(
  session: ClaudeSessionLike,
  repositories: readonly Repository[],
  employees: readonly EmployeeItem[],
): SessionExecutionEngine {
  const employeeName = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  if (employeeName) {
    const match = employees.find(
      (employee) => employee.enabled && employee.name.trim() === employeeName.trim(),
    );
    if (match) {
      return normalizeSessionExecutionEngine(match.executionEngine);
    }
  }

  const pathKey = normalizeRepositoryPathKey(session.repositoryPath ?? "");
  const repo = repositories.find((item) => normalizeRepositoryPathKey(item.path) === pathKey);
  return normalizeSessionExecutionEngine(repo?.executionEngine);
}
