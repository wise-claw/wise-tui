import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";
import type { ProjectItem, Repository, TaskAnchorDescriptor, TaskItem } from "../../../types";
import { applyTaskEdits, isEditedTask, isManualTask } from "../../PrdSplitWizard/taskEdits";
import type { ClusterRunState, WizardState, WizardWriteResult } from "../../PrdSplitWizard/types";
import { COPY, PHASE_LABEL, ROLE_LABEL } from "../copy";
import { toUserStatus, userStatusLabel } from "./statusModel";
import type {
  AgentRunChip,
  EngineeringDetailsVM,
  MissionPhase,
  MissionRunState,
  MissionSelection,
  MissionSelectionInput,
  MissionViewModel,
  ParallelLayerVM,
  RequirementCardVM,
  RequirementTreeNodeVM,
  SwimlaneVM,
  TaskCardVM,
  TaskDetailVM,
} from "./types";

interface ProjectMissionInput {
  state: WizardState;
  selection: MissionSelectionInput;
  repositories: Repository[];
  projects?: ProjectItem[];
}

interface InternalTaskProjection {
  task: TaskItem;
  cluster: ClusterPlanItem;
  run: ClusterRunState | undefined;
  writeResult: WizardWriteResult | undefined;
  isPlaceholder: boolean;
}

export function projectMission(input: ProjectMissionInput): MissionViewModel {
  const { state, repositories } = input;
  const phase = toMissionPhase(state);
  const projectedTasks = projectTasks(state);
  const dependencyTaskIdsByTaskId = buildDependencyIndex(projectedTasks);
  const highlightedTaskIds = deriveHighlightedTaskIds(
    input.selection,
    projectedTasks,
    dependencyTaskIdsByTaskId,
  );
  const selection: MissionSelection = {
    requirementId: input.selection.requirementId,
    taskId: input.selection.taskId,
    highlightedTaskIds,
  };
  const taskCards = buildTaskCards({
    projectedTasks,
    repositories,
    selection,
    dependencyTaskIdsByTaskId,
  });
  const requirements = buildRequirementCards(state.requirementsIndex, projectedTasks, selection);
  const requirementTree = buildRequirementTree(state.requirementsIndex, projectedTasks, selection);
  const selectedTaskEvidence = buildSelectedTaskDetail({
    state,
    repositories,
    projectedTasks,
    selection,
  });
  return {
    phase,
    title: deriveTitle(state),
    subtitle: deriveSubtitle(state, projectedTasks.length),
    project: {
      id: state.project?.id ?? null,
      name: state.project?.name ?? COPY.emptyTarget,
      rootPath: state.project?.rootPath ?? "",
    },
    repositoriesParticipating: state.repositories
      .filter((repo) => state.selectedRepositoryIds.length === 0 || state.selectedRepositoryIds.includes(repo.id))
      .map((repo) => ({ id: repo.id, name: repo.name, role: repo.type })),
    phaseStrip: buildPhaseStrip(phase),
    primaryCta: derivePrimaryCta(state, phase),
    risks: {
      blockedTaskCount: taskCards.filter((task) => task.status === "blocked").length,
      validationIssueCount: Object.values(state.clusterRuns).reduce(
        (sum, run) => sum + (run.validationIssues?.length ?? 0),
        0,
      ),
      crossRepoRequirementCount: state.plan?.diagnostics.crossRepoRequirements.length ?? 0,
    },
    requirements,
    requirementTree,
    taskSwimlane: buildTaskSwimlane(state.plan?.clusters ?? [], taskCards),
    taskGraph: {
      layers: buildLayers(state.plan?.clusters ?? [], taskCards),
    },
    selection,
    selectedTaskEvidence,
    selectedTaskDetail: selectedTaskEvidence,
    engineering: buildEngineeringDetails(state, repositories),
    runState: deriveRunState(state),
  };
}

export function toMissionPhase(state: WizardState): MissionPhase {
  if (state.stage === "input") return "drafting";
  if (state.stage === "plan") return "planning";
  if (state.stage === "dispatch") {
    const runs = Object.values(state.clusterRuns);
    const allDone = runs.length > 0 && runs.every((run) =>
      run.status === "succeeded" ||
      run.status === "failed" ||
      run.status === "skipped-clean"
    );
    return allDone ? "verifying" : "planning";
  }
  if (state.stage === "done") return "done";
  return "verifying";
}

