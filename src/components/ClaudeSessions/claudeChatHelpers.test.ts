import { describe, expect, test } from "bun:test";
import type { ClaudeSession, GitStatusResponse, TaskItem } from "../../types";
import {
  buildAiCommitSummary,
  buildTaskExecutionPrompt,
  extractEmployeeNameFromBracketPreview,
  extractOmcCommandFromUserPrompt,
  formatShortQuestionTime,
  formatTaskRoleLabel,
  formatWorktreePathRelative,
  getLatestDispatchedTeamName,
  getLatestUserPlainText,
  getSessionPreview,
  normalizeSplitTaskListFlowStatus,
  resolveCenterViewAfterSlotChange,
  sameLogicalClaudeSession,
  sessionRepoPathKey,
  splitTaskListBinaryLabel,
  truncateSingleLine,
} from "./claudeChatHelpers";

function sess(id: string, repoPath: string, claudeSessionId: string | null = null): ClaudeSession {
  return {
    id,
    claudeSessionId,
    repositoryPath: repoPath,
    repositoryName: "repo",
    model: "sonnet",
    status: "idle",
    messages: [{ role: "user", content: "x", timestamp: 1 }],
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("claudeChatHelpers", () => {
  test("normalizes repo path and worktree labels", () => {
    expect(sessionRepoPathKey("C:\\repo/")).toBe("C:/repo");
    expect(formatWorktreePathRelative("/repo", "/repo/a/b")).toBe("a/b");
  });

  test("formats role labels and task prompt", () => {
    const task: TaskItem = {
      id: "t1",
      title: "任务",
      description: "说明",
      role: "frontend",
      size: "M",
      estimateDays: 2,
      dod: ["验收"],
    } as unknown as TaskItem;
    expect(formatTaskRoleLabel(task.role)).toBe("前端");
    expect(buildTaskExecutionPrompt(task)).toContain("任务ID：t1");
  });

  test("normalizes split status labels", () => {
    expect(normalizeSplitTaskListFlowStatus(undefined)).toBeUndefined();
    expect(normalizeSplitTaskListFlowStatus("done")).toBe("done");
    expect(normalizeSplitTaskListFlowStatus("todo" as never)).toBe("todo");
    expect(splitTaskListBinaryLabel("done")).toBe("已完成");
  });

  test("detects same logical claude session aliases", () => {
    expect(sameLogicalClaudeSession(sess("a", "/r", "disk-a"), sess("b", "/r", "disk-a"))).toBe(true);
    expect(sameLogicalClaudeSession(sess("a", "/r", "disk-a"), sess("c", "/r", "disk-c"))).toBe(false);
  });

  test("extracts session owner hints and prompt text", () => {
    const session = sess("a", "/r");
    session.messages = [
      { role: "user", content: "old", timestamp: 1 },
      {
        role: "user",
        content: "",
        timestamp: 2,
        parts: [{ type: "text", text: "/autopilot run task" }],
      },
      {
        role: "system",
        content: "任务分发记录\n类型：团队流程\n- 目标：QA Team",
        timestamp: 3,
      },
    ];

    expect(extractEmployeeNameFromBracketPreview("[repo/员工:Alice] hello")).toBe("Alice");
    expect(getLatestUserPlainText(session)).toBe("/autopilot run task");
    expect(extractOmcCommandFromUserPrompt(session)).toBe("/autopilot");
    expect(getLatestDispatchedTeamName(session)).toBe("QA Team");
  });

  test("builds previews and commit summaries", () => {
    const session = sess("a", "/r");
    session.repositoryName = "repo";
    session.messages = [{ role: "user", content: "[repo] Implement a very long feature title for preview", timestamp: 1 }];
    session.diskPreview = "[repo] disk fallback";

    const status: GitStatusResponse = {
      branch: "main",
      additions: 3,
      deletions: 1,
      ahead: 0,
      behind: 0,
      upstream: null,
      staged: [{ path: "a.ts", status: "modified", additions: 3, deletions: 1 }],
      unstaged: [],
    };

    expect(getSessionPreview(session)).toBe("Implement a very long feature title for pr...");
    expect(truncateSingleLine(" a\n b ", 10)).toBe("a b");
    expect(truncateSingleLine("line1\nline2\nline3 more text", 20)).toBe("line1 line2 line3 mo...");
    expect(buildAiCommitSummary(status)).toBe("feat: 更新 a.ts 相关变更");
    expect(formatShortQuestionTime(1)).toBeTruthy();
  });

  test("resolveCenterViewAfterSlotChange keeps pending files until editor mounts", () => {
    // 打开文件：先 request files，editor 尚未挂上 → 不得打回 messages。
    const pendingOpen = resolveCenterViewAfterSlotChange({
      centerView: "files",
      hasFiles: false,
      hasTerminal: false,
      userChosen: false,
      pending: "files",
    });
    expect(pendingOpen).toEqual({ centerView: "files", pending: "files" });

    // editor 挂上后清 pending。
    const mounted = resolveCenterViewAfterSlotChange({
      centerView: "files",
      hasFiles: true,
      hasTerminal: false,
      userChosen: false,
      pending: "files",
    });
    expect(mounted).toEqual({ centerView: "files", pending: null });
  });

  test("resolveCenterViewAfterSlotChange falls back when files close without pending", () => {
    expect(
      resolveCenterViewAfterSlotChange({
        centerView: "files",
        hasFiles: false,
        hasTerminal: false,
        userChosen: true,
        pending: null,
      }),
    ).toEqual({ centerView: "messages", pending: null });

    expect(
      resolveCenterViewAfterSlotChange({
        centerView: "files",
        hasFiles: false,
        hasTerminal: true,
        userChosen: true,
        pending: null,
      }),
    ).toEqual({ centerView: "terminal", pending: null });
  });

  test("resolveCenterViewAfterSlotChange does not yank user off messages when files already open", () => {
    expect(
      resolveCenterViewAfterSlotChange({
        centerView: "messages",
        hasFiles: true,
        hasTerminal: false,
        userChosen: true,
        pending: null,
      }),
    ).toEqual({ centerView: "messages", pending: null });
  });

  test("resolveCenterViewAfterSlotChange cold-starts to files when no user choice", () => {
    expect(
      resolveCenterViewAfterSlotChange({
        centerView: "messages",
        hasFiles: true,
        hasTerminal: false,
        userChosen: false,
        pending: null,
      }),
    ).toEqual({ centerView: "files", pending: null });
  });
});
