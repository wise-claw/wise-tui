import type { TaskAnchorDescriptor, WorkflowGraph, WorkflowGraphNode, WorkflowTemplateStage } from "../../types";
import type { ClusterPlanItem } from "./clusterPlanner";
import type { MaterializedChildTaskRef } from "./trellisWriter";
import type { RequirementsIndexV2 } from "./requirementsIndexVersion";

export const PRD_SPLIT_WORKFLOW_GRAPH_VERSION = 1;

export interface PrdSplitWorkflowTaskInput {
  sourceTaskId: string;
  title: string;
  role: string;
  dependencies: string[];
  sourceRequirementIds: string[];
  sourceRefs?: string[];
  taskAnchors?: TaskAnchorDescriptor;
  taskName?: string;
  taskPath?: string;
}

export interface PrdSplitWorkflowClusterInput {
  cluster: ClusterPlanItem;
  parentTaskName: string;
  childTasks: MaterializedChildTaskRef[];
  tasks: PrdSplitWorkflowTaskInput[];
}

export interface BuildPrdSplitWorkflowGraphInput {
  projectId: string;
  projectName: string;
  projectRootPath: string;
  requirementsIndex?: RequirementsIndexV2 | null;
  clusters: PrdSplitWorkflowClusterInput[];
}

export interface BuildPrdSplitWorkflowArtifactsResult {
  workflowId: string;
  name: string;
  graph: WorkflowGraph;
  stages: WorkflowTemplateStage[];
}

export interface PrdSplitWorkflowTraceRequirement {
  id: string;
  content: string;
  taskIds: string[];
  completedTaskIds: string[];
  totalTasks: number;
  completedTasks: number;
}

export interface PrdSplitWorkflowTraceTask {
  id: string;
  sourceTaskId: string;
  title: string;
  role: string;
  repositoryId: number | null;
  repositoryIds: number[];
  taskName?: string;
  taskPath?: string;
  sourceRequirementIds: string[];
  dependencies: string[];
  parallelGroupId: string | null;
  prdAnchor: TaskAnchorDescriptor | null;
  codeAnchors: Array<{ raw: string; filePath: string; line: number | null }>;
}

export interface PrdSplitWorkflowTracePreview {
  requirements: PrdSplitWorkflowTraceRequirement[];
  tasks: PrdSplitWorkflowTraceTask[];
  parallelGroups: Array<{ id: string; taskIds: string[] }>;
}

interface MaterializedTaskRef {
  taskName: string;
  taskPath: string;
}

const NODE_X_GAP = 260;
const NODE_Y_GAP = 150;
const START_X = 60;
const START_Y = 140;
const END_X_PADDING = 240;

export function buildPrdSplitWorkflowArtifacts(
  input: BuildPrdSplitWorkflowGraphInput,
): BuildPrdSplitWorkflowArtifactsResult {
  const normalizedProjectId = normalizeIdSegment(input.projectId || input.projectName || "project");
  const clusters = input.clusters.filter((cluster) => cluster.tasks.length > 0);
  const workflowId = `prd-split-${normalizedProjectId}-${buildMissionId(clusters)}`;
  const requirementTrace = buildRequirementTrace(input.requirementsIndex, clusters);
  const dependencyLayers = buildDependencyLayers(clusters);
  const parallelGroups = dependencyLayers.map((layer, index) => ({
    id: `parallel-group-${index + 1}`,
    taskIds: layer,
  }));
  const taskRefsById = materializedTaskRefsBySourceId(clusters);
  const executableNodes = buildExecutableNodes(
    clusters,
    taskRefsById,
    requirementTrace.taskIdsByRequirementId,
    dependencyLayers,
  );
  const startNode: WorkflowGraphNode = {
    id: "start",
    type: "start",
    position: { x: START_X, y: START_Y },
    data: {
      label: "Start",
      source: "prd-split-wizard",
      schemaVersion: PRD_SPLIT_WORKFLOW_GRAPH_VERSION,
      projectId: input.projectId,
      projectName: input.projectName,
      projectRootPath: input.projectRootPath,
      requirementTrace: requirementTrace.requirements,
      requirementTaskIndex: requirementTrace.taskIdsByRequirementId,
      parallelGroups,
      missionId: workflowId,
    },
  };
  const endNode: WorkflowGraphNode = {
    id: "end",
    type: "end",
    position: {
      x: START_X + END_X_PADDING + executableNodes.length * NODE_X_GAP,
      y: START_Y,
    },
    data: {
      label: "End",
      source: "prd-split-wizard",
      schemaVersion: PRD_SPLIT_WORKFLOW_GRAPH_VERSION,
      missionId: workflowId,
    },
  };
  const nodes = [startNode, ...executableNodes, endNode];
  const edges = buildDependencyEdges(executableNodes);
  return {
    workflowId,
    name: `PRD Split · ${input.projectName.trim() || input.projectId}`,
    graph: {
      nodes,
      edges,
    },
    stages: executableNodes.map((node, index) => ({
      id: node.id,
      name: node.data.label,
      stageOrder: index,
      passRule: "ALL_APPROVE",
      rejectRule: "ANY_REJECT_BACK",
      assignees: [],
    })),
  };
}