function deriveTitle(state: WizardState): string {
  const title = state.prd?.title?.trim();
  if (title) return title;
  const firstMarkdownLine = state.prdMarkdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0);
  if (firstMarkdownLine) return truncate(firstMarkdownLine, 48);
  return state.project?.name ?? COPY.titleFallback;
}

function deriveSubtitle(state: WizardState, taskCount: number): string {
  const target = state.context?.mode === "repository" ? "单仓使命" : "项目使命";
  const reqCount = state.requirementsIndex?.requirements.length ?? 0;
  const repoCount = state.selectedRepositoryIds.length || state.repositories.length;
  if (reqCount === 0) return `${target} · 等待 PRD`;
  return `${target} · ${reqCount} 条需求 · ${repoCount} 个仓位 · ${taskCount} 个任务`;
}

function buildPhaseStrip(current: MissionPhase): MissionViewModel["phaseStrip"] {
  const order: MissionPhase[] = ["drafting", "planning", "verifying", "done"];
  const currentIndex = order.indexOf(current === "executing" ? "verifying" : current);
  return order.map((phase, index) => ({
    key: phase,
    label: PHASE_LABEL[phase],
    status: index < currentIndex ? "done" : index === currentIndex ? "current" : "todo",
  }));
}

function derivePrimaryCta(state: WizardState, phase: MissionPhase): MissionViewModel["primaryCta"] {
  if (phase === "drafting") {
    if (state.prdMarkdown.trim() && state.project) {
      return { kind: "parse-prd", label: COPY.primaryCta.parsePrd, disabled: false };
    }
    return { kind: "open-setup", label: COPY.primaryCta.openSetup };
  }
  if (state.stage === "dispatch") {
    const runs = Object.values(state.clusterRuns);
    const allDone = runs.length > 0 && runs.every((run) =>
      run.status === "succeeded" ||
      run.status === "failed" ||
      run.status === "skipped-clean"
    );
    if (allDone) {
      return {
        kind: "write-trellis",
        label: COPY.primaryCta.writeTrellis,
        disabled: !hasWritableCluster(state),
      };
    }
    return { kind: "generate-tasks", label: COPY.primaryCta.generateTasks, disabled: !state.plan };
  }
  if (phase === "planning") {
    return { kind: "generate-tasks", label: COPY.primaryCta.generateTasks, disabled: !state.plan };
  }
  if (phase === "verifying") {
    return {
      kind: "write-trellis",
      label: state.stage === "writing" ? COPY.primaryCta.writing : COPY.primaryCta.writeTrellis,
      disabled: state.stage === "writing" || !hasWritableCluster(state),
    };
  }
  return {
    kind: "open-workflow",
    label: COPY.primaryCta.openWorkflow,
    workflowId: state.workflowGraphResult?.workflowId || null,
    disabled: !state.workflowGraphResult?.workflowId || Boolean(state.workflowGraphResult.error),
  };
}

function hasWritableCluster(state: WizardState): boolean {
  return Object.values(state.clusterRuns).some((run) => run.status === "succeeded" && run.normalized);
}

function projectTasks(state: WizardState): InternalTaskProjection[] {
  const clusters = state.plan?.clusters ?? [];
  const out: InternalTaskProjection[] = [];
  for (const cluster of clusters) {
    const run = state.clusterRuns[cluster.id];
    const edits = state.editsByCluster[cluster.id];
    const writeResult = state.writeResults.find((result) => result.clusterId === cluster.id);
    if (run?.normalized) {
      for (const task of applyTaskEdits(run.normalized.splitTasks, edits)) {
        out.push({ task, cluster, run, writeResult, isPlaceholder: false });
      }
      continue;
    }
    out.push({
      task: makePlaceholderTask(cluster),
      cluster,
      run,
      writeResult,
      isPlaceholder: true,
    });
  }
  return out;
}

function makePlaceholderTask(cluster: ClusterPlanItem): TaskItem {
  return {
    id: `pending-${cluster.id}`,
    title: cluster.title,
    description: "等待生成任务",
    role: "document",
    size: "M",
    estimateDays: 0,
    dependencies: [],
    sourceRefs: [],
    sourceRequirementIds: [...cluster.requirementIds],
    subtasks: [],
    dod: [],
    executionStatus: "not_executable",
    flowStatus: "todo",
  };
}

