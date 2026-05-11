import type {
  WorkflowGraph,
  WorkflowGraphNodeData,
  WorkflowStageOutcomeCriterion,
  WorkflowTaskItem,
} from "../types";

export type TrellisStatus = "planning" | "in_progress" | "completed" | "rejected" | "archived";

const TRELLIS_TO_WORKFLOW: Record<string, WorkflowTaskItem["status"]> = {
  planning: "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  rejected: "rejected",
  archived: "archived",
};

const WORKFLOW_TO_TRELLIS: Record<WorkflowTaskItem["status"], TrellisStatus> = {
  in_progress: "in_progress",
  completed: "completed",
  rejected: "rejected",
  archived: "archived",
};

function findAssignedNode(
  task: WorkflowTaskItem,
  graph: WorkflowGraph | undefined,
): WorkflowGraphNodeData | undefined {
  if (!graph) return undefined;
  const ordered = graph.nodes
    .filter((node) => node.type === "task" || node.type === "approval")
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (ordered.length === 0) return undefined;
  const stageIndex = Math.max(0, task.currentStageIndex);
  return ordered[Math.min(stageIndex, ordered.length - 1)]?.data;
}

function renderCriteria(criteria: WorkflowStageOutcomeCriterion[]): string {
  if (criteria.length === 0) return "";
  const lines: string[] = ["", "## Acceptance Criteria", ""];
  for (const c of criteria) {
    const name = c.name.trim() || "(unnamed)";
    const req = c.requirement.trim() || "(no requirement)";
    lines.push(`- **${name}** — ${req}`);
  }
  return lines.join("\n");
}

export interface TrellisDraft {
  prdMarkdown: string;
  statusForTrellis: TrellisStatus;
}

export function workflowTaskToTrellisDraft(
  task: WorkflowTaskItem,
  graph?: WorkflowGraph,
): TrellisDraft {
  const node = findAssignedNode(task, graph);
  const criteria = node?.stageSuccessCriteria ?? [];
  const titleHeader = `# ${task.title.trim() || task.id}`;
  const body = task.content.trim();
  const criteriaBlock = renderCriteria(criteria);
  const sections = [titleHeader, body, criteriaBlock]
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
  const prdMarkdown = `${sections.join("\n\n").replace(/\n{3,}/g, "\n\n")}\n`;
  return {
    prdMarkdown,
    statusForTrellis: WORKFLOW_TO_TRELLIS[task.status],
  };
}

export function trellisTaskToWorkflowStatus(status: string): WorkflowTaskItem["status"] | null {
  return TRELLIS_TO_WORKFLOW[status] ?? null;
}
