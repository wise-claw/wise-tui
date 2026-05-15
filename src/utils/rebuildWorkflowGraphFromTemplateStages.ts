import type { WorkflowGraph, WorkflowTemplateStage } from "../types";
import type { CanvasSnapshot } from "../components/workflowGraph/workflowX6CanvasShared";
import { canvasSnapshotToWorkflowGraph } from "../components/WorkflowConfigModal/workflowGraphMapping";

const X_STEP = 180;
const Y_MATERIAL = 120;

/**
 * 由工作流模板的阶段列表生成「开始 → 各员工阶段 → 结束」的线性画布快照，
 * 再转为 `WorkflowGraph`（与 WorkflowConfigModal 保存路径一致）。
 */
export function buildCanvasSnapshotFromTemplateStages(stages: readonly WorkflowTemplateStage[]): CanvasSnapshot {
  const sorted = [...stages].sort((a, b) => a.stageOrder - b.stageOrder);
  const nodes: CanvasSnapshot["nodes"] = [{ id: "start", kind: "start", title: "开始", x: 0, y: 0 }];
  const edges: CanvasSnapshot["edges"] = [];
  let prevId = "start";
  sorted.forEach((stage, i) => {
    const x = 100 + i * X_STEP;
    const employeeId = stage.assignees[0]?.employeeId?.trim() || undefined;
    nodes.push({
      id: stage.id,
      kind: "material",
      title: stage.name.trim() || `阶段 ${i + 1}`,
      x,
      y: Y_MATERIAL,
      materialKey: "employee",
      employeeId,
      stageTask: "implement",
    });
    edges.push({
      id: `edge-${prevId}-to-${stage.id}`,
      source: prevId,
      target: stage.id,
      sourcePort: "bottom",
      targetPort: "top",
    });
    prevId = stage.id;
  });
  const endX = 100 + Math.max(sorted.length, 1) * X_STEP;
  nodes.push({ id: "end", kind: "end", title: "结束", x: endX, y: 0 });
  edges.push({
    id: `edge-${prevId}-to-end`,
    source: prevId,
    target: "end",
    sourcePort: "bottom",
    targetPort: "top",
  });
  return { nodes, edges };
}

export function workflowGraphFromTemplateStages(
  stages: readonly WorkflowTemplateStage[],
  fallbackEmployeeId?: string,
): WorkflowGraph {
  const snapshot = buildCanvasSnapshotFromTemplateStages(stages);
  return canvasSnapshotToWorkflowGraph(snapshot, fallbackEmployeeId);
}
