/**
 * 多仓库需求协作（Rust `collaboration` 模块）的前端镜像类型。
 * 字段与 Rust `serde(rename_all = "camelCase")` 序列化一致；JSON 负载统一为 `unknown` 由调用方校验。
 */

export type CollabBusinessStatus = "open" | "verifying" | "done";
export type CollabControlStatus = "active" | "pausing" | "paused" | "cancelling" | "cancelled";
export type CollabTaskState =
  | "waiting_dependencies"
  | "ready"
  | "running"
  | "waiting_change"
  | "checking"
  | "succeeded"
  | "failed"
  | "cancelled";
export type CollabTaskKind = "plan" | "implement" | "repair" | "qa" | "env" | "legacy";
export type CollabAttemptState = "claimed" | "running" | "stop_requested" | "stop_pending" | "lost" | "finished";
export type CollabDispatchMode = "discuss" | "plan" | "execute";
export type CollabAgentStatus = "draft" | "checked" | "enabled" | "disabled" | "archived";
export type CollabChangeState =
  | "open"
  | "triaged"
  | "fixing"
  | "ready_for_retest"
  | "verified"
  | "closed"
  | "needs_decision"
  | "rejected";
export type CollabArtifactValidation = "pending" | "valid" | "invalid" | "invalidated";
export type CollabResourceVisibility = "source" | "space" | "granted" | "agent_private";

export interface CollabError {
  code: string;
  message: string;
  retryable: boolean;
  currentRevision?: number;
  affectedTaskIds: string[];
  suggestedAction?: string;
  details?: unknown;
}

// ── 仓库智能体 ──

export interface CollabKnowledgeRef {
  resourceId: string;
  pinnedVersion: number | null;
  label: string;
}

export interface CollabMemoryPolicy {
  enabled: boolean;
  autoSaveVerified: boolean;
  maxItems: number;
}

export interface CollabSkillBinding {
  id: string;
  label: string;
  sourcePath: string | null;
  version: string | null;
  required: boolean;
  repositoryIds: number[];
  params: unknown;
}

export interface CollabMcpBinding {
  serverId: string;
  label: string;
  tools: string[];
  credentialRef: string | null;
  required: boolean;
  sourcePath: string | null;
}

export interface CollabRunPolicy {
  defaultMode: CollabDispatchMode;
  maxConcurrentAttempts: number;
  repairRoundBudget: number;
  executionAttemptBudget: number;
  budgetMs: number | null;
  isolation: "strict" | "best_effort";
  acceptancePolicy: "manual" | "machine";
}

export interface CollabAgentConfig {
  soulMd: string;
  agentsMd: string;
  knowledgeRefs: CollabKnowledgeRef[];
  memoryPolicy: CollabMemoryPolicy;
  skillBindings: CollabSkillBinding[];
  mcpBindings: CollabMcpBinding[];
  engineId: string;
  model: string | null;
  delegationPolicy: { allowedExecutorAgentIds: string[] };
  runPolicy: CollabRunPolicy;
  templateId: string | null;
  templateHash: string | null;
}

export interface CollabBindingOverride {
  agentsMd: string | null;
  knowledgeRefs: CollabKnowledgeRef[];
  skillsEnable: CollabSkillBinding[];
  skillsDisable: string[];
  mcpsEnable: CollabMcpBinding[];
  mcpsDisable: string[];
}

