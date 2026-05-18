import type { ClusterRunState, WizardWriteResult } from "../../PrdSplitWizard/types";
import { USER_STATUS_LABEL } from "../copy";
import type { TaskUserStatus } from "./types";

export function toUserStatus(input: {
  run: ClusterRunState | undefined;
  writeResult?: WizardWriteResult | undefined;
  validationIssueCount?: number;
}): TaskUserStatus {
  if (input.validationIssueCount && input.validationIssueCount > 0) return "blocked";
  if (input.writeResult?.error) return "blocked";
  const status = input.run?.status ?? "idle";
  if (status === "stale") return "stale";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "blocked";
  if (status === "creating-parent") return "preparing";
  if (status === "dispatching") return "running";
  if (status === "succeeded" || status === "skipped-clean") return "completed";
  return "queued";
}

export function userStatusLabel(status: TaskUserStatus): string {
  return USER_STATUS_LABEL[status];
}
