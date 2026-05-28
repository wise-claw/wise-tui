import type {
  ClaudeSession,
  EmployeeItem,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
} from "../types";
import { extractRepositoryBoundEmployeeName } from "../utils/omcMonitorEmployeeSession";
import { sortWorkflowRuntimeSnapshotsChronological } from "../utils/sortWorkflowRuntimeSnapshots";

export function makePreviewText(text: string, maxLen = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(空)";
  }
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen)}...`;
}

export function snapshotWorkflowDispatchInput(text: string): string {
  const t = text.trim();
  return t || "(空)";
}

export function buildTeamWorkerExecutePrompt(dispatchInput: string, _agentType?: string): string {
  return dispatchInput.trim();
}

export function resolveTeamDispatchTargetEmployee(
  dispatch: { employeeId?: string; employeeName: string },
  employees: EmployeeItem[],
  pendingEmployees: Array<{ employeeId: string; name: string }>,
): EmployeeItem | undefined {
  const targetEmployeeId = dispatch.employeeId?.trim();
  const targetEmployeeName = dispatch.employeeName.trim();
  let targetEmployee = targetEmployeeId
    ? employees.find((item) => item.id === targetEmployeeId)
    : employees.find((item) => item.name.trim() === targetEmployeeName);
  if (!targetEmployee && pendingEmployees.length === 1) {
    targetEmployee = employees.find((item) => item.id === pendingEmployees[0]!.employeeId);
  }
  if (!targetEmployee && targetEmployeeName) {
    const pendingByName = pendingEmployees.find((item) => item.name.trim() === targetEmployeeName);
    if (pendingByName) {
      targetEmployee = employees.find((item) => item.id === pendingByName.employeeId);
    }
  }
  return targetEmployee;
}

export function snapshotTeamWorkerExecuteInput(
  dispatch: { employeeId?: string; employeeName: string; input: string },
  employees: EmployeeItem[],
  pendingEmployees: Array<{ employeeId: string; name: string }>,
): string {
  const emp = resolveTeamDispatchTargetEmployee(dispatch, employees, pendingEmployees);
  return snapshotWorkflowDispatchInput(buildTeamWorkerExecutePrompt(dispatch.input, emp?.agentType));
}

export function snapshotWorkflowAssistantOutput(text: string, maxLen = 12000): string {
  const t = text.trim();
  if (!t) return "(空)";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}\n\n…(已截断，共 ${t.length} 字符)`;
}

export function orderedExecutableNodes(graph: WorkflowGraph): WorkflowGraphNode[] {
  return graph.nodes
    .filter((node) => node.type === "task" || node.type === "approval")
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
}

export function isWorkflowTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("wise.workflow.trace") === "1";
  } catch {
    return false;
  }
}

export function logWorkflowTrace(step: string, payload: Record<string, unknown>): void {
  if (!isWorkflowTraceEnabled()) return;
  console.debug(`[wise-workflow-trace] ${step}`, payload);
}

export function hashShortText(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return hashShortText(input);
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function eventHasCorrelationId(event: WorkflowTaskEventItem, correlationId: string): boolean {
  if (!event.payloadJson) return false;
  try {
    const payload = JSON.parse(event.payloadJson) as { correlationId?: unknown };
    return typeof payload.correlationId === "string" && payload.correlationId === correlationId;
  } catch {
    return false;
  }
}

export function extractRuntimeSnapshotsFromEvents(events: WorkflowTaskEventItem[]): WorkflowRuntimeStepSnapshot[] {
  const snapshots: WorkflowRuntimeStepSnapshot[] = [];
  const updates: Array<{ snapshotId: string; outputPreview: string }> = [];
  const executorPatches: Array<{ snapshotId: string; executorSessionId: string }> = [];
  const sortedEvents = [...events].sort((a, b) => a.createdAt - b.createdAt);
  for (const event of sortedEvents) {
    if (!event.payloadJson) {
      continue;
    }
    try {
      if (event.eventType === "workflow_runtime_snapshot") {
        const payload = JSON.parse(event.payloadJson) as { snapshot?: WorkflowRuntimeStepSnapshot };
        if (payload.snapshot) {
          snapshots.push(payload.snapshot);
        }
        continue;
      }
      if (event.eventType === "workflow_runtime_snapshot_update") {
        const payload = JSON.parse(event.payloadJson) as { snapshotId?: string; outputPreview?: string };
        if (payload.snapshotId && typeof payload.outputPreview === "string") {
          updates.push({ snapshotId: payload.snapshotId, outputPreview: payload.outputPreview });
        }
        continue;
      }
      if (event.eventType === "workflow_runtime_snapshot_executor") {
        const payload = JSON.parse(event.payloadJson) as { snapshotId?: string; executorSessionId?: string };
        const sid = typeof payload.snapshotId === "string" ? payload.snapshotId.trim() : "";
        const ex = typeof payload.executorSessionId === "string" ? payload.executorSessionId.trim() : "";
        if (sid && ex) {
          executorPatches.push({ snapshotId: sid, executorSessionId: ex });
        }
      }
    } catch {
      // ignore malformed runtime payload
    }
  }
  const snapshotById = new Map(snapshots.map((item) => [item.id, item] as const));
  for (const update of updates) {
    const snapshot = snapshotById.get(update.snapshotId);
    if (!snapshot) {
      continue;
    }
    snapshot.outputPreview = update.outputPreview;
  }
  for (const patch of executorPatches) {
    const snapshot = snapshotById.get(patch.snapshotId);
    if (snapshot) {
      snapshot.executorSessionId = patch.executorSessionId;
    }
  }
  return sortWorkflowRuntimeSnapshotsChronological(snapshots);
}

export function lastUserPlainText(session: ClaudeSession | undefined): string {
  if (!session) {
    return "";
  }
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "user") {
      continue;
    }
    const fromParts = (msg.parts ?? [])
      .filter(
        (part): part is { type: "text"; text: string } =>
          part.type === "text" && typeof (part as { text?: string }).text === "string" && (part as { text: string }).text.trim().length > 0,
      )
      .map((part) => part.text.trim())
      .join("\n\n");
    if (fromParts.trim()) {
      return fromParts.trim();
    }
    if (msg.content.trim()) {
      return msg.content.trim();
    }
    return "";
  }
  return "";
}

export function lastUserMessageIsTeamAutoDriver(session: ClaudeSession | undefined): boolean {
  const t = lastUserPlainText(session).trimStart();
  if (!t) {
    return false;
  }
  return (
    t.startsWith("# 团队流程自动执行") ||
    t.startsWith("# 团队流程自动流转") ||
    t.startsWith("# 工作流自动执行") ||
    t.startsWith("# 工作流自动流转")
  );
}

export function candidateInProgressTasksForSession(
  session: ClaudeSession | undefined,
  tasks: WorkflowTaskItem[],
): WorkflowTaskItem[] {
  if (!session) {
    return [];
  }
  return tasks.filter(
    (t) =>
      t.status === "in_progress" &&
      (t.creator === session.id || (session.claudeSessionId != null && t.creator === session.claudeSessionId)),
  );
}

export function extractBoundEmployeeNameFromSessionRepositoryName(repositoryName: string | undefined): string | null {
  return extractRepositoryBoundEmployeeName(repositoryName);
}
