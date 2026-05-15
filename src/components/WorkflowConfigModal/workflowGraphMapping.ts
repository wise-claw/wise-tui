import type { EmployeeItem, WorkflowGraph, WorkflowGraphNodeData, WorkflowTemplateStage } from "../../types";
import { normalizeWorkflowStageOutcomeCriteria } from "../../utils/workflowStageOutcomeCriteria";
import { normalizeStageTaskBasisRefsFromNodeData } from "../../services/workflowGraphRuntime";
import type { CanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import { normalizeCanvasSnapshot, workflowGraphToCanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";

export function canvasSnapshotToWorkflowGraph(snapshot: CanvasSnapshot, fallbackEmployeeId?: string): WorkflowGraph {
  const normalizedSnapshot = normalizeCanvasSnapshot(snapshot);
  return {
    nodes: normalizedSnapshot.nodes.map((node) => {
      if (node.kind === "start") {
        return {
          id: node.id,
          type: "start",
          position: { x: node.x, y: node.y },
          data: {
            ...node.passthroughData,
            label: node.title || "开始",
          },
        };
      }
      if (node.kind === "end") {
        return {
          id: node.id,
          type: "end",
          position: { x: node.x, y: node.y },
          data: {
            ...node.passthroughData,
            label: node.title || "结束",
          },
        };
      }
      const stageSuccess = normalizeWorkflowStageOutcomeCriteria(node.stageSuccessCriteria);
      const basisRefs = normalizeStageTaskBasisRefsFromNodeData({
        label: node.title || "",
        stageTaskBasisRefs: node.stageTaskBasisRefs,
        stageTaskBasisRef: typeof node.stageTaskBasisRef === "string" ? node.stageTaskBasisRef : undefined,
      } as WorkflowGraphNodeData);
      return {
        id: node.id,
        type: "approval",
        position: { x: node.x, y: node.y },
        data: {
          ...node.passthroughData,
          label: node.title || "审批节点",
          employeeId: node.employeeId || fallbackEmployeeId,
          employeePrompt: node.stageTask || "",
          conditionIfPrompt: node.acceptanceEnabled ? node.acceptanceCriteria || "" : "",
          conditionElsePrompt: node.acceptanceEnabled ? "acceptance_enabled" : "",
          materialKey: node.materialKey || "employee",
          ...(stageSuccess.length > 0 ? { stageSuccessCriteria: stageSuccess } : {}),
          ...(basisRefs.length > 0 ? { stageTaskBasisRefs: basisRefs } : {}),
        },
      };
    }),
    edges: normalizedSnapshot.edges.map((edge, index) => ({
      id: edge.id || `edge-${index + 1}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort,
      targetHandle: edge.targetPort,
      data: {
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
      },
    })),
  };
}

export function canvasSnapshotToStages(snapshot: CanvasSnapshot, employees: EmployeeItem[]): WorkflowTemplateStage[] {
  const normalizedSnapshot = normalizeCanvasSnapshot(snapshot);
  const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
  const materialNodes = normalizedSnapshot.nodes
    .filter((node) => node.kind === "material" && (node.materialKey === "employee" || Boolean(node.employeeId)))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  return materialNodes.map((node, index) => ({
    id: node.id,
    name: node.title || `阶段${index + 1}`,
    stageOrder: index,
    passRule: "ALL_APPROVE",
    rejectRule: "ANY_REJECT_BACK",
    assignees: node.employeeId || fallbackEmployeeId ? [{ id: "", employeeId: node.employeeId || fallbackEmployeeId!, requiredCount: 1, isRequired: true }] : [],
  }));
}

export { workflowGraphToCanvasSnapshot };