export interface CollabAgentBinding {
  id: string;
  agentId: string;
  projectId: string;
  repositoryId: number;
  responsibility: string;
  roleTags: string[];
  accessScope: "read" | "read_write";
  override: CollabBindingOverride;
  isDefault: boolean;
  status: "active" | "unbound";
  authVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface CollabAgentRevisionSummary {
  revision: number;
  configHash: string;
  source: string;
  rollbackOf: number | null;
  note: string;
  createdAt: number;
}

export interface CollabAgentRevision extends CollabAgentRevisionSummary {
  agentId: string;
  config: CollabAgentConfig;
}

export interface CollabAgentProfile {
  id: string;
  assistantId: string | null;
  name: string;
  description: string;
  avatarColor: string | null;
  defaultOwnerProjectId: string | null;
  status: CollabAgentStatus;
  activeRevision: number;
  draft: CollabAgentConfig;
  draftHash: string;
  activeConfigHash: string | null;
  hasUnpublishedChanges: boolean;
  draftUpdatedAt: number;
  rowVersion: number;
  lastCheck: unknown;
  authVersion: number;
  bindings: CollabAgentBinding[];
  revisions: CollabAgentRevisionSummary[];
  createdAt: number;
  updatedAt: number;
}

/** `collab_list_agents` 行：摘要 + 绑定。 */
export interface CollabAgentSummary {
  id: string;
  name: string;
  status: CollabAgentStatus;
  activeRevision: number;
  description: string;
  avatarColor: string | null;
  assistantId: string | null;
  defaultOwnerProjectId: string | null;
  hasUnpublishedChanges: boolean;
  engineId: string;
  defaultMode: CollabDispatchMode;
  updatedAt: number;
  bindings: CollabAgentBinding[];
}

export interface CollabMemoryItem {
  id: string;
  agentId: string;
  scope: "agent" | "repository" | "requirement";
  projectId: string | null;
  repositoryId: number | null;
  requirementId: string | null;
  content: string;
  sourceAttemptId: string | null;
  evidence: unknown;
  trust: "verified" | "candidate" | "user";
  revision: number;
  expiresAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollabEngineCapability {
  engineId: string;
  independentInstructions: string;
  nativeRepoRules: string;
  skillMount: string;
  mcpRestriction: string;
  memoryIsolation: string;
  toolAllowlist: string;
  resume: string;
  queryByDispatchKey: string;
  cancel: string;
  evidence: string[];
  probedAt: number | null;
}

export type CollabCapabilityMatrix = Record<string, CollabEngineCapability>;

export interface CollabManifestItemStatus {
  status: string;
  reason: string | null;
  source: string;
  required: boolean;
}

export interface CollabEffectiveConfigManifest {
  agentId: string;
  agentName: string;
  agentStatus: string;
  profileRevision: number;
  activeRevision: number;
  configHash: string;
  authVersion: number;
  engineId: string;
  model: string | null;
  isolation: string;
  projectId: string | null;
  repositoryId: number | null;
  bindingId: string | null;
  accessScope: string | null;
  responsibility: string | null;
  soulHash: string;
  agentsMdHash: string;
  repositoryOverrideApplied: boolean;
  repoRules: { path: string; hash: string; bytes: number; scope: string }[];
  knowledge: { resourceId: string; pinnedVersion: number | null; label: string; source: string }[];
  memoryPolicy: unknown;
  skills: (CollabManifestItemStatus & { id: string; label: string; version: string | null; sourcePath: string | null })[];
  mcps: (CollabManifestItemStatus & { serverId: string; label: string; tools: string[]; sourcePath: string | null })[];
  capabilities: CollabEngineCapability;
  blocked: boolean;
  blockReasons: string[];
  degradations: string[];
  resolvedAt: number;
}

export interface CollabSpawnConfig {
  engineId: string;
  model: string | null;
  appendSystemPrompt: string;
  mcpServerKeys: string[];
  mcpExtraConfigPaths: string[];
  strictMcpConfig: boolean;
  settingSources: string | null;
  allowedTools: string | null;
  disallowedTools: string | null;
  addDirs: string[];
  readOnly: boolean;
}

// ── 需求 / 任务 / 尝试 ──

export interface CollabRequirement {
  id: string;
  title: string;
  body: string;
  imagePaths: string[];
  ownerProjectId: string | null;
  ownerAgentId: string | null;
  profileRevision: number | null;
  businessStatus: CollabBusinessStatus;
  controlStatus: CollabControlStatus;
  stage: string;
  revision: number;
  requirementRevision: number;
  activePlanRevision: number;
  planApprovalRequired: boolean;
  acceptancePolicy: "manual" | "machine";
  collaborationMode: "serial" | "contract_parallel";
  generation: number;
  priority: number;
  sortOrder: number;
  maxConcurrentAttempts: number;
  executionAttemptBudget: number;
  repairRoundBudget: number;
  budgetMs: number | null;
  extraScope: number[];
  originSessionId: string | null;
  legacyId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollabRequirementCounts {
  tasks: number;
  byState: Partial<Record<CollabTaskState, number>>;
  openDecisions: number;
  openChanges: number;
  activeAttempts: number;
  repositories: number;
}

export interface CollabRequirementSummary extends CollabRequirement {
  counts: CollabRequirementCounts;
  projects: { projectId: string; responsibility: string }[];
}

export interface CollabTask {
  id: string;
  requirementId: string;
  planRevision: number;
  taskKey: string;
  title: string;
  projectId: string | null;
  repositoryId: number | null;
  role: string;
  kind: CollabTaskKind;
  state: CollabTaskState;
  active: boolean;
  revision: number;
  specRevision: number;
  spec: Record<string, unknown>;
  specHash: string;
  executorAgentId: string | null;
  profileRevision: number | null;
  delegatedByTaskId: string | null;
  delegationDepth: number;
  runtimeTarget: string;
  checkpointId: string | null;
  generation: number;
  failureCount: number;
  attemptBudget: number;
  nextAction: string;
  changeRequestId: string | null;
  repairRound: number | null;
  result: unknown;
  priority: number;
  queuedAt: number;
  supersededBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollabDependency {
  id: string;
  taskId: string;
  producerTaskId: string;
  gateKind: "artifact_ready" | "task_succeeded" | "contract_available";
  artifactSelector: string | null;
  requiredVersion: number | null;
  planRevision: number;
}

export interface CollabAttempt {
  id: string;
  taskId: string;
  requirementId: string;
  generation: number;
  sessionId: string | null;
  dispatchKey: string;
  action: string;
  coveredChanges: unknown;
  inputManifest: unknown;
  effectiveConfigManifest: unknown;
  leaseOwner: string;
  leaseExpiry: number;
  fencingToken: number;
  workspaceKey: string | null;
  state: CollabAttemptState;
  stopReason: string | null;
  result: string | null;
  resultJson: unknown;
  reported: unknown;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

export interface CollabCheckpoint {
  id: string;
  taskId: string;
  attemptId: string | null;
  codeLocation: unknown;
  worktreeDigest: string;
  completed: unknown;
  todo: unknown;
  failingCases: unknown;
  lockedVersions: unknown;
  resumeNotes: string;
  createdAt: number;
}

export interface CollabBlocker {
  code: string;
  message: string;
  refId: string | null;
  needsDecision: boolean;
}

export interface CollabTaskExplanation {
  taskId: string;
  taskKey: string;
  title: string;
  state: CollabTaskState;
  blockers: CollabBlocker[];
}

export interface CollabArtifactVersion {
  id: string;
  artifactId: string;
  name: string;
  kind: string;
  version: number;
  requirementId: string;
  producerTaskId: string;
  attemptId: string | null;
  planRevision: number;
  repositoryId: number | null;
  commitSha: string | null;
  branch: string | null;
  contract: unknown;
  contractHash: string;
  runtimeTargetId: string;
  environmentId: string | null;
  endpoint: string | null;
  healthUrl: string | null;
  deployedCommit: string | null;
  healthCheckAt: number | null;
  credentialRef: string | null;
  setupGuideRef: string | null;
  fixtureRefs: unknown;
  testEvidence: unknown;
  compatibility: "compatible" | "breaking" | "unknown";
  supersedesVersion: number | null;
  affectedOperations: unknown;
  changedFields: unknown;
  isDraft: boolean;
  validationState: CollabArtifactValidation;
  validation: unknown;
  invalidReason: string | null;
  createdAt: number;
}

export interface CollabChangeConsumer {
  consumerTaskId: string;
  round: number;
  expectedVersion: number | null;
  retestAttemptId: string | null;
  ackStatus: "waiting" | "passed" | "failed" | "transferred" | "released";
  evidence: unknown;
  updatedAt: number;
}

export interface CollabChangeRequest {
  id: string;
  requirementId: string;
  code: string;
  producerTaskId: string | null;
  reporterTaskId: string;
  dedupeKey: string;
  category: string;
  state: CollabChangeState;
  round: number;
  revision: number;
  roundBudget: number;
  payload: Record<string, unknown>;
  currentRepairTaskId: string | null;
  candidateArtifactVersionId: string | null;
  mergedInto: string | null;
  resolution: unknown;
  createdAt: number;
  updatedAt: number;
  consumers: CollabChangeConsumer[];
}

export interface CollabDecisionOption {
  id: string;
  label: string;
}

export interface CollabDecision {
  id: string;
  requirementId: string;
  kind: string;
  dedupeKey: string;
  title: string;
  taskIds: string[];
  blockedOps: string[];
  evidence: Record<string, unknown>;
  options: CollabDecisionOption[] | unknown;
  state: "open" | "resolved" | "cancelled";
  resolution: unknown;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface CollabMessage {
  id: string;
  requirementId: string;
  type: string;
  sourceTaskId: string | null;
  targetTaskId: string | null;
  correlationId: string | null;
  causationId: string | null;
  aggregateSequence: number | null;
  planRevision: number | null;
  changeRevision: number | null;
  round: number | null;
  artifactRefs: unknown;
  checkpointId: string | null;
  action: string | null;
  body: Record<string, unknown>;
  createdAt: number;
  deliveries: { targetKind: string; targetId: string; state: string; attempts: number; lastError: string | null }[];
}

export interface CollabDeliverables {
  artifacts: CollabArtifactVersion[];
  changes: CollabChangeRequest[];
  requirements: Record<string, { title: string; businessStatus: CollabBusinessStatus; controlStatus: CollabControlStatus; stage: string }>;
  tasks: Record<string, { title: string; repositoryId: number | null }>;
}

export interface CollabInboxEntry {
  requirementId: string;
  requirementTitle: string;
  message: CollabMessage;
  read: boolean;
  outboxState: "pending" | "done" | "dead" | null;
  outboxAttempts: number;
  outboxError: string | null;
}

export interface CollabOutboxItem {
  id: number;
  requirementId: string;
  requirementTitle: string;
  channel: string;
  eventId: string | null;
  message: CollabMessage | null;
  event: unknown;
  attempts: number;
}

export interface CollabAcceptanceManifest {
  id: string;
  requirementId: string;
  revision: number;
  manifest: Record<string, unknown>;
  contentHash: string;
  state: "current" | "stale" | "accepted" | "rejected";
  policy: string;
  conclusion: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface CollabVerificationRun {
  id: string;
  requirementId: string;
  taskId: string;
  attemptId: string | null;
  repositoryId: number | null;
  kind: "command" | "health" | "contract";
  command: string;
  cwd: string;
  exitCode: number | null;
  passed: boolean;
  headCommit: string | null;
  dirty: boolean;
  outputTail: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface CollabRuntimeResource {
  id: string;
  kind: string;
  name: string;
  ownerRequirementId: string;
  ownerTaskId: string | null;
  startAttemptId: string | null;
  stopMethod: string;
  endpoint: string | null;
  port: number | null;
  pid: number | null;
  state: "running" | "stop_requested" | "stopped";
  activeConsumers: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CollabResource {
  id: string;
  ownerProjectId: string | null;
  ownerAgentId: string | null;
  kind: string;
  title: string;
  maintainer: string;
  visibility: CollabResourceVisibility;
  spaceId: string | null;
  repositoryId: number | null;
  location: string;
  status: "active" | "revoked" | "archived";
  authVersion: number;
  latestVersion: number;
  grants: unknown[];
  createdAt: number;
  updatedAt: number;
}

export interface CollabResourceVersion {
  id: string;
  resourceId: string;
  version: number;
  content: string;
  contentHash: string;
  sourceRef: unknown;
  publisher: string;
  note: string;
  publishedAt: number;
}

export interface CollabResourceVersionSummary {
  version: number;
  contentHash: string;
  publisher: string;
  note: string;
  publishedAt: number;
}

export interface CollabResourceGrant {
  id: string;
  granteeKind: "project" | "agent" | "task" | "space";
  granteeId: string;
  authVersion: number;
  revokedAt: number | null;
  createdAt: number;
}

export interface CollabResourceSuggestion {
  id: string;
  fromProjectId: string | null;
  fromTaskId: string | null;
  body: string;
  state: "open" | "accepted" | "rejected";
  createdAt: number;
}

export interface CollabSubscriptionUpdate {
  resourceId: string;
  title: string;
  trackedVersion: number;
  latestVersion: number;
  hasUpdate: boolean;
}

export interface CollabSpace {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  members: { projectId: string; role: string }[];
}

export interface CollabSearchHit {
  resourceId: string;
  title: string;
  kind: string;
  version: number;
  contentHash: string;
  sourceProjectId: string | null;
  maintainer: string;
  snippet: string;
  score: number;
  authVersion: number;
}

export interface CollabRequirementSnapshot {
  requirement: CollabRequirement;
  projects: { projectId: string; responsibility: string }[];
  sessions: { sessionId: string; relation: string; createdAt: number }[];
  revisions: { revision: number; kind: string; input: string; state: string; createdAt: number }[];
  plans: Record<string, unknown>[];
  impacts: Record<string, unknown>[];
  tasks: CollabTask[];
  dependencies: CollabDependency[];
  attempts: CollabAttempt[];
  checkpoints: CollabCheckpoint[];
  artifacts: CollabArtifactVersion[];
  artifactConsumers: { taskId: string; artifactVersionId: string; operations: unknown; verification: string; impact: string; updatedAt: number }[];
  verificationRuns: CollabVerificationRun[];
  changes: CollabChangeRequest[];
  decisions: CollabDecision[];
  messages: CollabMessage[];
  acceptance: CollabAcceptanceManifest | null;
  runtimeResources: CollabRuntimeResource[];
  resources: Record<string, unknown>[];
  usage: Record<string, unknown>;
  explanation: CollabTaskExplanation[];
  counts: CollabRequirementCounts;
  eventCursor: number;
}

export interface CollabSessionRequirement {
  relation: "origin" | "execution" | "legacy";
  requirement: CollabRequirement;
  counts: CollabRequirementCounts;
  attempt: { attemptId: string; taskId: string; taskTitle: string; taskKey: string; state: CollabAttemptState } | null;
}

// ── 执行桥 ──

export interface CollabClaimedTask {
  attempt: CollabAttempt;
  task: CollabTask;
  requirementId: string;
  requirementTitle: string;
  repository: { id: number; name: string; path: string; roleTags: string[] } | null;
  sessionName: string;
  prompt: string;
  spawn: CollabSpawnConfig;
  manifest: CollabEffectiveConfigManifest;
  context: unknown;
}

export interface CollabClaimOutcome {
  claimed: CollabClaimedTask | null;
  skipped: unknown[];
  globalActive: number;
  globalLimit: number;
}

export interface CollabLaunchCheck {
  proceed: boolean;
  reason: string | null;
  attempt: CollabAttempt;
}

export interface CollabHeartbeatAck {
  state: CollabAttemptState;
  stopRequested: boolean;
  stopReason: string | null;
  leaseExpiry: number;
}

export type CollabFinishOutcome = "completed" | "error" | "stopped" | "session_lost";

export interface CollabDispatchResult {
  requestId: string;
  mode: CollabDispatchMode;
  agentId: string;
  requirementId: string | null;
  state: string;
  message: string;
  discussion: unknown;
  replayed: boolean;
}

export interface CollabImportReport {
  total: number;
  imported: string[];
  skipped: string[];
  needsTarget: string[];
  boundRunningSessions: string[];
  backupKey: string;
}