function buildDependencyIndex(projectedTasks: InternalTaskProjection[]): Map<string, string[]> {
  const byClusterId = new Map<string, InternalTaskProjection[]>();
  for (const item of projectedTasks) {
    const list = byClusterId.get(item.cluster.id) ?? [];
    list.push(item);
    byClusterId.set(item.cluster.id, list);
  }
  const taskIds = new Set(projectedTasks.map((item) => item.task.id));
  const out = new Map<string, string[]>();
  for (const item of projectedTasks) {
    const direct = item.task.dependencies.filter((id) => taskIds.has(id));
    const clusterDeps = item.cluster.dependencyClusterIds.flatMap((clusterId) =>
      (byClusterId.get(clusterId) ?? []).map((dep) => dep.task.id),
    );
    out.set(item.task.id, unique([...direct, ...clusterDeps]));
  }
  return out;
}

function deriveHighlightedTaskIds(
  selection: MissionSelectionInput,
  projectedTasks: InternalTaskProjection[],
  dependencyTaskIdsByTaskId: Map<string, string[]>,
): Set<string> {
  const highlighted = new Set<string>();
  if (selection.requirementId) {
    for (const item of projectedTasks) {
      if (item.task.sourceRequirementIds.includes(selection.requirementId)) {
        highlighted.add(item.task.id);
      }
    }
  }
  if (selection.taskId) {
    highlighted.add(selection.taskId);
    for (const depId of dependencyTaskIdsByTaskId.get(selection.taskId) ?? []) {
      highlighted.add(depId);
    }
    for (const [taskId, deps] of dependencyTaskIdsByTaskId) {
      if (deps.includes(selection.taskId)) highlighted.add(taskId);
    }
  }
  return highlighted;
}

// ── Priority derivation ──

function derivePriority(item: InternalTaskProjection): "P0" | "P1" | "P2" | null {
  const reqCount = item.task.sourceRequirementIds.length;
  const depCount = item.task.dependencies.length;
  if (reqCount >= 3 || depCount >= 3) return "P0";
  if (reqCount >= 2 || depCount >= 2) return "P1";
  if (reqCount >= 1) return "P2";
  return null;
}

