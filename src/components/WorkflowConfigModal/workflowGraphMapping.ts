import type { EmployeeItem, WorkflowGraph, WorkflowGraphNode, WorkflowGraphNodeData, WorkflowTemplateStage } from "../../types";
import { normalizeWorkflowStageOutcomeCriteria } from "../../utils/workflowStageOutcomeCriteria";
import { branchPortLabelFromId, normalizeBranchConditions } from "../../services/workflowBranchEvaluation";
import { normalizePromptMessages, serializePromptConfigToNodeData } from "../../services/workflowPromptTemplate";
import { codeConfigFromNodeData, serializeCodeConfigToNodeData } from "../../services/workflowCodeExecution";
import { knowledgeConfigFromNodeData, serializeKnowledgeConfigToNodeData } from "../../services/workflowKnowledgeRetrieval";
import { normalizeStageTaskBasisRefsFromNodeData } from "../../services/workflowGraphRuntime";
import type { CanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import {
  isAgentMaterialKey,
  isTransformGraphMaterialKey,
  normalizeCanvasSnapshot,
  workflowGraphToCanvasSnapshot,
} from "../workflowGraph/workflowX6CanvasShared";

function materialKeyToGraphType(materialKey: string): WorkflowGraphNode["type"] {
  if (materialKey === "prompt") return "prompt";
  if (materialKey === "knowledge") return "knowledge";
  if (materialKey === "code") return "code";
  if (materialKey === "branch") return "branch";
  return "approval";
}

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
            ...(node.workflowVariables && node.workflowVariables.length > 0
              ? { workflowVariables: node.workflowVariables }
              : {}),
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
      const materialKey = node.materialKey || "employee";
      const graphType = materialKeyToGraphType(materialKey);
      if (isTransformGraphMaterialKey(materialKey)) {
        return {
          id: node.id,
          type: graphType,
          position: { x: node.x, y: node.y },
          data: {
            ...node.passthroughData,
            label: node.title || MATERIAL_FALLBACK_LABEL[materialKey] || "节点",
            materialKey,
            ...(materialKey === "prompt"
              ? serializePromptConfigToNodeData({
                  messages: normalizePromptMessages(node.promptMessages),
                  injectionMode: node.promptInjectionMode === "user_prefix" ? "user_prefix" : "structured_block",
                  requireAcknowledgement: Boolean(node.promptRequireAcknowledgement),
                })
              : {}),
            ...(materialKey === "knowledge"
              ? serializeKnowledgeConfigToNodeData(
                  knowledgeConfigFromNodeData({
                    label: node.title || "",
                    knowledgeQuery: node.knowledgeQuery,
                    knowledgeSearchMode: node.knowledgeSearchMode,
                    knowledgeNodeKinds: node.knowledgeNodeKinds,
                    knowledgeTopK: node.knowledgeTopK,
                    knowledgeSubgraphHop: node.knowledgeSubgraphHop,
                    knowledgeSubgraphDirection: node.knowledgeSubgraphDirection,
                    knowledgePathPrefix: node.knowledgePathPrefix,
                    knowledgeOutputMode: node.knowledgeOutputMode,
                    knowledgeRequireCitation: node.knowledgeRequireCitation,
                    knowledgeOutputVariable: node.knowledgeOutputVariable,
                    knowledgeSupplementQueries: node.knowledgeSupplementQueries,
                  }),
                )
              : {}),
            ...(materialKey === "code"
              ? serializeCodeConfigToNodeData(
                  codeConfigFromNodeData({
                    label: node.title || "",
                    codeScript: node.codeScript,
                    codeMode: node.codeMode,
                    codeLanguage: node.codeLanguage,
                    codeSource: node.codeSource,
                    codeInputBindings: node.codeInputBindings,
                    codeOutputVariables: node.codeOutputVariables,
                    codeRequireStructuredOutput: node.codeRequireStructuredOutput,
                    codeWorkingDirectory: node.codeWorkingDirectory,
                    codeTimeoutSeconds: node.codeTimeoutSeconds,
                  }),
                )
              : {}),
            ...(materialKey === "branch"
              ? {
                  branchCriteria: node.branchCriteria || "",
                  branchConditions: normalizeBranchConditions(node.branchConditions),
                }
              : {}),
          },
        };
      }
      const stageSuccess = normalizeWorkflowStageOutcomeCriteria(node.stageSuccessCriteria);
      const basisRefs = normalizeStageTaskBasisRefsFromNodeData({
        label: node.title || "",
        stageTaskBasisRefs: node.stageTaskBasisRefs,
        stageTaskBasisRef: typeof node.stageTaskBasisRef === "string" ? node.stageTaskBasisRef : undefined,
      } as WorkflowGraphNodeData);
      const acceptanceEnabled = node.acceptanceEnabled || materialKey === "gateway";
      return {
        id: node.id,
        type: "approval",
        position: { x: node.x, y: node.y },
        data: {
          ...node.passthroughData,
          label: node.title || "审批节点",
          employeeId: node.employeeId || fallbackEmployeeId,
          employeePrompt: node.stageTask || "",
          conditionIfPrompt: acceptanceEnabled ? node.acceptanceCriteria || "" : "",
          conditionElsePrompt: acceptanceEnabled ? "acceptance_enabled" : "",
          materialKey,
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
      label: edge.label || edgeLabelFromSourcePort(edge.sourcePort, snapshot.nodes),
      data: {
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
        ...(edge.label ? { label: edge.label } : {}),
      },
    })),
  };
}

const MATERIAL_FALLBACK_LABEL: Record<string, string> = {
  prompt: "提示词模板",
  knowledge: "知识检索",
  code: "代码执行",
  branch: "条件分支",
};

function edgeLabelFromSourcePort(sourcePort?: string, nodes?: CanvasSnapshot["nodes"]): string | undefined {
  if (sourcePort === "if") return "通过";
  if (sourcePort === "else") return "驳回";
  if (!sourcePort || !nodes) return undefined;
  for (const node of nodes) {
    if (node.materialKey !== "branch") continue;
    const label = branchPortLabelFromId(sourcePort, node.branchConditions);
    if (label) return label;
  }
  return undefined;
}

export function canvasSnapshotToStages(snapshot: CanvasSnapshot, employees: EmployeeItem[]): WorkflowTemplateStage[] {
  const normalizedSnapshot = normalizeCanvasSnapshot(snapshot);
  const fallbackEmployeeId = employees.find((employee) => employee.enabled)?.id;
  const materialNodes = normalizedSnapshot.nodes
    .filter((node) => node.kind === "material" && (isAgentMaterialKey(node.materialKey) || Boolean(node.employeeId)))
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
