import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CollabAcceptanceManifest,
  CollabAgentBinding,
  CollabAgentConfig,
  CollabAgentProfile,
  CollabAgentRevision,
  CollabAgentSummary,
  CollabArtifactVersion,
  CollabAttempt,
  CollabBindingOverride,
  CollabCapabilityMatrix,
  CollabChangeRequest,
  CollabClaimOutcome,
  CollabDecision,
  CollabDeliverables,
  CollabDispatchMode,
  CollabDispatchResult,
  CollabEffectiveConfigManifest,
  CollabFinishOutcome,
  CollabHeartbeatAck,
  CollabImportReport,
  CollabInboxEntry,
  CollabLaunchCheck,
  CollabMemoryItem,
  CollabMessage,
  CollabOutboxItem,
  CollabRequirement,
  CollabRequirementSnapshot,
  CollabRequirementSummary,
  CollabResource,
  CollabResourceSuggestion,
  CollabResourceVersion,
  CollabResourceVersionSummary,
  CollabRuntimeResource,
  CollabSearchHit,
  CollabSessionRequirement,
  CollabSpace,
  CollabSubscriptionUpdate,
  CollabTaskExplanation,
  CollabVerificationRun,
} from "../../types/collaboration";

/** Rust 每次写操作后广播；payload 为 `{ requirementId: string | null }`。 */
export const COLLAB_CHANGED_EVENT = "wise-collab-changed";

export function onCollabChanged(handler: (requirementId: string | null) => void): Promise<UnlistenFn> {
  return listen<{ requirementId?: string | null }>(COLLAB_CHANGED_EVENT, (event) => {
    const id = event.payload?.requirementId;
    handler(typeof id === "string" && id ? id : null);
  });
}

