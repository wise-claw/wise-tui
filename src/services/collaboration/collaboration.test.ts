import { describe, expect, test } from "bun:test";
import type {
  CollabAgentBinding,
  CollabArtifactVersion,
  CollabRequirementSummary,
  CollabSpawnConfig,
  CollabTask,
} from "../../types/collaboration";
import type { CollabSessionRequirement } from "../../types/collaboration";
import { parseCollabDiscussionPayload } from "./composerDispatch";
import { DEFAULT_COLLAB_COMPOSER_SELECTION, decideCollabComposerIntent } from "./composerIntent";
import { collabErrorLabel, formatCollabError, normalizeCollabError } from "./errors";
import {
  collabSpawnNeedsMcpMaterialize,
  collabSpawnToCliExtras,
  decideCollabSessionOutcome,
  isCollabAttemptRevoked,
  observeCollabSession,
  shouldClaimCollabTask,
} from "./executionBridge";
import { requirementStatusLabel, stageLabel, taskStateLabel } from "./labels";
import {
  formatCollabMention,
  parseCollabRecipient,
  suggestCollabRecipients,
  type CollabRecipientAgent,
  type CollabRecipientRepository,
} from "./recipients";
import {
  groupTasksByRepository,
  latestArtifactVersions,
  messageSummary,
  requirementProgress,
  sortRequirementSummaries,
} from "./selectors";