function buildExecutableNodes(
  clusters: PrdSplitWorkflowClusterInput[],
  taskRefsById: Map<string, MaterializedTaskRef>,
  taskIdsByRequirementId: Record<string, string[]>,
  dependencyLayers: string[][],
): WorkflowGraphNode[] {
  const usedIds = new Set<string>();
  const nodes: WorkflowGraphNode[] = [];
  let ordinal = 0;
  const parallelGroupBySourceTaskId = new Map<string, string>();
  dependencyLayers.forEach((layer, index) => {
    layer.forEach((taskId) => {
      parallelGroupBySourceTaskId.set(taskId, `parallel-group-${index + 1}`);
    });
  });
  clusters.forEach((clusterInput, clusterIndex) => {
    clusterInput.tasks.forEach((task) => {
      const id = uniqueNodeId(`task-${normalizeIdSegment(task.sourceTaskId || task.title)}`, usedIds);
      const materialized = taskRefsById.get(task.sourceTaskId);
      const taskPath = materialized?.taskPath ?? task.taskPath;
      const taskName = materialized?.taskName ?? task.taskName;
      const codeAnchors = buildCodeAnchors(task.sourceRefs);
      const x = START_X + END_X_PADDING + ordinal * NODE_X_GAP;
      const y = START_Y + clusterIndex * NODE_Y_GAP;
      nodes.push({
        id,
        type: "task",
        position: { x, y },
        data: {
          label: task.title.trim() || task.sourceTaskId,
          materialKey: "employee",
          employeePrompt: renderTaskDispatchPrompt(clusterInput, task, materialized),
          stageSuccessCriteria: [
            {
              name: "Trellis task complete",
              requirement:
                "Complete the active Trellis task, run the validation commands from its task artifacts, and report any blocker explicitly.",
            },
          ],
          source: "prd-split-wizard",
          schemaVersion: PRD_SPLIT_WORKFLOW_GRAPH_VERSION,
          clusterId: clusterInput.cluster.id,
          parentTaskName: clusterInput.parentTaskName,
          sourceTaskId: task.sourceTaskId,
          taskName,
          taskPath,
          taskTrace: {
            taskId: task.sourceTaskId,
            taskName,
            taskPath,
            title: task.title.trim() || task.sourceTaskId,
            clusterId: clusterInput.cluster.id,
            parentTaskName: clusterInput.parentTaskName,
            sourceRequirementIds: task.sourceRequirementIds,
            prdAnchor: task.taskAnchors ?? null,
            codeAnchors,
            parallelGroupId: parallelGroupBySourceTaskId.get(task.sourceTaskId) ?? null,
          },
          prdAnchor: task.taskAnchors,
          codeAnchors,
          parallelGroupId: parallelGroupBySourceTaskId.get(task.sourceTaskId),
          requirementTaskIndex: pickRequirementTaskIndex(task.sourceRequirementIds, taskIdsByRequirementId),
          role: task.role,
          sourceRequirementIds: task.sourceRequirementIds,
          sourceRefs: task.sourceRefs ?? [],
          dependencies: task.dependencies,
          repositoryId: clusterInput.cluster.primaryRepositoryId,
          repositoryIds: clusterInput.cluster.repositoryIds,
        },
      });
      ordinal += 1;
    });
  });
  return nodes;
}

