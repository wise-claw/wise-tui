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

export function criteriaToSpecMarkdownSection(
  area: string,
  criteria: WorkflowStageOutcomeCriterion[],
): string {
  const beginMarker = `<!-- wise:stage-criteria area="${area}" begin -->`;
  const endMarker = `<!-- wise:stage-criteria area="${area}" end -->`;
  const lines: string[] = [beginMarker, "", `## Wise Stage Criteria — ${area}`, ""];
  if (criteria.length === 0) {
    lines.push("(no entries)");
  } else {
    for (const c of criteria) {
      const name = c.name.trim() || "(unnamed)";
      const req = c.requirement.trim() || "(no requirement)";
      lines.push(`- **${name}** — ${req}`);
    }
  }
  lines.push("", endMarker);
  return lines.join("\n");
}

const ACCEPTANCE_HEADING_RE = /^##\s+Acceptance Criteria\s*$/;
const STRICT_LINE_RE = /^\s*-\s+\*\*(.+?)\*\*\s+—\s+(.+?)\s*$/;
const LOOSE_LINE_RE = /^\s*-\s+(.+?)\s*:\s+(.+?)\s*$/;

export function parseAcceptanceCriteriaSection(
  markdown: string,
): WorkflowStageOutcomeCriterion[] {
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  const out: WorkflowStageOutcomeCriterion[] = [];
  for (const line of lines) {
    if (ACCEPTANCE_HEADING_RE.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^##\s/.test(line)) break;
    const strict = STRICT_LINE_RE.exec(line);
    if (strict) {
      const name = strict[1] ?? "";
      const req = strict[2] ?? "";
      out.push({ name: name.trim(), requirement: req.trim() });
      continue;
    }
    const loose = LOOSE_LINE_RE.exec(line);
    if (loose) {
      const name = loose[1] ?? "";
      const req = loose[2] ?? "";
      out.push({ name: name.trim(), requirement: req.trim() });
    }
  }
  return out;
}

export function mergeSpecMarkdownWithStageCriteria(
  existing: string,
  area: string,
  criteria: WorkflowStageOutcomeCriterion[],
): string {
  const block = criteriaToSpecMarkdownSection(area, criteria);
  const beginToken = `<!-- wise:stage-criteria area="${area}" begin -->`;
  const endToken = `<!-- wise:stage-criteria area="${area}" end -->`;
  const beginIdx = existing.indexOf(beginToken);
  if (beginIdx >= 0) {
    const endIdx = existing.indexOf(endToken, beginIdx);
    if (endIdx >= 0) {
      const after = endIdx + endToken.length;
      return existing.slice(0, beginIdx) + block + existing.slice(after);
    }
  }
  const trimmed = existing.replace(/\s+$/, "");
  if (trimmed.length === 0) return `${block}\n`;
  return `${trimmed}\n\n${block}\n`;
}
