import type { WorkflowGraph, WorkflowGraphNode } from "../types";
import type { BranchEvaluationContext } from "./workflowBranchEvaluation";
import { workflowVariablesFromGraph } from "./workflowGraphRuntime";
import { formatPromptPassthroughBlockFromNode } from "./workflowPromptTemplate";
import { formatCodePassthroughBlockFromNode } from "./workflowCodeExecution";

function passthroughContext(graph: WorkflowGraph | null | undefined, taskContent?: string): BranchEvaluationContext {
  return {
    variables: graph ? workflowVariablesFromGraph(graph) : {},
    taskContent,
  };
}

export function formatKnowledgePassthroughBlock(node: WorkflowGraphNode): string {
  const query = typeof node.data.knowledgeQuery === "string" ? node.data.knowledgeQuery.trim() : "";
  const label = (node.data.label || node.id).trim() || node.id;
  const lines = [
    "【知识检索】",
    `节点「${label}」：请结合当前仓库的代码知识图谱检索相关上下文后再继续后续任务。`,
  ];
  if (query) {
    lines.push("", `检索意图：${query}`);
  }
  return lines.join("\n");
}

export function formatCodePassthroughBlock(node: WorkflowGraphNode, ctx?: BranchEvaluationContext): string {
  return formatCodePassthroughBlockFromNode(node, ctx ?? {});
}

export function formatPassthroughBlockForNode(
  node: WorkflowGraphNode,
  graph?: WorkflowGraph | null,
  taskContent?: string,
): string {
  if (node.type === "prompt") {
    return formatPromptPassthroughBlockFromNode(node, passthroughContext(graph, taskContent));
  }
  if (node.type === "knowledge") return formatKnowledgePassthroughBlock(node);
  if (node.type === "code") return formatCodePassthroughBlock(node, passthroughContext(graph, taskContent));
  return "";
}

export function isPassthroughGraphNodeType(type: WorkflowGraphNode["type"]): boolean {
  return type === "prompt" || type === "knowledge" || type === "code";
}