function buildMissionId(clusters: PrdSplitWorkflowClusterInput[]): string {
  const parents = clusters
    .map((cluster) => cluster.parentTaskName.trim())
    .filter(Boolean);
  if (parents.length > 0) {
    return normalizeIdSegment(parents.join("-"));
  }
  const taskIds = clusters.flatMap((cluster) => cluster.tasks.map((task) => task.sourceTaskId));
  return normalizeIdSegment(taskIds.join("-") || "mission");
}

function buildDependencyLayers(clusters: PrdSplitWorkflowClusterInput[]): string[][] {
  const tasks = clusters.flatMap((cluster) => cluster.tasks);
  const allIds = new Set(tasks.map((task) => task.sourceTaskId));
  const depsByTask = new Map<string, Set<string>>();
  tasks.forEach((task) => {
    depsByTask.set(
      task.sourceTaskId,
      new Set(task.dependencies.filter((dep) => dep !== task.sourceTaskId && allIds.has(dep))),
    );
  });
  const remaining = new Set(allIds);
  const layers: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((taskId) => {
        const deps = depsByTask.get(taskId) ?? new Set<string>();
        return [...deps].every((dep) => !remaining.has(dep));
      })
      .sort((a, b) => a.localeCompare(b));
    const fallback = [...remaining].sort((a, b) => a.localeCompare(b))[0];
    const layer = ready.length > 0 ? ready : fallback ? [fallback] : [];
    layers.push(layer);
    layer.forEach((taskId) => remaining.delete(taskId));
  }
  return layers;
}

function buildRequirementTrace(
  requirementsIndex: RequirementsIndexV2 | null | undefined,
  clusters: PrdSplitWorkflowClusterInput[],
): {
  requirements: Array<{
    id: string;
    content: string;
    bodyHash: string;
    taskIds: string[];
    completedTaskIds: string[];
    totalTasks: number;
    completedTasks: number;
  }>;
  taskIdsByRequirementId: Record<string, string[]>;
} {
  const taskIdsByRequirementId: Record<string, string[]> = {};
  for (const cluster of clusters) {
    for (const task of cluster.tasks) {
      for (const requirementId of task.sourceRequirementIds) {
        const list = taskIdsByRequirementId[requirementId] ?? [];
        if (!list.includes(task.sourceTaskId)) list.push(task.sourceTaskId);
        taskIdsByRequirementId[requirementId] = list;
      }
    }
  }
  const entries = requirementsIndex?.requirements ?? Object.keys(taskIdsByRequirementId).map((id) => ({
    id,
    content: "",
    bodyHash: "",
  }));
  const requirements = entries.map((entry) => {
    const taskIds = taskIdsByRequirementId[entry.id] ?? [];
    return {
      id: entry.id,
      content: entry.content,
      bodyHash: entry.bodyHash,
      taskIds,
      completedTaskIds: [],
      totalTasks: taskIds.length,
      completedTasks: 0,
    };
  });
  return { requirements, taskIdsByRequirementId };
}

function pickRequirementTaskIndex(
  sourceRequirementIds: string[],
  taskIdsByRequirementId: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    sourceRequirementIds.map((requirementId) => [
      requirementId,
      taskIdsByRequirementId[requirementId] ?? [],
    ]),
  );
}