function binding(agentId: string, repositoryId: number, extra: Partial<CollabAgentBinding> = {}): CollabAgentBinding {
  return {
    id: `b-${agentId}-${repositoryId}`,
    agentId,
    projectId: "p1",
    repositoryId,
    responsibility: "",
    roleTags: [],
    accessScope: "read_write",
    override: { agentsMd: null, knowledgeRefs: [], skillsEnable: [], skillsDisable: [], mcpsEnable: [], mcpsDisable: [] },
    isDefault: false,
    status: "active",
    authVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function task(id: string, repositoryId: number | null, state: CollabTask["state"], extra: Partial<CollabTask> = {}): CollabTask {
  return {
    id,
    requirementId: "r1",
    planRevision: 1,
    taskKey: id,
    title: id,
    projectId: "p1",
    repositoryId,
    role: "",
    kind: "implement",
    state,
    active: true,
    revision: 1,
    specRevision: 1,
    spec: {},
    specHash: "",
    executorAgentId: null,
    profileRevision: null,
    delegatedByTaskId: null,
    delegationDepth: 0,
    runtimeTarget: "",
    checkpointId: null,
    generation: 1,
    failureCount: 0,
    attemptBudget: 3,
    nextAction: "",
    changeRequestId: null,
    repairRound: null,
    result: null,
    priority: 0,
    queuedAt: 0,
    supersededBy: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

describe("normalizeCollabError", () => {
  test("keeps structured Rust errors", () => {
    const e = normalizeCollabError({
      code: "REVISION_CONFLICT",
      message: "需求已被修改",
      retryable: true,
      currentRevision: 4,
      affectedTaskIds: ["t1", 3],
    });
    expect(e.code).toBe("REVISION_CONFLICT");
    expect(e.retryable).toBe(true);
    expect(e.currentRevision).toBe(4);
    expect(e.affectedTaskIds).toEqual(["t1"]);
  });

  test("parses bracketed and plain strings", () => {
    expect(normalizeCollabError("[STALE_ATTEMPT] 租约过期").code).toBe("STALE_ATTEMPT");
    expect(normalizeCollabError(new Error("boom"))).toMatchObject({ code: "UNKNOWN", message: "boom" });
    expect(formatCollabError({ code: "AGENT_DISABLED", message: "后端智能体已停用" })).toBe(
      "智能体未启用：后端智能体已停用",
    );
    expect(collabErrorLabel("WHATEVER")).toBe("操作失败");
  });
});

describe("labels", () => {
  test("control status wins over business status", () => {
    expect(requirementStatusLabel({ businessStatus: "open", controlStatus: "paused", stage: "executing" }).label).toBe(
      "已暂停",
    );
    expect(requirementStatusLabel({ businessStatus: "verifying", controlStatus: "active", stage: "verifying" }).label).toBe(
      "待验收",
    );
    expect(requirementStatusLabel({ businessStatus: "open", controlStatus: "active", stage: "repairing" }).label).toBe(
      "修复联调",
    );
  });

  test("unknown values fall back to raw text", () => {
    expect(taskStateLabel("mystery").label).toBe("mystery");
    expect(stageLabel("planning")).toBe("规划中");
  });
});

describe("selectors", () => {
  test("groups live tasks by repository with planning first", () => {
    const groups = groupTasksByRepository([
      task("api", 2, "running"),
      task("plan", null, "succeeded", { kind: "plan" }),
      task("web", 1, "waiting_change"),
      task("old", 1, "succeeded", { supersededBy: "web" }),
      task("web2", 1, "succeeded"),
    ]);
    expect(groups.map((g) => g.repositoryId)).toEqual([null, 1, 2]);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["web", "web2"]);
    expect(groups[1]).toMatchObject({ succeeded: 1, blocked: 1 });
    expect(groups[2].running).toBe(1);
  });

  test("progress counts succeeded and cancelled", () => {
    expect(requirementProgress({ tasks: 4, byState: { succeeded: 2, cancelled: 1, running: 1 } })).toBe(75);
    expect(requirementProgress({ tasks: 0, byState: {} })).toBe(0);
  });

  test("latest artifact version per artifact", () => {
    const v = (artifactId: string, name: string, version: number) =>
      ({ id: `${artifactId}-${version}`, artifactId, name, version }) as CollabArtifactVersion;
    const out = latestArtifactVersions([v("a", "orders-api", 1), v("b", "auth", 1), v("a", "orders-api", 2)]);
    expect(out.map((x) => x.id)).toEqual(["b-1", "a-2"]);
  });

  test("requirements needing attention sort first", () => {
    const r = (id: string, extra: Partial<CollabRequirementSummary>) =>
      ({
        id,
        businessStatus: "open",
        controlStatus: "active",
        updatedAt: 0,
        counts: { tasks: 1, byState: {}, openDecisions: 0, openChanges: 0, activeAttempts: 0, repositories: 1 },
        ...extra,
      }) as CollabRequirementSummary;
    const sorted = sortRequirementSummaries([
      r("done", { businessStatus: "done", updatedAt: 9 }),
      r("running", { updatedAt: 5 }),
      r("decide", {
        counts: { tasks: 1, byState: {}, openDecisions: 1, openChanges: 0, activeAttempts: 0, repositories: 1 },
      }),
      r("paused", { controlStatus: "paused", updatedAt: 7 }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["decide", "running", "paused", "done"]);
  });

  test("message summary reads only string fields", () => {
    expect(messageSummary({ type: "task.failed", body: { reason: "  编译失败 " } })).toBe("编译失败");
    expect(messageSummary({ type: "artifact.ready", body: { name: { nested: true } } })).toBe("产物可用");
  });
});

describe("execution bridge decisions", () => {
  const spawn: CollabSpawnConfig = {
    engineId: "claude",
    model: null,
    appendSystemPrompt: "  # 智能体\n规则 ",
    mcpServerKeys: [],
    mcpExtraConfigPaths: [],
    strictMcpConfig: true,
    settingSources: "project",
    allowedTools: "Read, Bash(/x/wise-collab:*)",
    disallowedTools: "",
    addDirs: [" /repo/api ", ""],
    readOnly: false,
  };

  test("maps spawn config to CLI extras", () => {
    expect(collabSpawnToCliExtras(spawn, " /tmp/mcp.json ")).toEqual({
      addDirs: ["/repo/api"],
      allowedTools: "Read, Bash(/x/wise-collab:*)",
      appendSystemPrompt: "# 智能体\n规则",
      mcpConfigPath: "/tmp/mcp.json",
      strictMcpConfig: true,
      settingSources: "project",
    });
    expect(collabSpawnNeedsMcpMaterialize(spawn)).toBe(false);
    expect(collabSpawnNeedsMcpMaterialize({ ...spawn, mcpServerKeys: ["github"] })).toBe(true);
  });

  test("session status transitions decide the attempt outcome", () => {
    expect(decideCollabSessionOutcome("running", true)).toBeNull();
    expect(decideCollabSessionOutcome("idle", false)).toBeNull();
    expect(decideCollabSessionOutcome("idle", true)).toBe("completed");
    expect(decideCollabSessionOutcome("error", false)).toBe("error");
    expect(decideCollabSessionOutcome("cancelled", true)).toBe("stopped");
    expect(decideCollabSessionOutcome(undefined, true)).toBe("session_lost");
  });

  test("observation and claim gate", () => {
    expect(observeCollabSession("connecting")).toBe("running");
    expect(observeCollabSession("error")).toBe("idle");
    expect(observeCollabSession(null)).toBe("missing");
    expect(shouldClaimCollabTask({ enabled: true, inFlight: false, activeLocal: 1, globalLimit: 2 })).toBe(true);
    expect(shouldClaimCollabTask({ enabled: true, inFlight: true, activeLocal: 0, globalLimit: 2 })).toBe(false);
    expect(shouldClaimCollabTask({ enabled: true, inFlight: false, activeLocal: 2, globalLimit: 2 })).toBe(false);
    expect(isCollabAttemptRevoked("STALE_ATTEMPT")).toBe(true);
    expect(isCollabAttemptRevoked("STORAGE_ERROR")).toBe(false);
  });
});

describe("composer intent", () => {
  const agents: CollabRecipientAgent[] = [
    { id: "a1", name: "订单研发", status: "enabled", bindings: [] },
    { id: "a2", name: "停用助手", status: "disabled", bindings: [] },
    { id: "d1", name: "同名", status: "enabled", bindings: [] },
    { id: "d2", name: "同名", status: "enabled", bindings: [] },
  ];
  const sel = (patch: Partial<typeof DEFAULT_COLLAB_COMPOSER_SELECTION> = {}) => ({
    ...DEFAULT_COLLAB_COMPOSER_SELECTION,
    ...patch,
  });
  const sreq = (id: string, extra: Partial<CollabSessionRequirement["requirement"]> = {}, relation = "origin") =>
    ({
      relation,
      requirement: { id, title: id, ownerAgentId: "a1", controlStatus: "active", businessStatus: "open", ...extra },
      counts: { tasks: 0, byState: {}, openDecisions: 0, openChanges: 0, activeAttempts: 0, repositories: 0 },
      attempt: null,
    }) as unknown as CollabSessionRequirement;

  test("plain chat without recipient keeps the original send path", () => {
    expect(decideCollabComposerIntent({ text: "你好", selection: sel(), agents, sessionRequirements: [] })).toEqual({
      kind: "none",
    });
    expect(
      decideCollabComposerIntent({ text: "@web 改按钮", selection: sel(), agents, sessionRequirements: [] }).kind,
    ).toBe("none");
  });

  test("@agent mention dispatches with stable id and strips the mention", () => {
    const d = decideCollabComposerIntent({ text: "@订单研发 实现优惠展示", selection: sel(), agents, sessionRequirements: [] });
    expect(d).toEqual({
      kind: "dispatch",
      agentId: "a1",
      mode: "execute",
      body: "实现优惠展示",
      requirementId: null,
      fromMention: true,
    });
  });

  test("duplicate names are ambiguous; disabled agents only discuss", () => {
    expect(decideCollabComposerIntent({ text: "@同名 做事", selection: sel(), agents, sessionRequirements: [] }).kind).toBe(
      "error",
    );
    expect(
      decideCollabComposerIntent({ text: "问题", selection: sel({ agentId: "a2" }), agents, sessionRequirements: [] }).kind,
    ).toBe("error");
    const discuss = decideCollabComposerIntent({
      text: "@停用助手 这个接口怎么用",
      selection: sel({ mode: "discuss" }),
      agents,
      sessionRequirements: [sreq("r1")],
    });
    expect(discuss).toMatchObject({ kind: "dispatch", agentId: "a2", mode: "discuss", requirementId: null });
  });

  test("auto target continues the single live requirement and asks when ambiguous", () => {
    const one = decideCollabComposerIntent({
      text: "补上移动端",
      selection: sel({ agentId: "a1" }),
      agents,
      sessionRequirements: [sreq("r1"), sreq("r-done", { businessStatus: "done" }), sreq("r-exec", {}, "execution")],
    });
    expect(one).toMatchObject({ kind: "dispatch", requirementId: "r1", fromMention: false });
    const two = decideCollabComposerIntent({
      text: "修一下",
      selection: sel({ agentId: "a1" }),
      agents,
      sessionRequirements: [sreq("r1"), sreq("r2")],
    });
    expect(two.kind).toBe("error");
    const fresh = decideCollabComposerIntent({
      text: "另一个需求",
      selection: sel({ agentId: "a1", target: { kind: "new" } }),
      agents,
      sessionRequirements: [sreq("r1"), sreq("r2")],
    });
    expect(fresh).toMatchObject({ kind: "dispatch", requirementId: null });
    const cancelled = decideCollabComposerIntent({
      text: "继续",
      selection: sel({ agentId: "a1", target: { kind: "continue", requirementId: "rc" } }),
      agents,
      sessionRequirements: [sreq("rc", { controlStatus: "cancelled" })],
    });
    expect(cancelled.kind).toBe("error");
  });

  test("discussion payload is validated", () => {
    expect(parseCollabDiscussionPayload(null)).toBeNull();
    expect(parseCollabDiscussionPayload({ repositoryPath: "/r", prompt: "p", spawn: {} })).toBeNull();
    const ok = parseCollabDiscussionPayload({
      repositoryPath: " /r ",
      prompt: "p",
      spawn: { addDirs: [], mcpServerKeys: [] },
      manifest: null,
    });
    expect(ok?.repositoryPath).toBe("/r");
  });
});

describe("recipients", () => {
  const agents: CollabRecipientAgent[] = [
    { id: "a-web", name: "前端助手", status: "enabled", bindings: [binding("a-web", 1, { roleTags: ["frontend"], isDefault: true })] },
    { id: "a-api", name: "后端 助手", status: "enabled", bindings: [binding("a-api", 2, { roleTags: ["backend"] })] },
    { id: "a-api2", name: "接口审查", status: "enabled", bindings: [binding("a-api2", 2, { roleTags: ["backend"] })] },
    { id: "a-off", name: "停用", status: "disabled", bindings: [binding("a-off", 1)] },
  ];
  const repos: CollabRecipientRepository[] = [
    { id: 1, name: "web", roleTags: ["frontend"] },
    { id: 2, name: "api", roleTags: [] },
  ];

  test("resolves agent names including quoted names", () => {
    const p = parseCollabRecipient('@"后端 助手"  给订单加字段', agents, repos);
    expect(p).toMatchObject({ token: "后端 助手", body: "给订单加字段", resolvedAgentId: "a-api", ambiguous: false });
  });

  test("repository mention prefers default binding", () => {
    expect(parseCollabRecipient("@web 改按钮", agents, repos).resolvedAgentId).toBe("a-web");
  });

  test("repository without default is ambiguous; role too", () => {
    const repo = parseCollabRecipient("@api 修接口", agents, repos);
    expect(repo.ambiguous).toBe(true);
    expect(repo.candidates.map((c) => c.agentId).sort()).toEqual(["a-api", "a-api2"]);
    const role = parseCollabRecipient("@backend 查日志", agents, repos);
    expect(role.candidates.every((c) => c.matchKind === "role")).toBe(true);
    expect(role.ambiguous).toBe(true);
  });

  test("disabled agents and plain text are not recipients", () => {
    expect(parseCollabRecipient("@停用 做事", agents, repos).candidates).toEqual([]);
    expect(parseCollabRecipient("普通消息", agents, repos)).toMatchObject({ token: null, body: "普通消息" });
  });

  test("suggestions and mention formatting", () => {
    expect(suggestCollabRecipients("", agents, repos).map((s) => s.label)).toContain("web");
    expect(suggestCollabRecipients("back", agents, repos)).toEqual([{ label: "backend", kind: "role" }]);
    expect(formatCollabMention("后端 助手")).toBe('@"后端 助手" ');
    expect(formatCollabMention("web")).toBe("@web ");
  });
});
