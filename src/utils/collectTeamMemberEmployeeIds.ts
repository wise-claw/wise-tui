import type { WorkflowGraph, WorkflowTemplateItem } from "../types";

/** 与「员工配置」中「团队成员」列一致：模板阶段指派 + 流程图节点上的员工。 */
export function collectTeamMemberEmployeeIds(
  workflowTemplates: WorkflowTemplateItem[],
  workflowGraphsByWorkflowId: Record<string, WorkflowGraph> = {},
): Set<string> {
  const result = new Set<string>();
  for (const template of workflowTemplates) {
    for (const stage of template.stages) {
      for (const assignee of stage.assignees) {
        if (assignee.employeeId.trim()) {
          result.add(assignee.employeeId);
        }
      }
    }
    const graph = workflowGraphsByWorkflowId[template.id];
    for (const node of graph?.nodes ?? []) {
      const employeeId = typeof node.data?.employeeId === "string" ? node.data.employeeId.trim() : "";
      if (employeeId) {
        result.add(employeeId);
      }
    }
  }
  return result;
}
