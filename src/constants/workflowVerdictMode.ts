export const WORKFLOW_VERDICT_MODE_STORAGE_KEY = "wise.workflow.verdict.mode";

export type WorkflowVerdictMode = "heuristic" | "structured_only" | "structured_plus_extractor";

export const DEFAULT_WORKFLOW_VERDICT_MODE: WorkflowVerdictMode = "structured_plus_extractor";
