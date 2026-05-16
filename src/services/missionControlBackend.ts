import { invoke } from "@tauri-apps/api/core";

export interface MissionSnapshotRecord {
  missionId: string;
  projectId?: string | null;
  projectName?: string | null;
  rootPath: string;
  prdHash?: string | null;
  title: string;
  stage: string;
  status: string;
  snapshot: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface MissionCreateOrResumeInput {
  missionId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  rootPath: string;
  prdHash?: string | null;
  title?: string | null;
  stage: string;
  status: string;
  snapshot: Record<string, unknown>;
}

export interface MissionEventRecord {
  eventId: string;
  missionId: string;
  eventType: string;
  timestamp: number;
  actor?: string | null;
  payload: Record<string, unknown>;
}

export interface MissionAppendEventInput {
  eventId?: string | null;
  missionId: string;
  eventType: string;
  timestamp?: number | null;
  actor?: string | null;
  payload: Record<string, unknown>;
}

export type MissionAgentAssignmentStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "completed"
  | "blocked"
  | "stale"
  | string;

export interface MissionAgentAssignment {
  assignmentId: string;
  missionId: string;
  agentRunId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  clusterId?: string | null;
  repositoryId?: number | null;
  repositoryPath?: string | null;
  agentType: string;
  employeeId?: string | null;
  stage: string;
  status: MissionAgentAssignmentStatus;
  currentFile?: string | null;
  sessionId?: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
  lastHeartbeatAt: number;
  metadata: Record<string, unknown>;
}

export interface MissionUpsertAgentAssignmentInput {
  assignmentId?: string | null;
  agentRunId?: string | null;
  missionId: string;
  projectId?: string | null;
  taskId?: string | null;
  clusterId?: string | null;
  repositoryId?: number | null;
  repositoryPath?: string | null;
  agentType: string;
  employeeId?: string | null;
  stage: string;
  status: MissionAgentAssignmentStatus;
  currentFile?: string | null;
  sessionId?: string | null;
  startedAt?: number | null;
  lastHeartbeatAt?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface MissionCompleteAgentAssignmentInput {
  assignmentId?: string | null;
  agentRunId?: string | null;
  status?: MissionAgentAssignmentStatus | null;
  completedAt?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface MissionListAssignmentsInput {
  missionId?: string | null;
  projectId?: string | null;
  includeCompleted?: boolean | null;
  staleAfterMs?: number | null;
}

export interface MissionTraceRequirement {
  id: string;
  content: string;
  bodyHash?: string | null;
}

export interface MissionTraceCluster {
  id: string;
  title: string;
  repositoryIds: number[];
  primaryRepositoryId?: number | null;
}

export interface MissionTraceCodeAnchor {
  raw: string;
  filePath: string;
  line?: number | null;
}

export interface MissionTraceTask {
  taskId: string;
  title: string;
  status?: string | null;
  role?: string | null;
  priority?: string | null;
  clusterId?: string | null;
  repositoryId?: number | null;
  repositoryPath?: string | null;
  sourceRequirementIds: string[];
  taskPath?: string | null;
  taskName?: string | null;
  codeAnchors: MissionTraceCodeAnchor[];
  relatedFiles: string[];
  assignments: MissionAgentAssignment[];
}

export interface MissionRequirementTrace {
  missionId: string;
  requirementId: string;
  requirement?: MissionTraceRequirement | null;
  clusters: MissionTraceCluster[];
  tasks: MissionTraceTask[];
}

export interface MissionReassignAgentImpact {
  assignmentId: string;
  taskId?: string | null;
  clusterId?: string | null;
  status: string;
  recommendedAction: string;
}

export interface MissionReassignPreview {
  previewId: string;
  missionId: string;
  requirementId: string;
  sourceClusterId?: string | null;
  targetClusterId: string;
  affectedClusters: string[];
  dirtyClusterCount: number;
  invalidatedTaskIds: string[];
  manualEditClusterIds: string[];
  dependencyTaskIds: string[];
  agentImpacts: MissionReassignAgentImpact[];
  createdAt: number;
  expiresAt: number;
}

export interface MissionSessionBinding {
  sessionId: string;
  missionId: string;
  projectId?: string | null;
  attachedAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface MissionInstruction {
  instructionId: string;
  missionId: string;
  sessionId?: string | null;
  targetKind: string;
  targetId?: string | null;
  instruction: string;
  actor?: string | null;
  status: string;
  createdAt: number;
  deliveredAt?: number | null;
  metadata: Record<string, unknown>;
}

export interface MissionAgentCommand {
  commandId: string;
  missionId: string;
  commandType: string;
  targetKind: string;
  targetId?: string | null;
  assignmentId?: string | null;
  agentRunId?: string | null;
  status: string;
  requestedAt: number;
  completedAt?: number | null;
  result: Record<string, unknown>;
}

export interface MissionEvidence {
  evidenceId: string;
  missionId: string;
  taskId?: string | null;
  requirementId?: string | null;
  clusterId?: string | null;
  agentRunId?: string | null;
  repositoryPath?: string | null;
  evidenceType: string;
  status: string;
  summary?: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface MissionReplayEntry {
  entryId: string;
  missionId: string;
  timestamp: number;
  entryType: "event" | "evidence" | string;
  title: string;
  summary?: string | null;
  requirementId?: string | null;
  taskId?: string | null;
  clusterId?: string | null;
  repositoryPath?: string | null;
  agentRunId?: string | null;
  payload: Record<string, unknown>;
}

export interface MissionOnboardingHealthCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | string;
  severity: "info" | "warning" | "error" | string;
  detail: string;
  suggestedAction?: string | null;
}

export interface MissionOnboardingHealthReport {
  projectId?: string | null;
  rootPath?: string | null;
  status: "ready" | "warning" | "blocked" | string;
  checks: MissionOnboardingHealthCheck[];
}

export function createOrResumeMission(
  input: MissionCreateOrResumeInput,
): Promise<MissionSnapshotRecord> {
  return invoke<MissionSnapshotRecord>("mission_create_or_resume", { input });
}

export function getMissionSnapshot(missionId: string): Promise<MissionSnapshotRecord | null> {
  return invoke<MissionSnapshotRecord | null>("mission_get_snapshot", { missionId });
}

export function listRecentMissions(input: {
  projectId?: string | null;
  rootPath?: string | null;
  limit?: number | null;
} = {}): Promise<MissionSnapshotRecord[]> {
  return invoke<MissionSnapshotRecord[]>("mission_list_recent", input);
}

export function appendMissionEvent(input: MissionAppendEventInput): Promise<MissionEventRecord> {
  return invoke<MissionEventRecord>("mission_append_event", { input });
}

export function listMissionEvents(input: {
  missionId: string;
  from?: number | null;
  until?: number | null;
}): Promise<MissionEventRecord[]> {
  return invoke<MissionEventRecord[]>("mission_list_events", input);
}

export function getRequirementTrace(input: {
  missionId: string;
  requirementId: string;
}): Promise<MissionRequirementTrace> {
  return invoke<MissionRequirementTrace>("mission_get_requirement_trace", input);
}

export function upsertMissionAgentAssignment(
  input: MissionUpsertAgentAssignmentInput,
): Promise<MissionAgentAssignment> {
  return invoke<MissionAgentAssignment>("mission_upsert_agent_assignment", { input });
}

export function completeMissionAgentAssignment(
  input: MissionCompleteAgentAssignmentInput,
): Promise<MissionAgentAssignment> {
  return invoke<MissionAgentAssignment>("mission_complete_agent_assignment", { input });
}

export function listMissionAgentAssignments(
  input: MissionListAssignmentsInput,
): Promise<MissionAgentAssignment[]> {
  return invoke<MissionAgentAssignment[]>("mission_list_agent_assignments", { input });
}

export function previewRequirementReassign(input: {
  missionId: string;
  requirementId: string;
  targetClusterId: string;
}): Promise<MissionReassignPreview> {
  return invoke<MissionReassignPreview>("mission_preview_requirement_reassign", { input });
}

export function commitRequirementReassign(input: {
  missionId: string;
  previewId: string;
  actor?: string | null;
  origin?: string | null;
}): Promise<MissionSnapshotRecord> {
  return invoke<MissionSnapshotRecord>("mission_commit_requirement_reassign", { input });
}

export function recordMissionPlanningMutation(input: {
  missionId: string;
  mutationType: string;
  actor?: string | null;
  origin?: string | null;
  payload: Record<string, unknown>;
}): Promise<MissionEventRecord> {
  return invoke<MissionEventRecord>("mission_record_planning_mutation", { input });
}

export function attachMissionToSession(input: {
  sessionId: string;
  missionId: string;
  projectId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<MissionSessionBinding> {
  return invoke<MissionSessionBinding>("mission_attach_to_session", { input });
}

export function getSessionMission(sessionId: string): Promise<MissionSnapshotRecord | null> {
  return invoke<MissionSnapshotRecord | null>("mission_get_session_mission", { sessionId });
}

export function appendMissionInstruction(input: {
  instructionId?: string | null;
  missionId: string;
  sessionId?: string | null;
  targetKind: string;
  targetId?: string | null;
  instruction: string;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<MissionInstruction> {
  return invoke<MissionInstruction>("mission_append_instruction", { input });
}

export function recordMissionAgentCommand(input: {
  commandId?: string | null;
  missionId: string;
  commandType: string;
  targetKind: string;
  targetId?: string | null;
  assignmentId?: string | null;
  agentRunId?: string | null;
  result?: Record<string, unknown> | null;
}): Promise<MissionAgentCommand> {
  return invoke<MissionAgentCommand>("mission_record_agent_command", { input });
}

export function completeMissionAgentCommand(input: {
  commandId: string;
  status: string;
  result?: Record<string, unknown> | null;
}): Promise<MissionAgentCommand> {
  return invoke<MissionAgentCommand>("mission_complete_agent_command", { input });
}

export function recordMissionEvidence(input: {
  evidenceId?: string | null;
  missionId: string;
  taskId?: string | null;
  requirementId?: string | null;
  clusterId?: string | null;
  agentRunId?: string | null;
  repositoryPath?: string | null;
  evidenceType: string;
  status: string;
  summary?: string | null;
  payload: Record<string, unknown>;
  createdAt?: number | null;
}): Promise<MissionEvidence> {
  return invoke<MissionEvidence>("mission_record_evidence", { input });
}

export function captureMissionGitEvidence(input: {
  missionId: string;
  taskId?: string | null;
  requirementId?: string | null;
  clusterId?: string | null;
  agentRunId?: string | null;
  repositoryPath: string;
}): Promise<MissionEvidence> {
  return invoke<MissionEvidence>("mission_capture_git_evidence", { input });
}

export function listMissionEvidence(input: {
  missionId: string;
  taskId?: string | null;
  requirementId?: string | null;
  repositoryPath?: string | null;
  agentRunId?: string | null;
}): Promise<MissionEvidence[]> {
  return invoke<MissionEvidence[]>("mission_list_evidence", { input });
}

export function getMissionReplay(input: {
  missionId: string;
  requirementId?: string | null;
  taskId?: string | null;
  repositoryPath?: string | null;
  agentRunId?: string | null;
}): Promise<MissionReplayEntry[]> {
  return invoke<MissionReplayEntry[]>("mission_get_replay", { input });
}

export function getMissionOnboardingHealth(input: {
  projectId?: string | null;
  rootPath?: string | null;
}): Promise<MissionOnboardingHealthReport> {
  return invoke<MissionOnboardingHealthReport>("mission_get_onboarding_health", { input });
}
