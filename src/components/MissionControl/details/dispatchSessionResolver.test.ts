import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../../../types";
import type { TaskDetailVM } from "../presenter/types";
import {
  buildDispatchSessionNeedles,
  messagesToSearchText,
  resolveDispatchClaudeSession,
  textMatchesDispatchNeedles,
} from "./dispatchSessionResolver";

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: null,
    repositoryPath: "/tmp/wise",
    repositoryName: "Wise",
    model: "",
    status: "completed",
    messages: [],
    createdAt: 100,
    pendingPrompt: "",
    ...overrides,
  };
}

function detail(overrides: Partial<TaskDetailVM> = {}): TaskDetailVM {
  return {
    taskId: "task-1",
    clusterId: "cluster-fe-1",
    title: "Frontend",
    status: "completed",
    statusLabel: "已完成",
    repositoryLabel: "web",
    role: "frontend",
    priority: "P1",
    sourceRequirements: [],
    prdAnchor: null,
    taskAnchor: null,
    codeAnchors: [],
    description: "",
    subtasks: [],
    dod: [],
    isManual: false,
    isEdited: false,
    technical: {
      clusterId: "cluster-fe-1",
      clusterTitle: "Frontend",
      clusterRequirementIds: ["REQ-1"],
      parentTaskLabel: "05-15-parent",
      taskName: null,
      taskPath: null,
      dispatchRaw: null,
      validationIssues: [],
      deletedTaskIds: [],
      isManual: false,
      isEdited: false,
    },
    ...overrides,
  };
}

