import { listEmployees } from "./employees";
import { listProjectPrdWorkflowIds } from "./projectPrdScope";
import { listWorkflowTemplates } from "./workflowTemplates";
import { saveWorkflowGraph } from "./workflowGraphs";
import { workflowGraphFromTemplateStages } from "../utils/rebuildWorkflowGraphFromTemplateStages";

/**
 * 将项目关联的各工作流模板，按当前阶段/指派重建为默认线性流程图并写入 DB（草稿）。
 * 用于「重新初始化项目」后使画布与模板阶段对齐；不修改模板阶段表本身。
 */
export async function regenerateProjectWorkflowGraphsFromTemplates(projectId: string): Promise<number> {
  const [workflowIds, templates, employees] = await Promise.all([
    listProjectPrdWorkflowIds(projectId),
    listWorkflowTemplates(),
    listEmployees(),
  ]);
  if (workflowIds.length === 0) return 0;
  const byId = new Map(templates.map((t) => [t.id, t]));
  const fallbackEmployeeId = employees.find((e) => e.enabled)?.id;
  let count = 0;
  for (const workflowId of workflowIds) {
    const tpl = byId.get(workflowId);
    if (!tpl || tpl.stages.length === 0) continue;
    const graph = workflowGraphFromTemplateStages(tpl.stages, fallbackEmployeeId);
    await saveWorkflowGraph({ workflowId, graph, status: "draft" });
    count += 1;
  }
  return count;
}
