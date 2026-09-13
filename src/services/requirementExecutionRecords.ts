import { invoke } from "@tauri-apps/api/core";
import type { ClaudeSession } from "../types";
import type { RequirementExecutionRecord } from "../types/requirementExecutionRecord";
import { buildRequirementExecutionRecord } from "../utils/requirementExecutionRecord";

export const REQUIREMENT_EXECUTION_RECORDS_CHANGED = "wise:requirement-execution-records-changed";

export async function listRequirementExecutionRecords(requirementId: string): Promise<RequirementExecutionRecord[]> {
  return invoke("list_requirement_execution_records", { requirementId });
}

export async function appendRequirementExecutionRecord(record: RequirementExecutionRecord): Promise<void> {
  await invoke("append_requirement_execution_record", { record });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REQUIREMENT_EXECUTION_RECORDS_CHANGED, { detail: record.requirementId }));
  }
}

/** 运行收尾旁路记录：存储故障不得打断会话自身的完成处理。 */
export function recordRequirementExecution(
  session: ClaudeSession | undefined,
  outcome: "processed" | "incomplete" | "failed" | "cancelled",
  summary: string,
): void {
  if (!session?.requirementId) return;
  const record = buildRequirementExecutionRecord(session, outcome, summary, Date.now());
  if (!record) return;
  void appendRequirementExecutionRecord(record).catch((error) => {
    console.error("[RequirementExecution] 保存执行记录失败", error);
  });
}

export async function recordRequirementReview(requirementId: string, sessionId: string, outcome: "accepted" | "rejected" | "reopened", summary = ""): Promise<void> {
  await appendRequirementExecutionRecord({
    id: crypto.randomUUID(), requirementId, sessionId, kind: "review", outcome,
    startedAt: null, finishedAt: Date.now(), engine: "", summary: summary.slice(0, 4000), files: [],
  });
}
