import { readTrellisSpecFile, writeTrellisSpecFile } from "../trellisSpecBridge";
import {
  recordTrellisSpecRevision,
  trellisRuntimeRecordEventSafe,
} from "../trellisRuntime";
import type { ExecutionFanoutSnapshot } from "./executionFanout";
import type { PrdSplitWorkflowClusterInput } from "./workflowGraphFromSplit";

export const PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH = "guides/prd-assistant-loop-feedback.md";
export const PRD_SPLIT_LOOP_FEEDBACK_FILE_PATH = `.trellis/spec/${PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH}`;

export interface PrdSplitLoopFeedbackProject {
  id: string;
  name: string;
  rootPath: string;
}

export interface PrdSplitLoopFeedbackWriteResult {
  clusterId: string;
  parentTaskName: string;
  childTaskNames: string[];
  childTasks: Array<{
    sourceTaskId: string;
    taskName: string;
    taskPath: string;
  }>;
  fanoutFailedCount?: number;
  fanoutSnapshot?: ExecutionFanoutSnapshot;
  warnings: string[];
  error?: string;
}

export interface BuildPrdSplitLoopFeedbackEntryInput {
  project: PrdSplitLoopFeedbackProject;
  missionId: string | null;
  workflowId: string | null;
  clusters: PrdSplitWorkflowClusterInput[];
  writeResults: PrdSplitLoopFeedbackWriteResult[];
  fanoutFailedCount: number;
  createdAt?: number;
}

export interface PrdSplitLoopFeedbackResult {
  relativePath: string;
  filePath: string;
  revisionId: string;
  eventId: string | null;
  createdAt: number;
}

interface TraceRow {
  clusterId: string;
  title: string;
  sourceTaskId: string;
  taskName: string;
  taskPath: string;
  requirementIds: string[];
  anchor: string;
}

export async function recordPrdSplitLoopFeedback(
  input: BuildPrdSplitLoopFeedbackEntryInput,
): Promise<PrdSplitLoopFeedbackResult> {
  const createdAt = input.createdAt ?? Date.now();
  const entry = buildPrdSplitLoopFeedbackEntry({ ...input, createdAt });
  const existing = await readExistingFeedback(input.project.rootPath);
  const content = appendPrdSplitLoopFeedbackEntry(existing, entry);
  await writeTrellisSpecFile(input.project.rootPath, PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH, content);
  const revision = await recordTrellisSpecRevision({
    projectId: input.project.id,
    rootPath: input.project.rootPath,
    filePath: PRD_SPLIT_LOOP_FEEDBACK_FILE_PATH,
    content,
    author: "wise",
    reason: "prd_split_loop_feedback",
    source: "prd_split_assistant",
    taskPath: firstTaskPath(input.writeResults),
    createdAt,
  });
  const event = await trellisRuntimeRecordEventSafe({
    projectId: input.project.id,
    rootPath: input.project.rootPath,
    taskPath: firstTaskPath(input.writeResults),
    eventKind: "trellis.loop.spec.feedback.recorded",
    platform: "wise",
    actor: "prd-split-assistant",
    correlationId: input.missionId,
    payload: {
      missionId: input.missionId,
      workflowId: input.workflowId,
      filePath: PRD_SPLIT_LOOP_FEEDBACK_FILE_PATH,
      revisionId: revision.revisionId,
      workflowRunIds: collectWorkflowRunIds(input.writeResults),
      taskCount: input.writeResults.reduce((count, result) => count + result.childTasks.length, 0),
      fanoutFailedCount: input.fanoutFailedCount,
    },
    createdAt,
  });
  return {
    relativePath: PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH,
    filePath: PRD_SPLIT_LOOP_FEEDBACK_FILE_PATH,
    revisionId: revision.revisionId,
    eventId: event?.eventId ?? null,
    createdAt,
  };
}

