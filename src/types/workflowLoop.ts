import type { WorkflowBranchCondition } from "./workflowBranch";
import type { WorkflowVariableDefinition } from "../types";

export const WORKFLOW_LOOP_BODY_PORT = "loop-body" as const;
export const WORKFLOW_LOOP_NEXT_PORT = "loop-next" as const;
export const WORKFLOW_LOOP_BACK_PORT = "loop-back" as const;
export const WORKFLOW_LOOP_BACK_TARGET_PORT = "loop-back-in" as const;

export const DEFAULT_WORKFLOW_LOOP_MAX_ITERATIONS = 10;
export const MIN_WORKFLOW_LOOP_MAX_ITERATIONS = 1;
export const MAX_WORKFLOW_LOOP_MAX_ITERATIONS = 100;

export interface WorkflowLoopFrame {
  loopNodeId: string;
  iteration: number;
  variables: Record<string, string>;
}

export interface WorkflowLoopConfig {
  loopVariables: WorkflowVariableDefinition[];
  loopExitConditions: WorkflowBranchCondition[];
  loopMaxIterations: number;
}
