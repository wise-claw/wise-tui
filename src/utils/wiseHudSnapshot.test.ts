import { describe, expect, it } from "vitest";
import type { ClaudeSession } from "../types";
import {
  appendHudAttachmentMentions,
  buildWiseHudSessionSnapshot,
  countHudRunningSessions,
  formatHudModelLabel,
  hudComposerSessionToClaudeSession,
  parseWiseHudActiveChanged,
  parseWiseHudSelectRepositoryPayload,
  parseWiseHudSessionSnapshot,
  parseWiseHudSetEnginePayload,
  parseWiseHudSetModelPayload,
  parseWiseHudSetDetailsOpenPayload,
  parseWiseHudSubmitPayload,
  isWiseHudForwardEvent,
  resolveHudAssistantPreview,
  resolveHudRunStatus,
  resolveHudSubmitSessionId,
} from "./wiseHudSnapshot";

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "sess-1",
    claudeSessionId: "claude-1",
    repositoryPath: "/tmp/demo",
    repositoryName: "demo",
    model: "claude-sonnet-4-6",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

describe("buildWiseHudSessionSnapshot", () => {
  it("empty session asks the user to expand", () => {
    const snap = buildWiseHudSessionSnapshot(null);
    expect(snap.canSend).toBe(false);
    expect(snap.statusText).toContain("暂无会话");
    expect(snap.modelLabel).toBe("Wise");
    expect(snap.composerSession).toBeNull();
    expect(snap.repositories).toEqual([]);
    expect(snap.runningCount).toBe(0);
    expect(snap.runStatus).toBe("idle");
    expect(snap.messages).toEqual([]);
  });

  it("includes slim composer session and repositories", () => {
    const snap = buildWiseHudSessionSnapshot(session({ model: "gpt-5.4" }), "codex-rpc", {
      repositories: [{ id: 9, name: "demo", path: "/tmp/demo" }],
      activeRepositoryId: 9,
    });
    expect(snap.engine).toBe("codex-rpc");
    expect(snap.activeRepositoryId).toBe(9);
    expect(snap.composerSession).toMatchObject({
      id: "sess-1",
      repositoryPath: "/tmp/demo",
      model: "gpt-5.4",
    });
    expect(snap.repositories).toEqual([{ id: 9, name: "demo", path: "/tmp/demo" }]);
  });

  it("does not treat the Wise tab id as a Claude session id", () => {
    const snap = buildWiseHudSessionSnapshot(session());
    expect(hudComposerSessionToClaudeSession(snap)?.claudeSessionId).toBeNull();
  });

  it("marks connecting/running as busy and cancellable", () => {
    const snap = buildWiseHudSessionSnapshot(session({ status: "running" }));
    expect(snap.busy).toBe(true);
    expect(snap.canCancel).toBe(true);
    expect(snap.canSend).toBe(true);
    expect(snap.statusText).toBe("正在回复…");
  });

  it("prefers thread name as title", () => {
    const snap = buildWiseHudSessionSnapshot(
      session({ threadName: "修 HUD", repositoryName: "wise-tui" }),
    );
    expect(snap.sessionTitle).toBe("修 HUD");
  });

  it("carries running count and completed status from extras", () => {
    const idle = buildWiseHudSessionSnapshot(session(), "claude", {
      runningCount: 0,
      runStatus: "completed",
    });
    expect(idle.runningCount).toBe(0);
    expect(idle.runStatus).toBe("completed");
    const running = buildWiseHudSessionSnapshot(null, "claude", {
      runningCount: 3,
    });
    expect(running.runningCount).toBe(3);
    expect(running.runStatus).toBe("running");
  });

  it("includes messages only when asked", () => {
    const withMessages = buildWiseHudSessionSnapshot(
      session({
        messages: [{ id: 1, role: "user", content: "hi", parts: [], timestamp: 1 }],
      }),
      "claude",
      { includeMessages: true },
    );
    expect(withMessages.messages).toEqual([
      { id: 1, role: "user", content: "hi", parts: [], timestamp: 1 },
    ]);
    expect(hudComposerSessionToClaudeSession(withMessages)?.messages).toHaveLength(1);
    expect(buildWiseHudSessionSnapshot(session({
      messages: [{ id: 1, role: "user", content: "hi", parts: [], timestamp: 1 }],
    })).messages).toEqual([]);
  });
});

