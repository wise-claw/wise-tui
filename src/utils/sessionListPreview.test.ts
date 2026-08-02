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

  test("代码审查 harness prompt 不上屏，改用工具会话标签", () => {
    const prompt = "你是 Wise 内置的代码审查引擎（对标 Cursor Bugbot 的本地审查体验）。\n只审查真实缺陷";
    expect(deriveSessionListPreviewFromMessages([userMsg(prompt)])).toBe("代码审查");
    expect(
      resolveSessionListPreviewSource(session({ messages: [], diskPreview: prompt })),
    ).toBe("代码审查");
  });

  test("resolveSessionListPreviewSource falls back to diskPreview", () => {
    expect(
      resolveSessionListPreviewSource(
        session({ messages: [], diskPreview: "磁盘预览标题" }),
      ),
    ).toBe("磁盘预览标题");
  });

  test("无用户气泡时优先 diskPreview，避免助手中段污染侧栏", () => {
    expect(
      resolveSessionListPreviewSource(
        session({
          messages: [
            {
              id: 2,
              role: "assistant",
              content: "）- **系统能力**：macOS 语音/麦克风",
              parts: [],
              timestamp: 2,
            },
          ],
          diskPreview: "分析项目有哪些功能",
        }),
      ),
    ).toBe("分析项目有哪些功能");
  });

  test("助手预览会去掉 markdown 加粗标记", () => {
    expect(
      deriveSessionListPreviewFromMessages([
        {
          id: 2,
          role: "assistant",
          content: "**系统能力**：macOS 语音",
          parts: [],
          timestamp: 2,
        },
      ]),
    ).toBe("系统能力：macOS 语音");
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

  test("retainSessionListPreviewOnMessageDrop 不把尾部窗口的中段消息当标题", () => {
    expect(
      retainSessionListPreviewOnMessageDrop(
        session({
          messages: [userMsg("LT_CHANGED,\n  WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED,")],
          diskTranscriptPartial: true,
        }),
      ),
    ).toBeUndefined();
  });
});
