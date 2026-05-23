import type { WorkflowGraph, WorkflowGraphNode } from "../types";
import type { BranchEvaluationContext } from "./workflowBranchEvaluation";
import { workflowVariablesFromGraph } from "./workflowGraphRuntime";
import { formatPromptPassthroughBlockFromNode } from "./workflowPromptTemplate";
import { formatCodePassthroughBlockFromNode } from "./workflowCodeExecution";
import { formatKnowledgePassthroughBlockFromNode } from "./workflowKnowledgeRetrieval";

function passthroughContext(graph: WorkflowGraph | null | undefined, taskContent?: string): BranchEvaluationContext {
  return {
    variables: graph ? workflowVariablesFromGraph(graph) : {},
    taskContent,
  };
}

export function formatKnowledgePassthroughBlock(node: WorkflowGraphNode, ctx?: BranchEvaluationContext): string {
  return formatKnowledgePassthroughBlockFromNode(node, ctx ?? {});
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
  if (node.type === "knowledge") return formatKnowledgePassthroughBlock(node, passthroughContext(graph, taskContent));
  if (node.type === "code") return formatCodePassthroughBlock(node, passthroughContext(graph, taskContent));
  return "";
}

export function isPassthroughGraphNodeType(type: WorkflowGraphNode["type"]): boolean {
  return type === "prompt" || type === "knowledge" || type === "code";
}
