import type { WorkspaceRequirementItem } from "../types/workspaceRequirements";

export type WorkspaceRequirementStatus = WorkspaceRequirementItem["status"];
export type WorkspaceRequirementStatusFilter = "all" | WorkspaceRequirementStatus;

export const WORKSPACE_REQUIREMENT_STATUS_FILTER_OPTIONS: Array<{
  value: WorkspaceRequirementStatusFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "open", label: "待办" },
  { value: "verifying", label: "待验证" },
  { value: "done", label: "已完成" },
];

export function matchesWorkspaceRequirementStatusFilter(
  item: WorkspaceRequirementItem,
  filter: WorkspaceRequirementStatusFilter,
): boolean {
  return filter === "all" || item.status === filter;
}
