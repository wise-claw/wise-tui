import { describe, expect, test } from "bun:test";
import {
  cockpitConversationTitle,
  cockpitPromptPreview,
  collectGitChangedPaths,
  parseCockpitConversationRecord,
  pickDefaultCockpitAssistant,
} from "./cockpitConversation";

describe("cockpitConversation helpers", () => {
  test("title uses the first non-empty line", () => {
    expect(cockpitConversationTitle("\n  做一份融资路演\n第二行")).toBe("做一份融资路演");
    expect(cockpitConversationTitle("")).toBe("未命名请求");
    expect(cockpitConversationTitle("a".repeat(60)).endsWith("…")).toBe(true);
  });

  test("collects unique git changed paths", () => {
    expect(
      collectGitChangedPaths({
        staged: [{ path: "docs/a.md", status: "M", additions: 1, deletions: 0 }],
        unstaged: [
          { path: "docs/a.md", status: "M", additions: 1, deletions: 0 },
          { path: "slides/deck.pptx", status: "A", additions: 10, deletions: 0 },
        ],
      }),
    ).toEqual(["docs/a.md", "slides/deck.pptx"]);
  });

  test("picks last used assistant when still present", () => {
    expect(pickDefaultCockpitAssistant([{ id: "a" }, { id: "b" }], "b")).toBe("b");
    expect(pickDefaultCockpitAssistant([{ id: "a" }, { id: "b" }], "gone")).toBe("a");
    expect(pickDefaultCockpitAssistant([], "a")).toBeNull();
  });

  test("parses persisted records and drops invalid rows", () => {
    expect(parseCockpitConversationRecord(null)).toBeNull();
    const parsed = parseCockpitConversationRecord({
      id: "ck-1",
      assistantId: "builtin:ppt-deck",
      assistantName: "PPT",
      sessionId: "s1",
      repositoryPath: "/repo",
      repositoryName: "wise",
      projectId: "p1",
      projectName: "Demo",
      title: "路演",
      promptPreview: "做一份",
      createdAt: 1,
      updatedAt: 2,
      status: "ok",
      artifactPaths: ["slides/deck.pptx", "slides/deck.pptx", ""],
    });
    expect(parsed?.artifactPaths).toEqual(["slides/deck.pptx"]);
    expect(parsed?.status).toBe("ok");
    expect(cockpitPromptPreview("  hello   world  ")).toBe("hello world");
  });
});
