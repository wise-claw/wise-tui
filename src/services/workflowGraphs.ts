import { invoke } from "@tauri-apps/api/core";
import type { WorkflowGraph } from "../types";
import { validateWorkflowGraphStructure } from "./workflowGraphValidation";

export interface GetWorkflowGraphParams {
  workflowId: string;
}

export interface SaveWorkflowGraphParams {
  workflowId: string;
  graph: WorkflowGraph;
  version?: number;
  status?: "draft" | "published";
}

export interface ValidateWorkflowGraphParams {
  graph: WorkflowGraph;
}

export interface WorkflowGraphValidationResult {
  ok: boolean;
  errors: WorkflowGraphValidationError[];
}

export interface WorkflowGraphValidationError {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowGraphItem {
  workflowId: string;
  version: number;
  graph: WorkflowGraph;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export async function getWorkflowGraph(params: GetWorkflowGraphParams): Promise<WorkflowGraphItem | null> {
  return invoke<WorkflowGraphItem | null>("get_workflow_graph", { workflowId: params.workflowId });
}

export async function saveWorkflowGraph(params: SaveWorkflowGraphParams): Promise<WorkflowGraphItem> {
  return invoke<WorkflowGraphItem>("save_workflow_graph", {
    workflowId: params.workflowId,
    graph: params.graph,
    version: params.version,
    status: params.status,
  });
}

export async function validateWorkflowGraph(
  params: ValidateWorkflowGraphParams,
): Promise<WorkflowGraphValidationResult> {
  const clientResult = validateWorkflowGraphStructure(params.graph);
  if (!clientResult.ok) return clientResult;
  return invoke<WorkflowGraphValidationResult>("validate_workflow_graph", { graph: params.graph });
}