function buildCodeAnchors(sourceRefs: string[] | undefined): Array<{ raw: string; filePath: string; line: number | null }> {
  return (sourceRefs ?? [])
    .map((ref) => ref.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = /^(.+?)(?::(\d+))?$/.exec(raw);
      const filePath = match?.[1]?.trim() || raw;
      const lineRaw = match?.[2];
      const line = lineRaw ? Number(lineRaw) : null;
      return {
        raw,
        filePath,
        line: line != null && Number.isFinite(line) ? line : null,
      };
    });
}

export function buildPrdSplitWorkflowTracePreview(graph: WorkflowGraph): PrdSplitWorkflowTracePreview {
  const startNode = graph.nodes.find((node) => node.type === "start");
  const requirements = Array.isArray(startNode?.data.requirementTrace)
    ? startNode.data.requirementTrace.map(normalizeTraceRequirement).filter((item): item is PrdSplitWorkflowTraceRequirement => Boolean(item))
    : [];
  const parallelGroups = Array.isArray(startNode?.data.parallelGroups)
    ? startNode.data.parallelGroups.map(normalizeParallelGroup).filter((item): item is { id: string; taskIds: string[] } => Boolean(item))
    : [];
  const tasks = graph.nodes
    .filter((node) => node.type === "task" || node.type === "approval")
    .map(normalizeTraceTask)
    .filter((item): item is PrdSplitWorkflowTraceTask => Boolean(item));
  return { requirements, tasks, parallelGroups };
}

function normalizeTraceRequirement(value: unknown): PrdSplitWorkflowTraceRequirement | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  if (!id) return null;
  const taskIds = readStringArray(value.taskIds);
  const completedTaskIds = readStringArray(value.completedTaskIds);
  return {
    id,
    content: readString(value.content),
    taskIds,
    completedTaskIds,
    totalTasks: readNumber(value.totalTasks) ?? taskIds.length,
    completedTasks: readNumber(value.completedTasks) ?? completedTaskIds.length,
  };
}

function normalizeParallelGroup(value: unknown): { id: string; taskIds: string[] } | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  if (!id) return null;
  return { id, taskIds: readStringArray(value.taskIds) };
}

function normalizeTraceTask(node: WorkflowGraphNode): PrdSplitWorkflowTraceTask | null {
  const sourceTaskId = readString(node.data.sourceTaskId);
  if (!sourceTaskId) return null;
  const codeAnchors = Array.isArray(node.data.codeAnchors)
    ? node.data.codeAnchors.map(normalizeCodeAnchor).filter((item): item is { raw: string; filePath: string; line: number | null } => Boolean(item))
    : [];
  return {
    id: node.id,
    sourceTaskId,
    title: readString(node.data.label) || sourceTaskId,
    role: readString(node.data.role),
    repositoryId: readNumber(node.data.repositoryId),
    repositoryIds: readNumberArray(node.data.repositoryIds),
    taskName: readString(node.data.taskName) || undefined,
    taskPath: readString(node.data.taskPath) || undefined,
    sourceRequirementIds: readStringArray(node.data.sourceRequirementIds),
    dependencies: readStringArray(node.data.dependencies),
    parallelGroupId: readString(node.data.parallelGroupId) || null,
    prdAnchor: normalizePrdAnchor(node.data.prdAnchor),
    codeAnchors,
  };
}

function normalizeCodeAnchor(value: unknown): { raw: string; filePath: string; line: number | null } | null {
  if (!isRecord(value)) return null;
  const raw = readString(value.raw);
  const filePath = readString(value.filePath);
  if (!raw || !filePath) return null;
  return { raw, filePath, line: readNumber(value.line) };
}

