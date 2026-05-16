import { invoke } from "@tauri-apps/api/core";

export interface TrellisRuntimeEvent {
  eventId: string;
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
  taskPath?: string | null;
  taskId?: string | null;
  eventKind: string;
  platform?: string | null;
  actor?: string | null;
  correlationId?: string | null;
  parentEventId?: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface TrellisRuntimeRecordEventInput {
  eventId?: string | null;
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
  taskPath?: string | null;
  taskId?: string | null;
  eventKind: string;
  platform?: string | null;
  actor?: string | null;
  correlationId?: string | null;
  parentEventId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: number | null;
}

export interface TrellisRuntimeListEventsInput {
  projectId?: string | null;
  rootPath?: string | null;
  sessionId?: string | null;
  taskPath?: string | null;
  eventKind?: string | null;
  from?: number | null;
  until?: number | null;
  limit?: number | null;
}

export interface TrellisWorkflowStep {
  id: string;
  title: string;
  phaseId: string;
  required: boolean;
  repeatable: boolean;
  once: boolean;
  rawHeading: string;
}

export interface TrellisWorkflowPhase {
  id: string;
  title: string;
  steps: TrellisWorkflowStep[];
}

export interface TrellisWorkflowStateBlock {
  status: string;
  body: string;
}

export interface TrellisWorkflowPlatformBlock {
  platforms: string[];
  body: string;
}

export interface TrellisWorkflowValidationIssue {
  severity: string;
  code: string;
  message: string;
}

export interface TrellisWorkflowCompiled {
  projectId?: string | null;
  rootPath: string;
  workflowPath: string;
  phases: TrellisWorkflowPhase[];
  workflowStates: TrellisWorkflowStateBlock[];
  platformBlocks: TrellisWorkflowPlatformBlock[];
  validationIssues: TrellisWorkflowValidationIssue[];
  compiledAt: number;
}

export interface TrellisTaskLifecycleInput {
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
  action: string;
  taskRef?: string | null;
  title?: string | null;
  slug?: string | null;
  parent?: string | null;
  contextKind?: string | null;
  contextFile?: string | null;
  contextReason?: string | null;
  priority?: string | null;
  assignee?: string | null;
}

export interface TrellisTaskLifecycleResult {
  action: string;
  rootPath: string;
  taskPath?: string | null;
  status: string;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  event: TrellisRuntimeEvent;
}

export interface TrellisAgentRun {
  agentRunId: string;
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
  taskPath?: string | null;
  taskId?: string | null;
  repositoryId?: number | null;
  repositoryPath?: string | null;
  agentType: string;
  stage?: string | null;
  status: string;
  currentFile?: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
  lastHeartbeatAt: number;
  metadata: Record<string, unknown>;
}

export interface TrellisAgentRunInput {
  agentRunId?: string | null;
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
  taskPath?: string | null;
  taskId?: string | null;
  repositoryId?: number | null;
  repositoryPath?: string | null;
  agentType: string;
  stage?: string | null;
  status: string;
  currentFile?: string | null;
  startedAt?: number | null;
  lastHeartbeatAt?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface TrellisAgentOwnershipGraphInput {
  projectId?: string | null;
  rootPath?: string | null;
  sessionId?: string | null;
  taskPath?: string | null;
  includeCompleted?: boolean | null;
}

export interface TrellisAgentGraphNode {
  id: string;
  nodeType: string;
  label: string;
  status?: string | null;
  metadata: Record<string, unknown>;
}

export interface TrellisAgentGraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  metadata: Record<string, unknown>;
}

export interface TrellisAgentOwnershipGraph {
  nodes: TrellisAgentGraphNode[];
  edges: TrellisAgentGraphEdge[];
  runs: TrellisAgentRun[];
}

export interface TrellisSpecRevisionInput {
  revisionId?: string | null;
  projectId?: string | null;
  rootPath: string;
  filePath: string;
  content: string;
  author?: string | null;
  reason?: string | null;
  source?: string | null;
  taskPath?: string | null;
  createdAt?: number | null;
}

export interface TrellisSpecRevision {
  revisionId: string;
  projectId?: string | null;
  rootPath: string;
  filePath: string;
  fileHash: string;
  content: string;
  author?: string | null;
  reason?: string | null;
  source?: string | null;
  taskPath?: string | null;
  createdAt: number;
}

export interface TrellisListSpecRevisionsInput {
  projectId?: string | null;
  rootPath?: string | null;
  filePath?: string | null;
  limit?: number | null;
}

export interface TrellisOnboardingCheck {
  id: string;
  label: string;
  status: string;
  severity: string;
  detail: string;
  evidence: Record<string, unknown>;
  suggestedAction?: string | null;
}

export interface TrellisOnboardingState {
  projectId?: string | null;
  rootPath: string;
  status: string;
  checks: TrellisOnboardingCheck[];
  inspectedAt: number;
}

export interface TrellisReplayInput {
  projectId?: string | null;
  rootPath?: string | null;
  sessionId?: string | null;
  taskPath?: string | null;
  from?: number | null;
  until?: number | null;
  limit?: number | null;
}

export interface TrellisReplayEntry {
  entryId: string;
  entryType: string;
  timestamp: number;
  title: string;
  summary?: string | null;
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
  taskPath?: string | null;
  payload: Record<string, unknown>;
}

export interface TrellisWorkspaceSnapshotInput {
  projectId?: string | null;
  rootPath: string;
  source?: string | null;
  reason?: string | null;
}

export interface TrellisSnapshotFile {
  path: string;
  hash: string;
  sizeBytes: number;
  modifiedAt?: number | null;
  preview?: string | null;
}

export interface TrellisWorkspaceSnapshot {
  snapshotId: string;
  projectId?: string | null;
  rootPath: string;
  source?: string | null;
  reason?: string | null;
  manifest: TrellisSnapshotFile[];
  fileCount: number;
  contentHash: string;
  createdAt: number;
}

export interface TrellisWorkspaceSnapshotDiffRow {
  path: string;
  changeType: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeSizeBytes?: number | null;
  afterSizeBytes?: number | null;
}

export interface TrellisWorkspaceSnapshotDiff {
  beforeSnapshotId: string;
  afterSnapshotId: string;
  added: TrellisWorkspaceSnapshotDiffRow[];
  removed: TrellisWorkspaceSnapshotDiffRow[];
  modified: TrellisWorkspaceSnapshotDiffRow[];
  unchanged: TrellisWorkspaceSnapshotDiffRow[];
}

export interface ClaudeExternalIngestInput {
  projectId?: string | null;
  rootPath: string;
  missionId?: string | null;
  sessionIds?: string[] | null;
  tailLines?: number | null;
  maxSessions?: number | null;
  staleAfterMs?: number | null;
}

export interface ClaudeExternalSessionIngestSummary {
  sessionId: string;
  updatedAt: number;
  lineCount: number;
  hookEventCount: number;
  agentRunCount: number;
  runtimeEventCount: number;
  assignmentCount: number;
  status: string;
}

export interface ClaudeExternalIngestResult {
  projectId?: string | null;
  rootPath: string;
  missionId?: string | null;
  scannedSessionCount: number;
  runtimeEventCount: number;
  agentRunCount: number;
  assignmentCount: number;
  sessions: ClaudeExternalSessionIngestSummary[];
}

export function recordTrellisRuntimeEvent(
  input: TrellisRuntimeRecordEventInput,
): Promise<TrellisRuntimeEvent> {
  return invoke<TrellisRuntimeEvent>("trellis_runtime_record_event", { input });
}

export async function trellisRuntimeRecordEventSafe(
  input: TrellisRuntimeRecordEventInput | null | undefined,
): Promise<TrellisRuntimeEvent | null> {
  if (!input?.rootPath?.trim() || !input.eventKind?.trim()) return null;
  try {
    return await recordTrellisRuntimeEvent(input);
  } catch (error) {
    console.warn("[trellisRuntime] failed to record runtime event", error);
    return null;
  }
}

export function listTrellisRuntimeEvents(
  input: TrellisRuntimeListEventsInput,
): Promise<TrellisRuntimeEvent[]> {
  return invoke<TrellisRuntimeEvent[]>("trellis_runtime_list_events", { input });
}

export function compileTrellisWorkflow(input: {
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
}): Promise<TrellisWorkflowCompiled> {
  return invoke<TrellisWorkflowCompiled>("trellis_runtime_compile_workflow", { input });
}

export function runTrellisTaskLifecycle(
  input: TrellisTaskLifecycleInput,
): Promise<TrellisTaskLifecycleResult> {
  return invoke<TrellisTaskLifecycleResult>("trellis_runtime_run_task_lifecycle", { input });
}

export function upsertTrellisAgentRun(input: TrellisAgentRunInput): Promise<TrellisAgentRun> {
  return invoke<TrellisAgentRun>("trellis_runtime_upsert_agent_run", { input });
}

export function trellisAgentHeartbeat(agentRunId: string): Promise<boolean> {
  return invoke<boolean>("trellis_agent_heartbeat", { agentRunId });
}

export async function trellisRuntimeUpsertAgentRunSafe(
  missionId: string | null | undefined,
  input: TrellisAgentRunInput | null | undefined,
): Promise<TrellisAgentRun | null> {
  if (!missionId?.trim() || !input?.rootPath?.trim() || !input.agentRunId?.trim() || !input.agentType?.trim()) {
    return null;
  }
  try {
    return await upsertTrellisAgentRun(input);
  } catch (error) {
    console.warn("[trellisRuntime] failed to upsert agent run", error);
    return null;
  }
}

export function getTrellisAgentOwnershipGraph(
  input: TrellisAgentOwnershipGraphInput,
): Promise<TrellisAgentOwnershipGraph> {
  return invoke<TrellisAgentOwnershipGraph>("trellis_runtime_get_agent_ownership_graph", { input });
}

export function recordTrellisSpecRevision(
  input: TrellisSpecRevisionInput,
): Promise<TrellisSpecRevision> {
  return invoke<TrellisSpecRevision>("trellis_runtime_record_spec_revision", { input });
}

export function listTrellisSpecRevisions(
  input: TrellisListSpecRevisionsInput,
): Promise<TrellisSpecRevision[]> {
  return invoke<TrellisSpecRevision[]>("trellis_runtime_list_spec_revisions", { input });
}

export function getTrellisOnboardingState(input: {
  projectId?: string | null;
  rootPath: string;
  sessionId?: string | null;
}): Promise<TrellisOnboardingState> {
  return invoke<TrellisOnboardingState>("trellis_runtime_get_onboarding_state", { input });
}

export function getTrellisReplay(input: TrellisReplayInput): Promise<TrellisReplayEntry[]> {
  return invoke<TrellisReplayEntry[]>("trellis_runtime_get_replay", { input });
}

export function captureTrellisWorkspaceSnapshot(
  input: TrellisWorkspaceSnapshotInput,
): Promise<TrellisWorkspaceSnapshot> {
  return invoke<TrellisWorkspaceSnapshot>("trellis_runtime_capture_workspace_snapshot", { input });
}

export function diffTrellisWorkspaceSnapshots(input: {
  beforeSnapshotId: string;
  afterSnapshotId: string;
}): Promise<TrellisWorkspaceSnapshotDiff> {
  return invoke<TrellisWorkspaceSnapshotDiff>("trellis_runtime_diff_workspace_snapshots", { input });
}

export function ingestExternalClaudeCliSessions(
  input: ClaudeExternalIngestInput,
): Promise<ClaudeExternalIngestResult> {
  return invoke<ClaudeExternalIngestResult>("ingest_external_claude_cli_sessions", { input });
}