export function buildPrdSplitLoopFeedbackEntry(
  input: BuildPrdSplitLoopFeedbackEntryInput,
): string {
  const createdAt = input.createdAt ?? Date.now();
  const traceRows = buildTraceRows(input.clusters, input.writeResults);
  const workflowRunIds = collectWorkflowRunIds(input.writeResults);
  const fanout = summarizeFanout(input.writeResults, input.fanoutFailedCount);
  const followUps = buildSpecFollowUps(traceRows, workflowRunIds, fanout);
  const lines: string[] = [
    `## ${new Date(createdAt).toISOString()} - PRD Split Loop Feedback`,
    "",
    `- Project: ${input.project.name || input.project.id}`,
    `- Mission: ${input.missionId ?? "unknown"}`,
    `- Workflow: ${input.workflowId ?? "not_recorded"}`,
    `- Loop state: Dispatch -> Run -> Verify -> Spec`,
    `- Fan-out: ${fanout.status}; tasks ${fanout.doneCount}/${fanout.totalCount}; failed ${fanout.failedCount}`,
    `- Verify: passed ${fanout.verifyDoneCount}/${fanout.totalCount}; failed ${fanout.verifyFailedCount}`,
    `- Workflow runs: ${workflowRunIds.length > 0 ? workflowRunIds.join(", ") : "not_recorded"}`,
    "",
    "### Six-Step Trace",
    "",
    "| Step | Evidence |",
    "| --- | --- |",
    `| 1. PRD input | ${cell(input.project.rootPath)} |`,
    `| 2. Requirements index | ${cell(unique(traceRows.flatMap((row) => row.requirementIds)).join(", ") || "not_recorded")} |`,
    `| 3. Cluster plan | ${cell(unique(input.clusters.map((cluster) => cluster.cluster.id)).join(", ") || "not_recorded")} |`,
    `| 4. Task anchors | ${cell(`${traceRows.filter((row) => row.anchor !== "missing").length}/${traceRows.length} anchored`)} |`,
    `| 5. Trellis materialization | ${cell(unique(traceRows.map((row) => row.taskPath)).join(", ") || "not_recorded")} |`,
    `| 6. Dispatch / Run handoff | ${cell(workflowRunIds.join(", ") || fanout.status)} |`,
    "",
    "### Requirement To Task Anchors",
    "",
    "| Cluster | Task | Trellis task | Requirements | Anchor |",
    "| --- | --- | --- | --- | --- |",
    ...traceRows.map((row) => (
      `| ${cell(row.clusterId)} | ${cell(row.title)} | ${cell(row.taskPath || row.taskName)} | ${cell(row.requirementIds.join(", ") || "missing")} | ${cell(row.anchor)} |`
    )),
    "",
    "### Spec Follow-Ups",
    "",
    ...followUps.map((item) => `- ${item}`),
    "",
  ];
  return lines.join("\n");
}

export function appendPrdSplitLoopFeedbackEntry(existing: string, entry: string): string {
  const base = existing.trim().length > 0 ? existing.trimEnd() : buildPrdSplitLoopFeedbackHeader();
  return `${base}\n\n${entry.trimEnd()}\n`;
}

function buildPrdSplitLoopFeedbackHeader(): string {
  return [
    "# PRD Assistant Loop Feedback",
    "",
    "This file is maintained by Wise after PRD split fan-out. Each entry records the anchor-to-task execution evidence that should guide the next Trellis development loop.",
  ].join("\n");
}

async function readExistingFeedback(rootPath: string): Promise<string> {
  try {
    const file = await readTrellisSpecFile(rootPath, PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH);
    return file.content;
  } catch {
    return buildPrdSplitLoopFeedbackHeader();
  }
}

function buildTraceRows(
  clusters: PrdSplitWorkflowClusterInput[],
  writeResults: PrdSplitLoopFeedbackWriteResult[],
): TraceRow[] {
  const childBySourceId = new Map<string, { taskName: string; taskPath: string }>();
  for (const result of writeResults) {
    for (const child of result.childTasks) {
      childBySourceId.set(child.sourceTaskId, {
        taskName: child.taskName,
        taskPath: child.taskPath,
      });
    }
  }
  return clusters.flatMap((cluster) => cluster.tasks.map((task) => {
    const child = childBySourceId.get(task.sourceTaskId);
    return {
      clusterId: cluster.cluster.id,
      title: task.title,
      sourceTaskId: task.sourceTaskId,
      taskName: child?.taskName ?? task.taskName ?? "",
      taskPath: child?.taskPath ?? task.taskPath ?? "",
      requirementIds: task.sourceRequirementIds,
      anchor: task.taskAnchors
        ? `${task.taskAnchors.textHash} [${task.taskAnchors.from}, ${task.taskAnchors.to}]`
        : "missing",
    };
  }));
}