describe("countHudRunningSessions / resolveHudRunStatus", () => {
  it("counts connecting and running sessions", () => {
    expect(
      countHudRunningSessions([
        { status: "idle" },
        { status: "connecting" },
        { status: "running" },
        { status: "completed" },
        { status: "error" },
      ]),
    ).toBe(2);
  });

  it("shows completed only after at least one run has finished", () => {
    expect(resolveHudRunStatus(2, false)).toBe("running");
    expect(resolveHudRunStatus(0, false)).toBe("idle");
    expect(resolveHudRunStatus(0, true)).toBe("completed");
  });
});

describe("formatHudModelLabel", () => {
  it("joins model and Claude effort", () => {
    expect(
      formatHudModelLabel(
        { model: "claude-sonnet-4-6", claudeReasoningEffort: "medium", codexReasoningEffort: undefined },
        "claude",
      ),
    ).toBe("Sonnet · 中");
  });

  it("joins Codex effort for RPC engine", () => {
    expect(
      formatHudModelLabel(
        { model: "gpt-5.4", claudeReasoningEffort: undefined, codexReasoningEffort: "high" },
        "codex-rpc",
      ),
    ).toContain("高");
  });
});

describe("resolveHudAssistantPreview", () => {
  it("returns the latest renderable assistant text", () => {
    const text = resolveHudAssistantPreview([
      { id: 1, role: "user", content: "hi", parts: [], timestamp: 1 },
      { id: 2, role: "assistant", content: "先看这边", parts: [], timestamp: 2 },
      { id: 3, role: "assistant", content: "最终答复", parts: [], timestamp: 3 },
    ]);
    expect(text).toBe("最终答复");
  });

  it("truncates long previews", () => {
    const long = "字".repeat(400);
    const text = resolveHudAssistantPreview(
      [{ id: 1, role: "assistant", content: long, parts: [], timestamp: 1 }],
      20,
    );
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBe(20);
  });
});