export function newCollabRequestId(prefix = "req"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

// ── 仓库智能体 ──

export const listCollabAgents = (includeArchived = false) =>
  invoke<CollabAgentSummary[]>("collab_list_agents", { includeArchived });

export const getCollabAgent = (agentId: string) =>
  invoke<{ profile: CollabAgentProfile; bindings: CollabAgentBinding[]; activeRevision: CollabAgentRevision | null }>(
    "collab_get_agent",
    { agentId },
  );

export const getCollabAgentRevision = (agentId: string, revision: number) =>
  invoke<CollabAgentRevision>("collab_get_agent_revision", { agentId, revision });

export const createCollabAgent = (input: {
  name: string;
  description?: string;
  avatarColor?: string | null;
  assistantId?: string | null;
  defaultOwnerProjectId?: string | null;
  config?: Partial<CollabAgentConfig> | null;
}) => invoke<CollabAgentProfile>("collab_create_agent", { input: { description: "", ...input } });

export const updateCollabAgent = (input: {
  agentId: string;
  expectedRowVersion: number;
  name?: string;
  description?: string;
  avatarColor?: string;
  defaultOwnerProjectId?: string;
  draft?: CollabAgentConfig;
}) => invoke<CollabAgentProfile>("collab_update_agent", { input });

export const publishCollabAgent = (agentId: string, expectedRowVersion: number, note?: string) =>
  invoke<CollabAgentRevision>("collab_publish_agent", { agentId, expectedRowVersion, note: note ?? null });

export const rollbackCollabAgent = (agentId: string, toRevision: number, expectedRowVersion: number) =>
  invoke<CollabAgentRevision>("collab_rollback_agent", { agentId, toRevision, expectedRowVersion });

export const setCollabAgentStatus = (
  agentId: string,
  action: "enable" | "disable" | "archive",
  expectedRowVersion: number,
) => invoke<CollabAgentProfile>("collab_set_agent_status", { agentId, action, expectedRowVersion });

export const duplicateCollabAgent = (agentId: string, name: string) =>
  invoke<CollabAgentProfile>("collab_duplicate_agent", { agentId, name });

export const checkCollabAgent = (agentId: string, knownMcpServerIds?: string[] | null) =>
  invoke<{ report: Record<string, unknown>; passed: boolean; profile: CollabAgentProfile }>("collab_check_agent", {
    agentId,
    knownMcpServerIds: knownMcpServerIds ?? null,
  });

export const bindCollabAgent = (input: {
  agentId: string;
  projectId: string;
  repositoryId: number;
  responsibility?: string;
  roleTags?: string[];
  accessScope?: "read" | "read_write";
  override?: Partial<CollabBindingOverride> | null;
  isDefault?: boolean;
}) => invoke<CollabAgentBinding>("collab_bind_agent", { input });

export const unbindCollabAgent = (bindingId: string) =>
  invoke<CollabAgentBinding>("collab_unbind_agent", { bindingId });

export const listRepositoryCollabAgents = (repositoryId: number) =>
  invoke<{ binding: CollabAgentBinding; agent: CollabAgentSummary }[]>("collab_list_repository_agents", {
    repositoryId,
  });

export const getCollabEffectiveConfig = (query: {
  agentId: string;
  revision?: number | null;
  projectId?: string | null;
  repositoryId?: number | null;
  knownMcpServerIds?: string[] | null;
}) => invoke<CollabEffectiveConfigManifest>("collab_effective_config", { query });

export const getCollabCapabilityMatrix = () => invoke<CollabCapabilityMatrix>("collab_capability_matrix");
export const probeCollabEngine = () => invoke<CollabCapabilityMatrix>("collab_probe_engine");

// ── 记忆 ──

export const listCollabMemories = (agentId: string, includeDeleted = false) =>
  invoke<CollabMemoryItem[]>("collab_list_memories", { agentId, includeDeleted });

export const addCollabMemory = (input: {
  agentId: string;
  scope: CollabMemoryItem["scope"];
  content: string;
  projectId?: string | null;
  repositoryId?: number | null;
  requirementId?: string | null;
  trust?: CollabMemoryItem["trust"];
  expiresAt?: number | null;
}) => invoke<CollabMemoryItem>("collab_add_memory", { input: { trust: "user", ...input } });

export const updateCollabMemory = (input: {
  memoryId: string;
  expectedRevision: number;
  content?: string;
  trust?: CollabMemoryItem["trust"];
  expiresAt?: number | null;
}) => invoke<CollabMemoryItem>("collab_update_memory", { input });

export const deleteCollabMemory = (memoryId: string) => invoke<CollabMemoryItem>("collab_delete_memory", { memoryId });
export const clearCollabMemories = (agentId: string) => invoke<number>("collab_clear_memories", { agentId });
export const listCollabMemoryRevisions = (memoryId: string) =>
  invoke<Record<string, unknown>[]>("collab_memory_revisions", { memoryId });

// ── 需求 ──

export const dispatchCollabIntent = (input: {
  requestId: string;
  agentId: string;
  mode: CollabDispatchMode;
  body: string;
  title?: string | null;
  requirementId?: string | null;
  projectContext?: string | null;
  originSessionId?: string | null;
  originMessageId?: string | null;
  attachments?: string[];
}) => invoke<CollabDispatchResult>("collab_dispatch_intent", { input });

export const createCollabRequirement = (input: {
  requestId?: string;
  title?: string | null;
  body: string;
  ownerAgentId?: string | null;
  ownerProjectId?: string | null;
  participantProjectIds?: string[];
  imagePaths?: string[];
  planApprovalRequired?: boolean;
  collaborationMode?: "serial" | "contract_parallel" | null;
  acceptancePolicy?: "manual" | "machine" | null;
  maxConcurrentAttempts?: number | null;
  executionAttemptBudget?: number | null;
  repairRoundBudget?: number | null;
  budgetMs?: number | null;
  originSessionId?: string | null;
}) => invoke<CollabRequirement>("collab_create_requirement", { input });

export const listCollabRequirements = (projectId?: string | null, includeDone = true) =>
  invoke<CollabRequirementSummary[]>("collab_list_requirements", { projectId: projectId ?? null, includeDone });

export const getCollabRequirementSnapshot = (requirementId: string) =>
  invoke<CollabRequirementSnapshot>("collab_requirement_snapshot", { requirementId });

export const listCollabRequirementsForSession = (sessionId: string) =>
  invoke<CollabSessionRequirement[]>("collab_requirements_for_session", { sessionId });

export const listCollabEventsSince = (requirementId: string, afterSeq = 0) =>
  invoke<Record<string, unknown>[]>("collab_events_since", { requirementId, afterSeq });

export const listCollabMessages = (requirementId: string, opts?: { taskId?: string; before?: number; limit?: number }) =>
  invoke<CollabMessage[]>("collab_list_messages", {
    requirementId,
    taskId: opts?.taskId ?? null,
    before: opts?.before ?? null,
    limit: opts?.limit ?? null,
  });

export const requeueCollabMessage = (messageId: string) => invoke<void>("collab_requeue_message", { messageId });

export const reviseCollabRequirement = (input: {
  requestId: string;
  requirementId: string;
  expectedRevision?: number | null;
  input: string;
  attachments?: string[];
  scopeChange?: boolean;
}) => invoke<CollabRequirement>("collab_revise_requirement", { input });

export const controlCollabRequirement = (input: {
  requestId: string;
  requirementId: string;
  action: "pause" | "resume" | "cancel" | "reopen";
  expectedRevision?: number | null;
}) => invoke<CollabRequirement>("collab_control_requirement", { input });

export const transferCollabOwner = (input: {
  requestId: string;
  requirementId: string;
  targetAgentId: string;
  expectedRevision?: number | null;
  ownerProjectId?: string | null;
}) => invoke<CollabRequirement>("collab_transfer_owner", { input });

export const publishCollabPlan = (requirementId: string, input: Record<string, unknown>) =>
  invoke<Record<string, unknown>>("collab_publish_plan", { requirementId, input });

export const resolveCollabDecision = (input: {
  decisionId: string;
  expectedRevision: number;
  optionId: string;
  requestId: string;
  note?: string;
  evidence?: unknown;
  values?: Record<string, unknown>;
}) => invoke<CollabDecision>("collab_resolve_decision", { input: { note: "", evidence: null, values: {}, ...input } });

export const getCollabTaskDetail = (taskId: string) =>
  invoke<Record<string, unknown>>("collab_task_detail", { taskId });

export const listCollabDeliverables = (repositoryId?: number | null, limit?: number) =>
  invoke<CollabDeliverables>("collab_deliverables", { repositoryId: repositoryId ?? null, limit: limit ?? null });

export const explainCollabRequirement = (requirementId: string) =>
  invoke<CollabTaskExplanation[]>("collab_explain_requirement", { requirementId });

export const refreshCollabAcceptance = (requirementId: string) =>
  invoke<CollabAcceptanceManifest>("collab_refresh_acceptance", { requirementId });

export const acceptCollabRequirement = (input: {
  requestId: string;
  requirementId: string;
  manifestRevision: number;
  manifestHash: string;
  expectedRevision?: number | null;
  note?: string;
  reject?: boolean;
  reopenTaskIds?: string[];
}) => invoke<CollabAcceptanceManifest>("collab_accept", { input: { note: "", reject: false, reopenTaskIds: [], ...input } });

export const mergeCollabChanges = (duplicateId: string, primaryId: string) =>
  invoke<CollabChangeRequest>("collab_merge_changes", { duplicateId, primaryId });

export const getCollabUsageSummary = (requirementId: string) =>
  invoke<Record<string, unknown>>("collab_usage_summary", { requirementId });

// ── V1 迁移 ──

export const importCollabV1 = (input: { itemIds?: string[]; openAsActive?: boolean; runningSessionIds?: string[] }) =>
  invoke<CollabImportReport>("collab_import_v1", { input });

export const getCollabLegacyHistory = (requirementId: string) =>
  invoke<Record<string, unknown>>("collab_legacy_history", { requirementId });

export const setCollabLegacyTarget = (requirementId: string, repositoryId: number) =>
  invoke<void>("collab_set_legacy_target", { requirementId, repositoryId });

// ── 执行桥 ──

export const claimCollabTask = (input: {
  leaseOwner: string;
  globalLimit?: number | null;
  requirementId?: string | null;
  taskId?: string | null;
  knownMcpServerIds?: string[] | null;
}) => invoke<CollabClaimOutcome>("collab_claim", { input });

export const confirmCollabLaunch = (attemptId: string, fencingToken: number) =>
  invoke<CollabLaunchCheck>("collab_confirm_launch", { attemptId, fencingToken });

export const bindCollabSession = (attemptId: string, fencingToken: number, sessionId: string) =>
  invoke<CollabAttempt>("collab_bind_session", { attemptId, fencingToken, sessionId });

export const heartbeatCollabAttempt = (attemptId: string, fencingToken: number) =>
  invoke<CollabHeartbeatAck>("collab_heartbeat", { attemptId, fencingToken });

export const finishCollabAttempt = (input: {
  attemptId: string;
  fencingToken: number;
  outcome: CollabFinishOutcome;
  message?: string | null;
  durationMs?: number | null;
  tokens?: number | null;
}) => invoke<CollabAttempt>("collab_finish_attempt", { input });

export const requestCollabStop = (attemptId: string, reason?: string) =>
  invoke<CollabAttempt>("collab_request_stop", { attemptId, reason: reason ?? null });

export const markCollabStopPending = (attemptId: string) =>
  invoke<CollabAttempt>("collab_mark_stop_pending", { attemptId });

export const reconcileCollabAttempt = (input: {
  dispatchKey: string;
  observed: "running" | "idle" | "missing";
  sessionId?: string | null;
}) => invoke<CollabAttempt | null>("collab_reconcile", { input });

export const listActiveCollabAttempts = () => invoke<CollabAttempt[]>("collab_active_attempts");

export const getCollabBridgeStatus = () => invoke<{ port: number | null; cli: string | null }>("collab_bridge_status");

// ── 验证 / 交付 ──

export const runCollabVerification = (taskId: string, command?: string | null) =>
  invoke<CollabVerificationRun>("collab_run_verification", { taskId, command: command ?? null });

export const revalidateCollabArtifact = (versionId: string) =>
  invoke<CollabArtifactVersion>("collab_revalidate_artifact", { versionId });

export const invalidateCollabArtifact = (versionId: string, reason: string) =>
  invoke<CollabArtifactVersion>("collab_invalidate_artifact", { versionId, reason });

// ── 运行环境 ──

export const listPendingCollabRuntimeStops = () => invoke<CollabRuntimeResource[]>("collab_pending_runtime_stops");
export const markCollabRuntimeStopped = (resourceId: string) =>
  invoke<CollabRuntimeResource>("collab_mark_runtime_stopped", { resourceId });

// ── 共享资源 ──

export const listCollabResources = (projectId?: string | null) =>
  invoke<CollabResource[]>("collab_list_resources", { projectId: projectId ?? null });

export const listCollabResourceVersions = (resourceId: string) =>
  invoke<CollabResourceVersionSummary[]>("collab_resource_versions", { resourceId });

export const createCollabResource = (input: {
  title: string;
  kind: string;
  content: string;
  ownerProjectId?: string | null;
  ownerAgentId?: string | null;
  maintainer?: string;
  visibility?: CollabResource["visibility"];
  spaceId?: string | null;
  repositoryId?: number | null;
  location?: string;
  note?: string;
  sourceRef?: unknown;
}) =>
  invoke<CollabResource>("collab_create_resource", {
    input: {
      ownerProjectId: null,
      ownerAgentId: null,
      maintainer: "",
      visibility: "source",
      spaceId: null,
      repositoryId: null,
      location: "",
      note: "",
      sourceRef: null,
      publisher: "user",
      ...input,
    },
  });

export const publishCollabResourceVersion = (resourceId: string, content: string, note?: string) =>
  invoke<CollabResourceVersion>("collab_publish_resource_version", {
    resourceId,
    content,
    note: note ?? null,
    sourceRef: null,
  });

export const grantCollabResource = (resourceId: string, granteeKind: "project" | "agent" | "task" | "space", granteeId: string) =>
  invoke<CollabResource>("collab_grant_resource", { resourceId, granteeKind, granteeId });

export const revokeCollabResourceGrant = (grantId: string) =>
  invoke<CollabResource>("collab_revoke_resource_grant", { grantId });

export const setCollabResourceVisibility = (
  resourceId: string,
  visibility: CollabResource["visibility"],
  spaceId?: string | null,
) => invoke<CollabResource>("collab_set_resource_visibility", { resourceId, visibility, spaceId: spaceId ?? null });

export const archiveCollabResource = (resourceId: string) =>
  invoke<CollabResource>("collab_archive_resource", { resourceId });

export const searchCollabResources = (query: string, projectId?: string | null, limit?: number) =>
  invoke<CollabSearchHit[]>("collab_search_resources", { query, projectId: projectId ?? null, limit: limit ?? null });

export const readCollabResource = (resourceId: string, version?: number | null) =>
  invoke<{ resource: CollabResource; version: CollabResourceVersion }>("collab_read_resource", {
    resourceId,
    version: version ?? null,
  });

export const subscribeCollabResource = (resourceId: string, subscriberKind: "project" | "agent", subscriberId: string) =>
  invoke<Record<string, unknown>>("collab_subscribe_resource", { resourceId, subscriberKind, subscriberId });

export const listCollabResourceUpdates = (subscriberKind: "project" | "agent", subscriberId: string) =>
  invoke<CollabSubscriptionUpdate[]>("collab_resource_updates", { subscriberKind, subscriberId });

export const suggestCollabResource = (resourceId: string, body: string, fromProjectId?: string | null) =>
  invoke<Record<string, unknown>>("collab_suggest_resource", { resourceId, body, fromProjectId: fromProjectId ?? null });

export const listCollabResourceSuggestions = (resourceId: string) =>
  invoke<CollabResourceSuggestion[]>("collab_list_resource_suggestions", { resourceId });

export const resolveCollabResourceSuggestion = (suggestionId: string, accept: boolean) =>
  invoke<void>("collab_resolve_resource_suggestion", { suggestionId, accept });

export const listCollabSpaces = () => invoke<CollabSpace[]>("collab_list_spaces");

export const createCollabSpace = (name: string, ownerProjectId: string, description?: string) =>
  invoke<{ id: string; name: string }>("collab_create_space", { name, ownerProjectId, description: description ?? null });

export const setCollabSpaceMember = (spaceId: string, projectId: string, member: boolean) =>
  invoke<void>("collab_set_space_member", { spaceId, projectId, member });

// ── Channel outbox ──

export const listDueCollabOutbox = (channel: string, limit?: number) =>
  invoke<CollabOutboxItem[]>("collab_due_outbox", { channel, limit: limit ?? null });

export const ackCollabOutbox = (id: number, ok: boolean, error?: string | null) =>
  invoke<void>("collab_ack_outbox", { id, ok, error: error ?? null });

export const listCollabInbox = (opts?: { before?: number; limit?: number; unreadOnly?: boolean }) =>
  invoke<CollabInboxEntry[]>("collab_channel_inbox", {
    before: opts?.before ?? null,
    limit: opts?.limit ?? null,
    unreadOnly: opts?.unreadOnly ?? null,
  });

export const markCollabInboxRead = (messageIds: string[]) =>
  invoke<number>("collab_mark_inbox_read", { messageIds });