function collectWorkflowRunIds(writeResults: PrdSplitLoopFeedbackWriteResult[]): string[] {
  return unique(writeResults.flatMap((result) => [
    ...(result.fanoutSnapshot?.workflowRunIds ?? []),
    ...(result.fanoutSnapshot?.workflowRunId ? [result.fanoutSnapshot.workflowRunId] : []),
  ]));
}

function summarizeFanout(writeResults: PrdSplitLoopFeedbackWriteResult[], fanoutFailedCount: number) {
  const snapshots = writeResults
    .map((result) => result.fanoutSnapshot)
    .filter((snapshot): snapshot is ExecutionFanoutSnapshot => Boolean(snapshot));
  const totalFromSnapshots = snapshots.reduce((count, snapshot) => count + snapshot.totalCount, 0);
  const doneFromSnapshots = snapshots.reduce((count, snapshot) => count + snapshot.doneCount, 0);
  const failedFromSnapshots = snapshots.reduce((count, snapshot) => count + snapshot.failedCount, 0);
  const verifyDoneFromSnapshots = snapshots.reduce((count, snapshot) => count + (snapshot.verifyDoneCount ?? 0), 0);
  const verifyFailedFromSnapshots = snapshots.reduce((count, snapshot) => count + (snapshot.verifyFailedCount ?? 0), 0);
  const totalFromWrites = writeResults.reduce((count, result) => count + result.childTasks.length, 0);
  const failedCount = Math.max(fanoutFailedCount, failedFromSnapshots);
  return {
    status: failedCount > 0 || verifyFailedFromSnapshots > 0 ? "failed" : snapshots.some((snapshot) => snapshot.status === "running") ? "running" : "succeeded",
    totalCount: totalFromSnapshots || totalFromWrites,
    doneCount: doneFromSnapshots || totalFromWrites - failedCount,
    failedCount,
    verifyDoneCount: verifyDoneFromSnapshots,
    verifyFailedCount: verifyFailedFromSnapshots,
  };
}

function buildSpecFollowUps(
  traceRows: TraceRow[],
  workflowRunIds: string[],
  fanout: ReturnType<typeof summarizeFanout>,
): string[] {
  const missingAnchorCount = traceRows.filter((row) => row.anchor === "missing").length;
  const missingRequirementCount = traceRows.filter((row) => row.requirementIds.length === 0).length;
  const verifyRan = fanout.verifyDoneCount + fanout.verifyFailedCount > 0;
  const out = [
    verifyRan
      ? "Use the trellis-check evidence before promoting repeated defects into Spec rules."
      : "Run Verify before declaring the mission complete; keep Spec waiting until evidence is checked.",
  ];
  if (missingAnchorCount > 0) {
    out.push(`${missingAnchorCount} task(s) missed PRD anchors; repair splitter or reviewer rules before the next split run.`);
  }
  if (missingRequirementCount > 0) {
    out.push(`${missingRequirementCount} task(s) missed requirement ids; keep requirements-index coverage as a hard gate.`);
  }
  if (workflowRunIds.length === 0) {
    out.push("No workflow run id was captured; keep runtime lens linkage mandatory for PRD fan-out.");
  }
  if (fanout.failedCount > 0 || fanout.status === "failed") {
    out.push("Fan-out had failures; record the failure mode in the owning frontend or Tauri spec after triage.");
  }
  if (fanout.verifyFailedCount > 0) {
    out.push("Verify reported failures; keep Spec feedback focused on the recurring rule after the fix lands.");
  }
  if (out.length === 1) {
    out.push("If Verify finds repeated anchor, dependency, runtime, or handoff defects, promote that rule into the owning spec file.");
  }
  return out;
}

function firstTaskPath(writeResults: PrdSplitLoopFeedbackWriteResult[]): string | null {
  return writeResults.flatMap((result) => result.childTasks)[0]?.taskPath ?? null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cell(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "/").trim() || "-";
}