describe("resolveDispatchClaudeSession", () => {
  test("prefers exact Claude session id", () => {
    const hit = session({ id: "tab-a", claudeSessionId: "sid-1" });
    const fallback = session({ id: "sid-1", claudeSessionId: null });
    const match = resolveDispatchClaudeSession({
      sessions: [hit, fallback],
      detail: detail({
        technical: {
          ...detail().technical,
          dispatchRaw: {
            runId: "run-1",
            runDir: "/tmp/run-1",
            exitCode: 0,
            durationMs: 10,
            stdoutPath: "",
            stderrPath: "",
            rawResultPath: "",
            rawOutput: null,
            stdoutTruncatedPreview: "",
            claudeSessionId: "sid-1",
          },
        } satisfies TaskDetailVM["technical"],
      }),
    });

    expect(match?.session.id).toBe("tab-a");
    expect(match?.reason).toBe("claude-session-id");
  });

  test("does not match old splitter prompt without run identity", () => {
    const oldRun = session({
      id: "tab-old",
      messages: [
        {
          id: 1,
          role: "user",
          content: [
            "Active task: .trellis/tasks/05-15-parent",
            "",
            "You are the `trellis-splitter` sub-agent.",
            "- id: `cluster-fe-1`",
          ].join("\n"),
          parts: [],
          timestamp: 200,
        },
      ],
      createdAt: 200,
    });

    const match = resolveDispatchClaudeSession({
      sessions: [oldRun],
      detail: detail(),
    });

    expect(match).toBeNull();
  });

  test("matches disk-only history rows by run directory preview", () => {
    const oldRun = session({
      id: "sid-on-disk",
      claudeSessionId: "sid-on-disk",
      messages: [],
      diskPreview: "Active task: .trellis/tasks/05-15-parent Run directory: `/Users/me/.wise/prd-runs/split-cluster-fe-1-1`",
    });
    const match = resolveDispatchClaudeSession({
      sessions: [oldRun],
      detail: detail({
        technical: {
          ...detail().technical,
          dispatchRaw: {
            runId: "split-cluster-fe-1-1",
            runDir: "/Users/me/.wise/prd-runs/split-cluster-fe-1-1",
            exitCode: 0,
            durationMs: 10,
            stdoutPath: "",
            stderrPath: "",
            rawResultPath: "",
            rawOutput: null,
            stdoutTruncatedPreview: "",
            claudeSessionId: null,
          },
        } satisfies TaskDetailVM["technical"],
      }),
      repoPath: "/tmp/wise",
    });

    expect(match?.session.id).toBe("sid-on-disk");
    expect(match?.reason).toBe("prompt");
  });

  test("does not fall back to an older prompt match when current run has a different session id", () => {
    const oldRun = session({
      id: "tab-old",
      claudeSessionId: "old-sid",
      messages: [
        {
          id: 1,
          role: "user",
          content: [
            "Active task: .trellis/tasks/05-15-parent",
            "",
            "You are the `trellis-splitter` sub-agent.",
            "- id: `cluster-fe-1`",
          ].join("\n"),
          parts: [],
          timestamp: 200,
        },
      ],
      createdAt: 200,
    });
    const match = resolveDispatchClaudeSession({
      sessions: [oldRun],
      detail: detail({
        technical: {
          ...detail().technical,
          dispatchRaw: {
            runId: "split-cluster-fe-1-new",
            runDir: "/Users/me/.wise/prd-runs/split-cluster-fe-1-new",
            exitCode: 0,
            durationMs: 10,
            stdoutPath: "",
            stderrPath: "",
            rawResultPath: "",
            rawOutput: null,
            stdoutTruncatedPreview: "",
            claudeSessionId: "new-sid",
          },
        } satisfies TaskDetailVM["technical"],
      }),
      repoPath: "/tmp/wise",
    });

    expect(match).toBeNull();
  });

  test("requires run directory for prompt fallback when dispatch raw has one", () => {
    const previousSameCluster = session({
      id: "tab-old",
      messages: [
        {
          id: 1,
          role: "user",
          content: [
            "Active task: .trellis/tasks/05-15-parent",
            "",
            "Run directory: `/Users/me/.wise/prd-runs/split-cluster-fe-1-old`",
            "- id: `cluster-fe-1`",
          ].join("\n"),
          parts: [],
          timestamp: 200,
        },
      ],
      createdAt: 200,
    });
    const currentSameCluster = session({
      id: "tab-new",
      messages: [
        {
          id: 1,
          role: "user",
          content: [
            "Active task: .trellis/tasks/05-15-parent",
            "",
            "Run directory: `/Users/me/.wise/prd-runs/split-cluster-fe-1-new`",
            "- id: `cluster-fe-1`",
          ].join("\n"),
          parts: [],
          timestamp: 300,
        },
      ],
      createdAt: 300,
    });
    const match = resolveDispatchClaudeSession({
      sessions: [previousSameCluster, currentSameCluster],
      detail: detail({
        technical: {
          ...detail().technical,
          dispatchRaw: {
            runId: "split-cluster-fe-1-new",
            runDir: "/Users/me/.wise/prd-runs/split-cluster-fe-1-new",
            exitCode: 0,
            durationMs: 10,
            stdoutPath: "",
            stderrPath: "",
            rawResultPath: "",
            rawOutput: null,
            stdoutTruncatedPreview: "",
            claudeSessionId: null,
          },
        } satisfies TaskDetailVM["technical"],
      }),
      repoPath: "/tmp/wise",
    });

    expect(match?.session.id).toBe("tab-new");
  });

  test("uses dispatch needles to verify loaded disk transcript", () => {
    const d = detail({
      technical: {
        ...detail().technical,
        dispatchRaw: {
          runId: "split-cluster-fe-1-1",
          runDir: "/Users/me/.wise/prd-runs/split-cluster-fe-1-1",
          exitCode: 0,
          durationMs: 10,
          stdoutPath: "",
          stderrPath: "",
          rawResultPath: "",
          rawOutput: null,
          stdoutTruncatedPreview: "",
          claudeSessionId: null,
        },
      } satisfies TaskDetailVM["technical"],
    });
    const needles = buildDispatchSessionNeedles({ detail: d, raw: d.technical.dispatchRaw, repoPath: "/tmp/wise" });
    const transcriptText = messagesToSearchText([
      {
        id: 1,
        role: "user",
        content: "Active task: /tmp/wise/.trellis/tasks/05-15-parent\n\n- id: `cluster-fe-1`",
        parts: [{ type: "text", text: "Active task: /tmp/wise/.trellis/tasks/05-15-parent\n\n- id: `cluster-fe-1`" }],
        timestamp: 100,
      },
    ]);

    expect(textMatchesDispatchNeedles(transcriptText, needles)).toBe(false);
    expect(textMatchesDispatchNeedles(
      `${transcriptText}\nRun directory: \`/Users/me/.wise/prd-runs/split-cluster-fe-1-1\``,
      needles,
    )).toBe(true);
  });
});
