import type { TaskRole } from "../../types";

export type RequirementEntry = {
  id: string;
  type: "functional" | "nonFunctional" | "acceptance";
  label: string;
  content: string;
};

export type TaskRoleFilter = "all" | TaskRole;
export type SplitRuntimeLogRole = "system" | "user" | "assistant" | "error";
export type SplitRetryPhase = "phase1" | "phase2";
export type SplitPromptDraftBySlot = Record<string, string>;
export type RequirementNameModalMode = "save" | "create";

export interface SplitRuntimeLogItem {
  id: string;
  role: SplitRuntimeLogRole;
  text: string;
  at: number;
  retryPhase?: SplitRetryPhase;
}

export interface SplitQualitySummary {
  totalTasks: number;
  mappedTaskCount: number;
  traceableTaskCount: number;
  untraceableTaskIds: string[];
}

export type SplitApplyMode = "replace" | "append";
export type SplitWizardStep = "prompts" | "runtime";