function derivePrdAnchorTags(
  item: InternalTaskProjection,
  requirementsIndex: RequirementsIndexV2 | null,
): string[] {
  const entries = requirementsIndex?.requirements ?? [];
  const reqMap = new Map(entries.map((e) => [e.id, e.content]));
  return item.task.sourceRequirementIds.slice(0, 3).map((id) => {
    const content = reqMap.get(id);
    if (!content) return id;
    return truncate(content.replace(/^#+\s*/, ""), 32);
  });
}

function deriveAgentChip(item: InternalTaskProjection): AgentRunChip | null {
  if (!item.run) return null;
  if (item.run.status === "dispatching") {
    return { agentName: "trellis-splitter", status: "running", stageLabel: "generating" };
  }
  if (item.run.status === "succeeded") {
    return { agentName: "trellis-splitter", status: "done", stageLabel: "done" };
  }
  if (item.run.status === "skipped-clean") {
    return { agentName: "trellis-splitter", status: "done", stageLabel: "skipped" };
  }
  if (item.run.status === "failed") {
    return { agentName: "trellis-splitter", status: "blocked", stageLabel: "failed" };
  }
  if (item.run.status === "creating-parent") {
    return { agentName: "trellis-splitter", status: "queued", stageLabel: "preparing" };
  }
  return null;
}

// ── Task cards ──

function buildTaskCards(input: {
  projectedTasks: InternalTaskProjection[];
  repositories: Repository[];
  selection: MissionSelection;
  dependencyTaskIdsByTaskId: Map<string, string[]>;
}): TaskCardVM[] {
  const repoById = new Map(input.repositories.map((repo) => [repo.id, repo]));
  const hasSelection = Boolean(input.selection.requirementId || input.selection.taskId);
  return input.projectedTasks.map((item) => {
    const status = toUserStatus({
      run: item.run,
      writeResult: item.writeResult,
      validationIssueCount: item.run?.validationIssues?.length ?? 0,
    });
    const repo = item.cluster.primaryRepositoryId == null
      ? null
      : repoById.get(item.cluster.primaryRepositoryId) ?? null;
    const isHighlighted = input.selection.highlightedTaskIds.has(item.task.id);
    return {
      id: item.task.id,
      title: item.task.title,
      role: item.isPlaceholder ? null : item.task.role,
      priority: derivePriority(item),
      status,
      statusLabel: item.isPlaceholder
        ? item.run?.status === "dispatching" ? "生成中…"
        : item.run?.status === "creating-parent" ? "准备中…"
        : item.run?.status === "failed" ? "生成失败"
        : "等待生成"
        : userStatusLabel(status),
      repositoryLabel: repo ? `${ROLE_LABEL[repo.repositoryType]} · ${repo.name}` : null,
      codeAnchorPreview: item.task.sourceRefs[0] ?? null,
      prdAnchorTags: derivePrdAnchorTags(item, null),
      agentStatus: deriveAgentChip(item),
      clusterId: item.cluster.id,
      dependencyTaskIds: input.dependencyTaskIdsByTaskId.get(item.task.id) ?? [],
      sourceRequirementIds: item.task.sourceRequirementIds,
      isHighlighted,
      isDimmed: hasSelection && !isHighlighted,
      isSelected: input.selection.taskId === item.task.id,
      isPlaceholder: item.isPlaceholder,
      executionState: null,
      evidence: null,
    };
  });
}

// ── Requirement tree (new) ──

function buildRequirementTree(
  requirementsIndex: RequirementsIndexV2 | null,
  projectedTasks: InternalTaskProjection[],
  selection: MissionSelection,
): RequirementTreeNodeVM[] {
  const entries = requirementsIndex?.requirements ?? [];
  if (entries.length === 0) return [];

  // Build flat nodes; group by parent_id if hierarchy exists in the index.
  const taskCountByReq = new Map<string, number>();
  const completedByReq = new Map<string, number>();
  for (const item of projectedTasks) {
    for (const reqId of item.task.sourceRequirementIds) {
      taskCountByReq.set(reqId, (taskCountByReq.get(reqId) ?? 0) + (item.isPlaceholder ? 0 : 1));
      if (item.run?.status === "succeeded" && !item.isPlaceholder) {
        completedByReq.set(reqId, (completedByReq.get(reqId) ?? 0) + 1);
      }
    }
  }

  // Check for hierarchical index support
  const hierarchical = entries.some((e) => (e as any).parentId);

  if (hierarchical) {
    const byParent = new Map<string | null, typeof entries>();
    for (const entry of entries) {
      const parentId = (entry as any).parentId ?? null;
      const list = byParent.get(parentId) ?? [];
      list.push(entry);
      byParent.set(parentId, list);
    }
    const buildNodes = (parentId: string | null): RequirementTreeNodeVM[] => {
      const children = byParent.get(parentId) ?? [];
      return children.map((entry) => ({
        id: entry.id,
        label: `${entry.id} ${truncate(entry.content.replace(/^#+\s*/, ""), 48)}`,
        taskCount: taskCountByReq.get(entry.id) ?? 0,
        completedTaskCount: completedByReq.get(entry.id) ?? 0,
        priority: deriveRequirementPriority(entry.id, projectedTasks),
        isHighlighted: selection.requirementId === entry.id,
        children: buildNodes(entry.id),
      }));
    };
    return buildNodes(null);
  }

  return entries.map((entry) => ({
    id: entry.id,
    label: `${entry.id} ${truncate(entry.content.replace(/^#+\s*/, ""), 48)}`,
    taskCount: taskCountByReq.get(entry.id) ?? 0,
    completedTaskCount: completedByReq.get(entry.id) ?? 0,
    priority: deriveRequirementPriority(entry.id, projectedTasks),
    isHighlighted: selection.requirementId === entry.id,
  }));
}

function deriveRequirementPriority(
  reqId: string,
  projectedTasks: InternalTaskProjection[],
): "P0" | "P1" | "P2" | null {
  const deps = projectedTasks.filter((item) => item.task.sourceRequirementIds.includes(reqId));
  if (deps.length >= 3) return "P0";
  if (deps.length >= 2) return "P1";
  if (deps.length >= 1) return "P2";
  return null;
}

// ── Task swimlane (new) ──

function buildTaskSwimlane(clusters: ClusterPlanItem[], taskCards: TaskCardVM[]): SwimlaneVM[] {
  const clusterLayer = assignClusterLayers(clusters);
  const maxLayer = Math.max(0, ...Array.from(clusterLayer.values()));
  const swimlanes: SwimlaneVM[] = [];
  for (let layerIndex = 0; layerIndex <= maxLayer; layerIndex += 1) {
    const layerClusters = clusters.filter((cluster) => clusterLayer.get(cluster.id) === layerIndex);
    const tasks = layerClusters.flatMap((cluster) =>
      taskCards.filter((task) => task.clusterId === cluster.id),
    );
    if (tasks.length === 0) continue;
    const hasBlocked = tasks.some((task) => task.status === "blocked");
    const parallelLabel = tasks.length > 1 ? `可并行 · ${tasks.length} 个任务` : `阶段 ${layerIndex + 1}`;
    swimlanes.push({
      id: `swimlane-${layerIndex + 1}`,
      label: parallelLabel,
      isParallel: tasks.length > 1,
      isBottleneck: hasBlocked,
      tasks,
    });
  }
  return swimlanes;
}

// ── Run state derivation ──

function deriveRunState(state: WizardState): MissionRunState {
  const clusters: Record<string, import("./types").ClusterRunProgress> = {};
  for (const [id, run] of Object.entries(state.clusterRuns)) {
    const pct =
      run.status === "succeeded" || run.status === "skipped-clean" ? 100
      : run.status === "failed" ? 0
      : run.status === "dispatching" ? 50
      : run.status === "creating-parent" ? 10
      : 0;
    clusters[id] = {
      status:
        run.status === "succeeded" || run.status === "skipped-clean" ? "succeeded"
        : run.status === "failed" ? "failed"
        : run.status === "dispatching" ? "running"
        : "queued",
      progressPercent: pct,
      stageLabel:
        run.status === "creating-parent" ? "创建父任务中…"
        : run.status === "dispatching" ? "子代理生成中…"
        : run.status === "succeeded" ? "完成"
        : run.status === "failed" ? "失败"
        : "等待中",
      elapsedMs: run.startedAt ? Date.now() - run.startedAt : 0,
      error: run.errors.length > 0
        ? { summary: run.errors[0], exitCode: null, stdoutPath: "", stderrPath: "" }
        : null,
    };
  }
  const runs = Object.values(state.clusterRuns);
  const allDone = runs.length > 0 && runs.every(
    (r) => r.status === "succeeded" || r.status === "failed" || r.status === "skipped-clean",
  );
  return {
    phase: state.stage === "done" ? "done"
      : state.stage === "dispatch" && !allDone ? "dispatching"
      : state.stage === "plan" ? "parsing"
      : "idle",
    clusters,
    startedAt: runs.reduce((earliest, r) => Math.min(earliest, r.startedAt ?? Infinity), Infinity),
  };
}

// ── Legacy builders (kept for backward compat) ──

function buildRequirementCards(
  requirementsIndex: RequirementsIndexV2 | null,
  projectedTasks: InternalTaskProjection[],
  selection: MissionSelection,
): RequirementCardVM[] {
  const entries = requirementsIndex?.requirements ?? [];
  return entries.map((entry) => {
    const owningClusters = new Set<string>();
    let taskCount = 0;
    for (const item of projectedTasks) {
      if (item.task.sourceRequirementIds.includes(entry.id)) {
        taskCount += item.isPlaceholder ? 0 : 1;
        owningClusters.add(item.cluster.id);
      }
    }
    return {
      id: entry.id,
      bodyPreview: truncate(entry.content, 96),
      taskCount,
      hasCrossGroupTasks: owningClusters.size > 1,
      isHighlighted: selection.requirementId === entry.id,
      owningTaskGroupIds: [...owningClusters],
    };
  });
}

function buildLayers(clusters: ClusterPlanItem[], taskCards: TaskCardVM[]): ParallelLayerVM[] {
  const clusterLayer = assignClusterLayers(clusters);
  const maxLayer = Math.max(0, ...Array.from(clusterLayer.values()));
  const layers: ParallelLayerVM[] = [];
  const maxTaskCount = Math.max(1, ...clusters.map((cluster) =>
    taskCards.filter((task) => task.clusterId === cluster.id).length,
  ));
  for (let layerIndex = 0; layerIndex <= maxLayer; layerIndex += 1) {
    const layerClusters = clusters.filter((cluster) => clusterLayer.get(cluster.id) === layerIndex);
    const tasks = layerClusters.flatMap((cluster) => taskCards.filter((task) => task.clusterId === cluster.id));
    if (tasks.length === 0) continue;
    const hasBlocked = tasks.some((task) => task.status === "blocked");
    layers.push({
      id: `layer-${layerIndex + 1}`,
      index: layerIndex + 1,
      isParallel: tasks.length > 1,
      isBottleneck: hasBlocked || tasks.length >= maxTaskCount,
      tasks,
    });
  }
  return layers;
}

function assignClusterLayers(clusters: ClusterPlanItem[]): Map<string, number> {
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const memo = new Map<string, number>();
  const visit = (cluster: ClusterPlanItem, visiting: Set<string>): number => {
    const cached = memo.get(cluster.id);
    if (cached != null) return cached;
    if (visiting.has(cluster.id)) {
      memo.set(cluster.id, 0);
      return 0;
    }
    visiting.add(cluster.id);
    const depLayers = cluster.dependencyClusterIds
      .map((depId) => byId.get(depId))
      .filter((dep): dep is ClusterPlanItem => Boolean(dep))
      .map((dep) => visit(dep, visiting));
    visiting.delete(cluster.id);
    const layer = depLayers.length === 0 ? 0 : Math.max(...depLayers) + 1;
    memo.set(cluster.id, layer);
    return layer;
  };
  for (const cluster of clusters) visit(cluster, new Set());
  return memo;
}

// ── Task detail ──

function buildSelectedTaskDetail(input: {
  state: WizardState;
  repositories: Repository[];
  projectedTasks: InternalTaskProjection[];
  selection: MissionSelection;
}): TaskDetailVM | null {
  if (!input.selection.taskId) return null;
  const item = input.projectedTasks.find((candidate) => candidate.task.id === input.selection.taskId);
  if (!item) return null;

  // Placeholder: show dispatch progress instead of task editing
  if (item.isPlaceholder) {
    const run = item.run;
    const runStatus = run?.status ?? "idle";
    const status = toUserStatus({ run, validationIssueCount: run?.validationIssues?.length ?? 0 });
    const repoById = new Map(input.repositories.map((repo) => [repo.id, repo]));
    const repo = item.cluster.primaryRepositoryId == null
      ? null
      : repoById.get(item.cluster.primaryRepositoryId) ?? null;
    const dispatchLabel =
      runStatus === "creating-parent" ? "正在创建父任务…"
      : runStatus === "dispatching" ? "子代理拆分中…"
      : runStatus === "succeeded" ? "拆分完成，等待写入"
      : runStatus === "failed" ? "拆分失败"
      : "等待派发";
    const errors = run?.errors ?? [];
    return {
      taskId: item.task.id,
      clusterId: item.cluster.id,
      title: item.cluster.title,
      status,
      statusLabel: dispatchLabel,
      repositoryLabel: repo ? `${repo.name}` : null,
      role: null,
      priority: null,
      sourceRequirements: item.cluster.requirementIds.map((id) => ({ id, bodyPreview: id })),
      prdAnchor: null,
      taskAnchor: null,
      codeAnchors: [],
      description: errors.length > 0 ? errors.join("\n") : `任务分组 ${item.cluster.id} — 子代理派发中`,
      subtasks: [],
      dod: [],
      isManual: false,
      isEdited: false,
      technical: {
        clusterId: item.cluster.id,
        clusterTitle: item.cluster.title,
        clusterRequirementIds: item.cluster.requirementIds,
        parentTaskLabel: run?.parentTaskName ?? null,
        taskName: null,
        taskPath: null,
        dispatchRaw: run?.raw ?? null,
        validationIssues: run?.validationIssues ?? [],
        deletedTaskIds: [],
        isManual: false,
        isEdited: false,
      },
    };
  }

  const status = toUserStatus({
    run: item.run,
    writeResult: item.writeResult,
    validationIssueCount: item.run?.validationIssues?.length ?? 0,
  });
  const repoById = new Map(input.repositories.map((repo) => [repo.id, repo]));
  const repo = item.cluster.primaryRepositoryId == null
    ? null
    : repoById.get(item.cluster.primaryRepositoryId) ?? null;
  const taskName = item.writeResult?.childTasks.find((task) => task.sourceTaskId === item.task.id)?.taskName ?? null;
  const taskPath = item.writeResult?.childTasks.find((task) => task.sourceTaskId === item.task.id)?.taskPath ?? null;
  const requirementsById = new Map(
    (input.state.requirementsIndex?.requirements ?? []).map((entry) => [entry.id, entry.content]),
  );
  const edits = input.state.editsByCluster[item.cluster.id];
  return {
    taskId: item.task.id,
    clusterId: item.cluster.id,
    title: item.task.title,
    status,
    statusLabel: userStatusLabel(status),
    repositoryLabel: repo ? `${ROLE_LABEL[repo.repositoryType]} · ${repo.name}` : null,
    role: item.task.role,
    priority: derivePriority(item),
    sourceRequirements: item.task.sourceRequirementIds.map((id) => ({
      id,
      bodyPreview: truncate(requirementsById.get(id) ?? id, 120),
    })),
    prdAnchor: anchorToPreview(item.task.taskAnchors),
    taskAnchor: item.task.taskAnchors ?? null,
    codeAnchors: item.task.sourceRefs.map((ref) => parseCodeAnchor(ref, item.cluster.primaryRepositoryId)),
    description: item.task.description,
    subtasks: item.task.subtasks,
    dod: item.task.dod,
    isManual: isManualTask(item.task, edits),
    isEdited: isEditedTask(item.task, edits),
    technical: {
      clusterId: item.cluster.id,
      clusterTitle: item.cluster.title,
      clusterRequirementIds: item.cluster.requirementIds,
      parentTaskLabel: item.run?.parentTaskName ?? null,
      taskName,
      taskPath,
      dispatchRaw: item.run?.raw ?? null,
      validationIssues: item.run?.validationIssues ?? [],
      deletedTaskIds: edits?.deletedTaskIds ?? [],
      isManual: isManualTask(item.task, edits),
      isEdited: isEditedTask(item.task, edits),
    },
  };
}

function anchorToPreview(anchor: TaskAnchorDescriptor | undefined): TaskDetailVM["prdAnchor"] {
  if (!anchor) return null;
  const preview = [anchor.contextBefore, anchor.contextAfter].filter(Boolean).join(" ... ");
  return {
    from: anchor.from,
    to: anchor.to,
    preview: truncate(preview || `位置 ${anchor.from} - ${anchor.to}`, 160),
  };
}

function parseCodeAnchor(raw: string, repositoryId: number | null): TaskDetailVM["codeAnchors"][number] {
  const trimmed = raw.trim();
  const match = /^(.*?)(?::(\d+))?$/.exec(trimmed);
  const filePath = match?.[1]?.trim() || trimmed;
  const lineRaw = match?.[2];
  const line = lineRaw ? Number.parseInt(lineRaw, 10) : null;
  return {
    repositoryId,
    filePath,
    line: Number.isFinite(line) ? line : null,
    raw: trimmed,
  };
}

// ── Engineering details ──

function buildEngineeringDetails(state: WizardState, repositories: Repository[]): EngineeringDetailsVM {
  return {
    workflowGraph: state.workflowGraphResult
      ? {
          workflowId: state.workflowGraphResult.workflowId,
          nodeCount: state.workflowGraphResult.nodeCount,
          edgeCount: state.workflowGraphResult.edgeCount,
          status: state.workflowGraphResult.status,
        }
      : null,
    clusters: (state.plan?.clusters ?? []).map((cluster) => {
      const diff = state.diffByCluster[cluster.id];
      return {
        id: cluster.id,
        title: cluster.title,
        runStatusInternal: state.clusterRuns[cluster.id]?.status ?? "idle",
        parentTaskName: state.clusterRuns[cluster.id]?.parentTaskName ?? null,
        diff: diff?.kind ?? "unknown",
        dirtyReasons: diff?.kind === "dirty"
          ? diff.reasons.map((reason) => reason.kind)
          : [],
        validationIssues: state.clusterRuns[cluster.id]?.validationIssues ?? [],
      };
    }),
    repositories: repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      repositoryType: repo.repositoryType,
    })),
  };
}

function truncate(value: string, max: number): string {
  const source = value.replace(/\s+/g, " ").trim();
  if (source.length <= max) return source;
  return `${source.slice(0, Math.max(0, max - 1))}…`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
