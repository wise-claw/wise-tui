import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  findLatestUserOmcDispatchPayload,
  listUserPlainTextsLatestFirst,
  messageTextLooksLikeOmcDispatch,
  parseOmcDispatchTaskIdFromUserText,
  parseOmcSlashCommandFromUserText,
  sessionHasOmcDispatchInAnyUserMessage,
  userMessagePlainText,
} from "./omcUserMessageText";

function userMsg(parts: ClaudeMessage["parts"], content = ""): ClaudeMessage {
  return { id: 1, role: "user", content, parts, timestamp: 0 };
}

describe("userMessagePlainText — tool_result 防护", () => {
  test("纯 tool_use parts 的 user 消息返回空，避免 OMC 派发误识别", () => {
    const msg = userMsg(
      [
        {
          type: "tool_use",
          id: "call_function_ubbktg42s6tw_1",
          name: "",
          input: {},
          output: "      #     | IID  |  TITLE  | CREATOR | URL  ...",
          status: "completed",
        },
      ],
      "",
    );
    expect(userMessagePlainText(msg)).toBe("");
  });

  test("历史污染 content 的 orphan tool_result 仍返回空", () => {
    const msg = userMsg(
      [
        {
          type: "tool_use",
          id: "t1",
          name: "",
          input: {},
          output: "stdout leak",
          status: "completed",
        },
      ],
      "stdout leak",
    );
    expect(userMessagePlainText(msg)).toBe("");
  });

  test("正常用户文本不受影响", () => {
    expect(
      userMessagePlainText(userMsg([{ type: "text", text: "看下这个 PR" }], "看下这个 PR")),
    ).toBe("看下这个 PR");
  });

  test("assistant / system 消息仍返回空", () => {
    expect(
      userMessagePlainText({
        id: 1,
        role: "assistant",
        content: "hi",
        parts: [{ type: "text", text: "hi" }],
        timestamp: 0,
      }),
    ).toBe("");
  });
});

describe("findLatestUserOmcDispatchPayload — 不会被 orphan tool_result 误命中", () => {
  test("末尾是 orphan tool_result 时返回 null", () => {
    const session = {
      id: "s1",
      claudeSessionId: "cs1",
      repositoryPath: null,
      title: "",
      createdAt: 0,
      updatedAt: 0,
      connectionKind: "streaming" as const,
      preview: "",
      modelHint: null,
      messages: [
        userMsg(
          [
            {
              type: "tool_use",
              id: "t1",
              name: "",
              input: {},
              output: "      #     | IID  |  TITLE  | CREATOR | URL  ...",
              status: "completed",
            },
          ],
          "      #     | IID  |  TITLE  | CREATOR | URL  ...",
        ),
      ],
    };
    expect(findLatestUserOmcDispatchPayload(session)).toBeNull();
    expect(sessionHasOmcDispatchInAnyUserMessage(session)).toBe(false);
    expect(listUserPlainTextsLatestFirst(session)).toEqual([]);
  });
});

describe("parseOmcSlashCommandFromUserText / parseOmcDispatchTaskIdFromUserText / messageTextLooksLikeOmcDispatch", () => {
  test("slash 命令解析", () => {
    expect(parseOmcSlashCommandFromUserText("/autopilot 帮我看下这个 PR")).toBe("/autopilot");
    expect(parseOmcSlashCommandFromUserText("OMC command: /verify x")).toBe("/verify");
    expect(parseOmcSlashCommandFromUserText("随便聊聊")).toBeNull();
  });

  test("任务 ID 解析", () => {
    expect(parseOmcDispatchTaskIdFromUserText("任务ID：abc-123")).toBe("abc-123");
    expect(parseOmcDispatchTaskIdFromUserText("taskId: task-7")).toBe("task-7");
    expect(parseOmcDispatchTaskIdFromUserText("随便")).toBe("unknown-task");
  });

  test("派发文本识别", () => {
    expect(messageTextLooksLikeOmcDispatch("/autopilot x")).toBe(true);
    expect(messageTextLooksLikeOmcDispatch("OMC command: /verify y")).toBe(true);
    expect(messageTextLooksLikeOmcDispatch("看下这个 PR")).toBe(false);
  });
});
