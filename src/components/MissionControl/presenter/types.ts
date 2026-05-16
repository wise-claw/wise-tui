import type { Repository, TaskAnchorDescriptor, TaskRole } from "../../../types";
import type { DispatchClusterRawOutput } from "../../../services/prdSplit/splitterDispatch";

export type MissionPhase = "drafting" | "planning" | "executing" | "verifying" | "done";

export type TaskUserStatus = "queued" | "preparing" | "running" | "completed" | "blocked";

export interface MissionTargetVM {
  id: string | null;
  name: string;
  rootPath: string;
}

export type MissionPrimaryCta =
  | { kind: "open-setup"; label: string }
  | { kind: "parse-prd"; label: string; disabled: boolean }
  | { kind: "generate-tasks"; label: string; disabled: boolean }
  | { kind: "write-trellis"; label: string; disabled: boolean }
  | { kind: "open-workflow"; label: string; workflowId: string | null; disabled: boolean };

// ── Real-time run state ──

export interface MissionRunState {
  phase: "idle" | "parsing" | "dispatching" | "writing" | "done";
  clusters: Record<string, ClusterRunProgress>;
  startedAt: number | null;
}

export interface ClusterRunProgress {
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  progressPercent: number;
  stageLabel: string;
  elapsedMs: number;
  error: ClusterError | null;
}

export interface ClusterError {
  summary: string;
  exitCode: number | null;
  stdoutPath: string;
  stderrPath: string;
}

// ── Agent status chip ──

export interface AgentRunChip {
  agentName: string;
  status: "queued" | "running" | "done" | "blocked";
  stageLabel: string;
}

// ── Requirement tree (left column) ──

export interface RequirementTreeNodeVM {
  id: string;
  label: string;
  machineId: string;
  taskCount: number;
  completedTaskCount: number;
  priority: "P0" | "P1" | "P2" | null;
  isHighlighted: boolean;
  children?: RequirementTreeNodeVM[];
}

// ── Task swimlane (center column) ──

export interface SwimlaneVM {
  id: string;
  label: string;
  groupLabel: string;
  isParallel: boolean;
  isBottleneck: boolean;
  tasks: TaskCardVM[];
}

// ── Task card ──

export interface TaskCardVM {
  id: string;
  title: string;
  role: TaskRole | null;
  priority: "P0" | "P1" | "P2" | null;
  status: TaskUserStatus;
  statusLabel: string;
  repositoryLabel: string | null;
  codeAnchorPreview: string | null;
  prdAnchorTags: string[];
  agentStatus: AgentRunChip | null;
  clusterId: string;
  dependencyTaskIds: string[];
  editableDependencyTaskIds: string[];
  dependencyLabels: Array<{ taskId: string; title: string; satisfied: boolean }>;
  sourceRequirementIds: string[];
  isHighlighted: boolean;
  isDimmed: boolean;
  isSelected: boolean;
  isPlaceholder: boolean;
  isManual: boolean;
  isEdited: boolean;
  executionState: null;
  evidence: null;
}

// ── Task detail (right drawer) ──

export interface TaskDetailVM {
  taskId: string;
  clusterId: string;
  title: string;
  status: TaskUserStatus;
  statusLabel: string;
  repositoryLabel: string | null;
  role: TaskRole | null;
  priority: "P0" | "P1" | "P2" | null;
  sourceRequirements: Array<{ id: string; bodyPreview: string }>;
  prdAnchor: { from: number; to: number; preview: string } | null;
  taskAnchor: TaskAnchorDescriptor | null;
  codeAnchors: Array<{ repositoryId: number | null; filePath: string; line: number | null; raw: string }>;
  description: string;
  subtasks: string[];
  dod: string[];
  isManual: boolean;
  isEdited: boolean;
  technical: {
    clusterId: string;
    clusterTitle: string;
    clusterRequirementIds: string[];
    parentTaskLabel: string | null;
    taskName: string | null;
    taskPath: string | null;
    dispatchRaw: DispatchClusterRawOutput | null;
    validationIssues: Array<{ path: string; message: string }>;
    deletedTaskIds: string[];
    isManual: boolean;
    isEdited: boolean;
  };
}

// ── Main ViewModel ──

export interface MissionViewModel {
  phase: MissionPhase;
  title: string;
  subtitle: string;
  project: MissionTargetVM;
  repositoriesParticipating: Array<{
    id: number;
    name: string;
    role: TaskRole;
  }>;
  phaseStrip: Array<{
    key: MissionPhase;
    label: string;
    status: "todo" | "current" | "done";
  }>;
  primaryCta: MissionPrimaryCta;
  risks: {
    blockedTaskCount: number;
    validationIssueCount: number;
    crossRepoRequirementCount: number;
  };
  // New tree + swimlane structure
  requirementTree: RequirementTreeNodeVM[];
  taskSwimlane: SwimlaneVM[];
  // Legacy flat structures kept for backward compat
  requirements: RequirementCardVM[];
  taskGraph: {
    layers: ParallelLayerVM[];
  };
  selection: MissionSelection;
  selectedTaskEvidence: TaskEvidenceVM | null;
  selectedTaskDetail: TaskDetailVM | null;
  engineering: EngineeringDetailsVM;
  // Real-time state
  runState: MissionRunState;
}

// ── Legacy / backward-compat types ──

export interface RequirementCardVM {
  id: string;
  bodyPreview: string;
  taskCount: number;
  hasCrossGroupTasks: boolean;
  isHighlighted: boolean;
  owningTaskGroupIds: string[];
}

export interface ParallelLayerVM {
  id: string;
  index: number;
  isParallel: boolean;
  isBottleneck: boolean;
  tasks: TaskCardVM[];
}

/** @deprecated Use TaskDetailVM instead */
export type TaskEvidenceVM = TaskDetailVM;

export interface MissionSelectionInput {
  requirementId: string | null;
  taskId: string | null;
  /** Hover state — independent from click selection, enables bi-directional highlighting */
  hoverRequirementId?: string | null;
  hoverTaskId?: string | null;
}

export interface MissionSelection extends MissionSelectionInput {
  highlightedTaskIds: Set<string>;
}

export interface EngineeringDetailsVM {
  workflowGraph: {
    workflowId: string;
    nodeCount: number;
    edgeCount: number;
    status: string;
  } | null;
  clusters: Array<{
    id: string;
    title: string;
    runStatusInternal: string;
    parentTaskName: string | null;
    diff: "new" | "unchanged" | "dirty" | "unknown";
    dirtyReasons: string[];
    validationIssues: Array<{ path: string; message: string }>;
  }>;
  repositories: Pick<Repository, "id" | "name" | "path" | "repositoryType">[];
}