describe("parseWiseHud payloads", () => {
  it("accepts trimmed submit text", () => {
    expect(parseWiseHudSubmitPayload({ text: "  你好  " })).toEqual({ text: "你好" });
    expect(parseWiseHudSubmitPayload({ text: "   " })).toBeNull();
    expect(parseWiseHudSubmitPayload(null)).toBeNull();
  });

  it("keeps sessionId on submit payload", () => {
    expect(parseWiseHudSubmitPayload({ text: "跑一下", sessionId: " sess-9 " })).toEqual({
      text: "跑一下",
      sessionId: "sess-9",
    });
    expect(parseWiseHudSubmitPayload(JSON.stringify({ text: "hi", sessionId: "s1" }))).toEqual({
      text: "hi",
      sessionId: "s1",
    });
  });

  it("resolves HUD submit session against live tabs", () => {
    expect(resolveHudSubmitSessionId("sess-2", "sess-1", ["sess-1", "sess-2"])).toBe("sess-2");
    expect(resolveHudSubmitSessionId("gone", "sess-1", ["sess-1"])).toBe("sess-1");
    expect(resolveHudSubmitSessionId(undefined, null, ["sess-1"])).toBeNull();
  });

  it("only forwards HUD control events to main", () => {
    expect(isWiseHudForwardEvent("wise-hud-submit")).toBe(true);
    expect(isWiseHudForwardEvent("wise-hud-new-session")).toBe(true);
    expect(isWiseHudForwardEvent("wise-hud-set-engine")).toBe(true);
    expect(isWiseHudForwardEvent("wise-hud-set-model")).toBe(true);
    expect(isWiseHudForwardEvent("wise-hud-set-details-open")).toBe(true);
    expect(isWiseHudForwardEvent("wise-hud-state")).toBe(false);
    expect(isWiseHudForwardEvent("wise-hud-session-complete")).toBe(false);
  });

  it("parses set-engine and set-model payloads", () => {
    expect(parseWiseHudSetEnginePayload({ engine: "codex-rpc", sessionId: " s1 " })).toEqual({
      engine: "codex-rpc",
      sessionId: "s1",
    });
    expect(parseWiseHudSetEnginePayload({ engine: "claude" })).toEqual({ engine: "claude" });
    expect(parseWiseHudSetEnginePayload({ engine: "nope" })).toBeNull();
    expect(parseWiseHudSetEnginePayload(null)).toBeNull();
    expect(parseWiseHudSetModelPayload({ model: "  gpt-5.4  ", sessionId: "sess-2" })).toEqual({
      model: "gpt-5.4",
      sessionId: "sess-2",
    });
    expect(parseWiseHudSetModelPayload({ model: "   " })).toBeNull();
    expect(parseWiseHudSetModelPayload({ model: 1 })).toBeNull();
    expect(parseWiseHudSetDetailsOpenPayload({ open: true })).toEqual({ open: true });
    expect(parseWiseHudSetDetailsOpenPayload({ open: false })).toEqual({ open: false });
    expect(parseWiseHudSetDetailsOpenPayload({ open: 1 })).toBeNull();
  });

  it("parses snapshot and active flag", () => {
    expect(
      parseWiseHudSessionSnapshot({
        sessionId: "a",
        sessionTitle: "t",
        modelLabel: "Sonnet",
        busy: true,
        canSend: true,
        canCancel: true,
        statusText: "正在回复…",
        lastAssistantText: "ok",
      }),
    ).toMatchObject({
      sessionId: "a",
      busy: true,
      modelLabel: "Sonnet",
      engine: "claude",
      repositories: [],
      activeRepositoryId: null,
      composerSession: null,
      runningCount: 0,
      runStatus: "idle",
      messages: [],
    });
    expect(parseWiseHudActiveChanged({ active: true })).toBe(true);
    expect(parseWiseHudActiveChanged({ active: 1 })).toBeNull();
  });

  it("parses composer session, repositories, and select-repository payload", () => {
    const snap = parseWiseHudSessionSnapshot({
      sessionId: "sess-1",
      sessionTitle: "demo",
      modelLabel: "Sonnet",
      busy: false,
      canSend: true,
      canCancel: false,
      statusText: "demo",
      lastAssistantText: "",
      engine: "codex-rpc",
      activeRepositoryId: 3,
      repositories: [{ id: 3, name: "wise-tui", path: "/tmp/wise-tui" }],
      composerSession: {
        id: "sess-1",
        repositoryPath: "/tmp/wise-tui",
        repositoryName: "wise-tui",
        model: "gpt-5.4",
        status: "idle",
        executionEngine: "codex-rpc",
      },
      runningCount: 2,
      runStatus: "running",
      messages: [{ id: 9, role: "assistant", content: "好的", parts: [], timestamp: 2 }],
    });
    expect(snap).toMatchObject({
      engine: "codex-rpc",
      activeRepositoryId: 3,
      composerSession: { id: "sess-1", repositoryPath: "/tmp/wise-tui" },
      runningCount: 2,
      runStatus: "running",
    });
    expect(snap?.messages).toEqual([
      { id: 9, role: "assistant", content: "好的", parts: [], timestamp: 2 },
    ]);
    expect(snap?.repositories).toEqual([{ id: 3, name: "wise-tui", path: "/tmp/wise-tui" }]);
    expect(parseWiseHudSelectRepositoryPayload({ repositoryId: 3 })).toEqual({ repositoryId: 3 });
    expect(parseWiseHudSelectRepositoryPayload({ repositoryId: "3" })).toBeNull();
  });
});

describe("appendHudAttachmentMentions", () => {
  it("appends @paths to an existing draft", () => {
    expect(appendHudAttachmentMentions("看这个", ["/tmp/a.png", " /tmp/b "])).toBe(
      "看这个 @/tmp/a.png @/tmp/b ",
    );
  });

  it("starts the draft with mentions when empty", () => {
    expect(appendHudAttachmentMentions("  ", ["/tmp/a.ts"])).toBe("@/tmp/a.ts ");
  });
});