function normalizePrdAnchor(value: unknown): TaskAnchorDescriptor | null {
  if (!isRecord(value)) return null;
  const from = readNumber(value.from);
  const to = readNumber(value.to);
  const textHash = readString(value.textHash);
  if (from == null || to == null || !textHash) return null;
  return {
    from,
    to,
    textHash,
    contextBefore: readString(value.contextBefore),
    contextAfter: readString(value.contextAfter),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function buildDependencyEdges(nodes: WorkflowGraphNode[]): WorkflowGraph["edges"] {
  if (nodes.length === 0) {
    return [
      {
        id: "edge-start-end",
        source: "start",
        target: "end",
      },
    ];
  }
  const nodeBySourceTaskId = new Map<string, WorkflowGraphNode>();
  for (const node of nodes) {
    const sourceTaskId = typeof node.data.sourceTaskId === "string" ? node.data.sourceTaskId : "";
    if (sourceTaskId) nodeBySourceTaskId.set(sourceTaskId, node);
  }
  const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const edges: WorkflowGraph["edges"] = [];
  const edgeKeys = new Set<string>();
  for (const node of nodes) {
    const deps = Array.isArray(node.data.dependencies)
      ? node.data.dependencies.filter((dep): dep is string => typeof dep === "string")
      : [];
    for (const dep of deps) {
      const upstream = nodeBySourceTaskId.get(dep);
      if (!upstream || upstream.id === node.id) continue;
      const key = `${upstream.id}->${node.id}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({
        id: `edge-${upstream.id}-${node.id}`,
        source: upstream.id,
        target: node.id,
      });
      outgoing.set(upstream.id, (outgoing.get(upstream.id) ?? 0) + 1);
      incoming.set(node.id, (incoming.get(node.id) ?? 0) + 1);
    }
  }
  const ordered = nodes.slice().sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  ordered
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .forEach((node) => {
      edges.unshift({
        id: `edge-start-${node.id}`,
        source: "start",
        target: node.id,
      });
      incoming.set(node.id, (incoming.get(node.id) ?? 0) + 1);
    });
  ordered
    .filter((node) => (outgoing.get(node.id) ?? 0) === 0)
    .forEach((node) => {
      edges.push({
        id: `edge-${node.id}-end`,
        source: node.id,
        target: "end",
      });
      outgoing.set(node.id, (outgoing.get(node.id) ?? 0) + 1);
    });
  return edges;
}

function materializedTaskRefsBySourceId(
  clusters: PrdSplitWorkflowClusterInput[],
): Map<string, MaterializedTaskRef> {
  const out = new Map<string, MaterializedTaskRef>();
  for (const clusterInput of clusters) {
    for (const child of clusterInput.childTasks) {
      out.set(child.sourceTaskId, {
        taskName: child.taskName,
        taskPath: child.taskPath,
      });
    }
  }
  return out;
}

function renderTaskDispatchPrompt(
  clusterInput: PrdSplitWorkflowClusterInput,
  task: PrdSplitWorkflowTaskInput,
  materialized: MaterializedTaskRef | undefined,
): string {
  const taskPath = materialized?.taskPath ?? task.taskPath ?? "";
  const activeTask = taskPath || materialized?.taskName || task.taskName || task.sourceTaskId;
  const lines = [
    `Active task: ${activeTask}`,
    "",
    "Implement this Trellis task from its artifacts.",
    "",
    "Context:",
    `- Cluster: ${clusterInput.cluster.title} (${clusterInput.cluster.id})`,
    `- Parent task: ${clusterInput.parentTaskName}`,
    `- Source task id: ${task.sourceTaskId}`,
    `- Role: ${task.role}`,
  ];
  if (task.sourceRequirementIds.length > 0) {
    lines.push(`- Source requirements: ${task.sourceRequirementIds.join(", ")}`);
  }
  if (task.dependencies.length > 0) {
    lines.push(`- Depends on: ${task.dependencies.join(", ")}`);
  }
  lines.push(
    "",
    "Use the existing Trellis workflow for the task. Read prd.md, design.md and implement.md when present, implement the requested behavior, and run focused validation before reporting completion.",
  );
  return lines.join("\n");
}

function normalizeIdSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function uniqueNodeId(base: string, used: Set<string>): string {
  let next = base;
  let suffix = 2;
  while (used.has(next)) {
    next = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(next);
  return next;
}
