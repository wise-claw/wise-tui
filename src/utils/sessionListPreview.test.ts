import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  deriveSessionListPreviewFromMessages,
  resolveSessionListPreviewSource,
  retainSessionListPreviewOnMessageDrop,
} from "./sessionListPreview";

function userMsg(text: string, id = 1): ClaudeMessage {
  return {
    id,
    role: "user",
    content: text,
    parts: [{ type: "text", text }],
    timestamp: id,
  };
}

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "messages">): ClaudeSession {
  return {
    id: "s1",
    claudeSessionId: "s1",
    repositoryPath: "/r",
    repositoryName: "r",
    model: "sonnet",
    status: "completed",
    createdAt: 1,
    pendingPrompt: "",
    ...partial,
  };
}

describe("sessionListPreview", () => {
  test("deriveSessionListPreviewFromMessages prefers first user text", () => {
    expect(
      deriveSessionListPreviewFromMessages([
        userMsg("每个项目的新建会话、分屏打开"),
        { id: 2, role: "assistant", content: "好的", parts: [], timestamp: 2 },
      ]),
    ).toBe("每个项目的新建会话、分屏打开");
  });

  test("deriveSessionListPreviewFromMessages reads parts when content empty", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "user",
      content: "",
      parts: [{ type: "text", text: "来自 parts 的标题" }],
      timestamp: 1,
    };
    expect(deriveSessionListPreviewFromMessages([msg])).toBe("来自 parts 的标题");
  });

  test("resolveSessionListPreviewSource falls back to diskPreview", () => {
    expect(
      resolveSessionListPreviewSource(
        session({ messages: [], diskPreview: "磁盘预览标题" }),
      ),
    ).toBe("磁盘预览标题");
  });

  test("retainSessionListPreviewOnMessageDrop locks title before eviction", () => {
    expect(
      retainSessionListPreviewOnMessageDrop(
        session({ messages: [userMsg("侧栏应保留此标题")] }),
      ),
    ).toBe("侧栏应保留此标题");
    expect(
      retainSessionListPreviewOnMessageDrop(
        session({ messages: [userMsg("忽略")], diskPreview: "已有预览" }),
      ),
    ).toBe("已有预览");
  });
});
