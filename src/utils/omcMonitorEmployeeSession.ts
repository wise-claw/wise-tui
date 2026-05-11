import { OMC_MONITOR_EMPLOYEE_NAME } from "../constants/omcMonitor";
import type { EmployeeItem } from "../types";

/** 与 `App.tsx` 中 `extractBoundEmployeeNameFromSessionRepositoryName` 语义一致，供侧栏 OMC 与会话路径解析复用。 */
export function extractRepositoryBoundEmployeeName(repositoryName: string | undefined): string | null {
  if (!repositoryName?.trim()) {
    return null;
  }
  const marker = "员工:";
  const idx = repositoryName.lastIndexOf(marker);
  if (idx < 0) {
    return null;
  }
  const value = repositoryName.slice(idx + marker.length).trim();
  return value || null;
}

/**
 * 配置里「直连批量 OMC」绑定的员工：优先 `agentType === omc`（与监控行 `agentType: omc` 一致），否则回退展示名 `OMC员工`。
 */
export function resolveConfiguredOmcEmployee(employees: readonly EmployeeItem[]): EmployeeItem | undefined {
  const byType = employees.find((e) => e.enabled && e.agentType.trim().toLowerCase() === "omc");
  if (byType) return byType;
  return employees.find((e) => e.enabled && e.name.trim() === OMC_MONITOR_EMPLOYEE_NAME);
}

/**
 * 旧版直连批量/监控员工标签使用 `…/员工:OMC`（短后缀），与当前默认展示名 `…/员工:OMC员工` 不一致；
 * 关闭旧标签与 `prepareFreshOmcEmployeeWorkerForDirectBatch` 时必须识别该后缀，否则会沿用旧 Wise 标签与 Claude 会话。
 */
const LEGACY_OMC_EMPLOYEE_REPOSITORY_BOUND_SHORT = "OMC";

/**
 * 仓库标签 `…/员工:xxx` 中，应视为「OMC 监控工作会话」的 `xxx` 取值集合（含旧版默认名与当前配置名）。
 */
export function omcWorkerRepositoryBoundNameMatchers(employees: readonly EmployeeItem[]): Set<string> {
  const s = new Set<string>([OMC_MONITOR_EMPLOYEE_NAME, LEGACY_OMC_EMPLOYEE_REPOSITORY_BOUND_SHORT]);
  const hit = resolveConfiguredOmcEmployee(employees);
  const n = hit?.name?.trim();
  if (n) s.add(n);
  return s;
}

/** 主会话输入框 @ 派发：排除直连批量 OMC / 监控绑定员工，避免与真人 @ 派发同时命中。 */
export function isOmcMonitorDispatchMentionName(name: string): boolean {
  const t = name.trim();
  if (!t) return false;
  if (t === OMC_MONITOR_EMPLOYEE_NAME) return true;
  if (t === LEGACY_OMC_EMPLOYEE_REPOSITORY_BOUND_SHORT) return true;
  return false;
}

export function isOmcMonitorEmployeeRecord(employee: Pick<EmployeeItem, "id" | "name" | "agentType">): boolean {
  if (employee.agentType?.trim().toLowerCase() === "omc") return true;
  return isOmcMonitorDispatchMentionName(employee.name);
}
