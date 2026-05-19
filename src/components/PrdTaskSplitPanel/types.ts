import type { TaskRole } from "../../types";

export type RequirementEntry = {
  id: string;
  type: "functional" | "nonFunctional" | "acceptance";
  label: string;
  content: string;
};

export type TaskRoleFilter = "all" | TaskRole;
export type SplitRuntimeLogRole = "system" | "user" | "assistant" | "error";
export type SplitRuntimeLogScope = "main" | "subagent";
export type SplitRuntimeLogStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "info";
export type SplitRetryPhase = "phase1" | "phase2";
export type SplitPromptDraftBySlot = Record<string, string>;
export type RequirementNameModalMode = "save" | "create";

export interface SplitRuntimeLogDetail {
  label: string;
  value: string;
}

export interface SplitRuntimeLogItem {
  id: string;
  role: SplitRuntimeLogRole;
  text: string;
  at: number;
  retryPhase?: SplitRetryPhase;
  scope?: SplitRuntimeLogScope;
  agentName?: string;
  clusterId?: string;
  title?: string;
  status?: SplitRuntimeLogStatus;
  details?: SplitRuntimeLogDetail[];
}

export interface SplitQualitySummary {
  totalTasks: number;
  mappedTaskCount: number;
  traceableTaskCount: number;
  untraceableTaskIds: string[];
}

export type SplitApplyMode = "replace" | "append";
export type SplitWizardStep = "prompts" | "runtime";
