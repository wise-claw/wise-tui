import { describe, expect, test } from "bun:test";
import {
  IN_MEMORY_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
import {
  applySessionMemoryCap,
  applySessionsMemoryCap,
  capSessionMessagesForMemory,
  downgradeUnlimitedTranscriptSession,
  downgradeUnlimitedTranscriptsOutside,
  sessionMessagesFromJsonlLines,
  trimMessagePartsForMemory,
} from "./sessionMessagesMemory";

describe("sessionMessagesMemory", () => {
  test("capSessionMessagesForMemory keeps tail only", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      role: "user" as const,
      content: `m${i}`,
      parts: [],
      timestamp: i,
    }));
    const capped = capSessionMessagesForMemory(messages, 3);
    expect(capped.map((m) => m.id)).toEqual(["7", "8", "9"]);
  });

  test("trimMessagePartsForMemory 保留用户消息开头、助手消息结尾", () => {
    const head = "你是 Wise 内置的代码审查引擎";
    const tail = "WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED";
    const long = `${head}${"d".repeat(200)}${tail}`;
    const [user, assistant] = trimMessagePartsForMemory(
      [
        {
          id: 1,
          role: "user",
          content: long,
          parts: [{ type: "text", text: long }],
          timestamp: 1,
        },
        {
          id: 2,
          role: "assistant",
          content: long,
          parts: [{ type: "text", text: long }],
          timestamp: 2,
        },
      ],
      60,
    );
    const userText = user?.parts?.[0];
    const assistantText = assistant?.parts?.[0];
    expect(userText?.type === "text" && userText.text.startsWith(head)).toBe(true);
    expect(assistantText?.type === "text" && assistantText.text.endsWith(tail)).toBe(true);
  });

  test("sessionMessagesFromJsonlLines marks partial when tail saturated", () => {
    const lines = ['{"type":"user","message":{"role":"user","content":"hi"}}'];
    const result = sessionMessagesFromJsonlLines(lines, {
      tailRequestLines: 1,
      memoryMax: IN_MEMORY_SESSION_MESSAGES_MAX,
    });
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.diskTranscriptPartial).toBe(true);
  });

  test("sessionMessagesFromJsonlLines unlimited keeps all parsed messages on full transcript", () => {
    const lines = Array.from({ length: 120 }, (_, i) =>
      JSON.stringify({
        type: "user",
        message: { role: "user", content: `m${i}` },
      }),
    );
    const result = sessionMessagesFromJsonlLines(lines, {
      tailRequestLines: lines.length,
      fullTranscript: true,
      unlimitedMessageCount: true,
    });
    expect(result.messages.length).toBe(120);
    expect(result.diskTranscriptPartial).toBe(false);
  });

  test("applySessionMemoryCap skips message count when transcriptMemoryUnlimited", () => {
    const sessions = [
      {
        id: "a",
        claudeSessionId: "a",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        transcriptMemoryUnlimited: true,
        messages: Array.from({ length: 200 }, (_, i) => ({
          id: i,
          role: "user" as const,
          content: `m${i}`,
          parts: [],
          timestamp: i,
        })),
        createdAt: 1,
        pendingPrompt: "",
      },
    ];
    const next = applySessionsMemoryCap(sessions);
    expect(next[0]?.messages.length).toBe(200);
    expect(next[0]?.diskTranscriptPartial).toBeFalsy();
  });

  test("applySessionsMemoryCap marks partial when truncated", () => {
    const sessions = [
      {
        id: "a",
        claudeSessionId: "a",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: Array.from({ length: 200 }, (_, i) => ({
          id: i,
          role: "user" as const,
          content: `m${i}`,
          parts: [],
          timestamp: i,
        })),
        createdAt: 1,
        pendingPrompt: "",
      },
    ];
    const next = applySessionsMemoryCap(sessions);
    expect(next[0]?.messages.length).toBeLessThan(200);
    expect(next[0]?.diskTranscriptPartial).toBe(true);
    expect(applySessionMemoryCap(sessions[0]!).messages.length).toBe(next[0]!.messages.length);
  });

  test("applySessionsMemoryCap preserves array reference when already capped", () => {
    const sessions = [
      {
        id: "a",
        claudeSessionId: "a",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: [],
        createdAt: 1,
        pendingPrompt: "",
      },
    ];
    expect(applySessionsMemoryCap(sessions)).toBe(sessions);
  });

  test("trimMessagePartsForMemory truncates oversized tool output", () => {
    const messages = [
      {
        id: 1,
        role: "user" as const,
        content: "x",
        parts: [
          {
            type: "tool_use" as const,
            id: "t1",
            name: "Read",
            input: {},
            output: "a".repeat(20_000),
            status: "completed" as const,
          },
        ],
        timestamp: 1,
      },
    ];
    const trimmed = trimMessagePartsForMemory(messages);
    expect(trimmed[0]?.parts[0]?.type).toBe("tool_use");
    if (trimmed[0]?.parts[0]?.type === "tool_use") {
      expect((trimmed[0].parts[0].output ?? "").length).toBeLessThan(20_000);
    }
  });

  test("trimMessagePartsForMemory caps oversized tool input strings and keeps small inputs by reference", () => {
    const bigLine = "x".repeat(99);
    const bigContent = Array.from({ length: 3_000 }, () => bigLine).join("\n");
    const smallInput = { file_path: "/r/a.ts", old_string: "a", new_string: "b" };
    const bigInput = {
      file_path: "/r/big.ts",
      content: bigContent,
      edits: [{ old_string: "a", new_string: bigContent }],
    };
    const messages = [
      {
        id: 1,
        role: "assistant" as const,
        content: "",
        parts: [
          { type: "tool_use" as const, id: "s", name: "Edit", input: smallInput, status: "completed" as const },
          { type: "tool_use" as const, id: "b", name: "Write", input: bigInput, status: "completed" as const },
        ],
        timestamp: 1,
      },
    ];
    const trimmed = trimMessagePartsForMemory(messages, 10_000, 5_000);
    const [small, big] = trimmed[0]!.parts;
    expect(small?.type === "tool_use" && small.input).toBe(smallInput);
    if (big?.type !== "tool_use") throw new Error("expected tool_use");
    const content = big.input.content as string;
    expect(content.length).toBeLessThanOrEqual(5_000);
    expect(content.endsWith("\n")).toBe(true);
    expect(bigContent.startsWith(content)).toBe(true);
    expect(big.input.file_path).toBe("/r/big.ts");
    const edit = (big.input.edits as Array<Record<string, string>>)[0]!;
    expect(edit.new_string!.length).toBeLessThanOrEqual(5_000);
    expect(edit.old_string).toBe("a");
    expect(bigInput.content).toBe(bigContent);
    expect(trimMessagePartsForMemory(trimmed, 10_000, 5_000)).toBe(trimmed);
  });

  test("downgradeUnlimitedTranscriptsOutside keeps viewed/running sessions and tail-caps the rest", () => {
    const mk = (id: string, n: number, extra: Record<string, unknown> = {}) =>
      ({
        id,
        claudeSessionId: id,
        repositoryPath: "/r",
        status: "idle",
        transcriptMemoryUnlimited: true,
        messages: Array.from({ length: n }, (_, i) => ({
          id: i,
          role: "user" as const,
          content: i === 0 ? `${id}-title` : `m${i}`,
          parts: [{ type: "text" as const, text: i === 0 ? `${id}-title` : `m${i}` }],
          timestamp: i,
        })),
        ...extra,
      }) as unknown as import("../types").ClaudeSession;
    const viewed = mk("viewed", 500);
    const running = mk("running", 500, { status: "running" });
    const background = mk("bg", 500);
    const small = mk("small", 3);
    const plain = { ...mk("plain", 5), transcriptMemoryUnlimited: false };
    const input = [viewed, running, background, small, plain];

    const out = downgradeUnlimitedTranscriptsOutside(input, new Set(["viewed"]), 64);
    expect(out[0]).toBe(viewed);
    expect(out[1]).toBe(running);
    expect(out[2]!.messages.length).toBe(64);
    expect(out[2]!.transcriptMemoryUnlimited).toBe(false);
    expect(out[2]!.diskTranscriptPartial).toBe(true);
    expect(out[2]!.diskPreview).toContain("bg-title");
    expect(out[3]!.messages).toBe(small.messages);
    expect(out[3]!.transcriptMemoryUnlimited).toBe(false);
    expect(out[4]).toBe(plain);

    const again = downgradeUnlimitedTranscriptsOutside(out, new Set(["viewed"]), 64);
    expect(again).toBe(out);
    expect(downgradeUnlimitedTranscriptSession(plain)).toBe(plain);
  });

  test("applySessionsMemoryCap clears idle sessions when global budget exceeded", () => {
    const mkMessages = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({
        id: i,
        role: "user" as const,
        content: i === 0 ? `${prefix}-title` : `m${i}`,
        parts: [],
        timestamp: i,
      }));
    const sessions = [
      {
        id: "active",
        claudeSessionId: "active",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: mkMessages(IN_MEMORY_SESSION_MESSAGES_MAX, "active"),
        createdAt: 1,
        pendingPrompt: "",
      },
      {
        id: "idle",
        claudeSessionId: "idle",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: mkMessages(IN_MEMORY_SESSION_MESSAGES_MAX, "idle"),
        createdAt: 2,
        pendingPrompt: "",
      },
    ];
    const next = applySessionsMemoryCap(sessions, {
      keepSessionIds: new Set(["active"]),
      globalMessagesBudget: IN_MEMORY_SESSION_MESSAGES_MAX,
    });
    expect(next.find((s) => s.id === "active")?.messages.length).toBe(IN_MEMORY_SESSION_MESSAGES_MAX);
    const idle = next.find((s) => s.id === "idle");
    expect(idle?.messages.length).toBe(0);
    expect(idle?.diskPreview).toBe("idle-title");
  });

  test("applySessionsMemoryCap keeps tab-only sessions without disk evidence", () => {
    const mkMessages = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({
        id: i,
        role: "user" as const,
        content: i === 0 ? `${prefix}-title` : `m${i}`,
        parts: [],
        timestamp: i,
      }));
    const sessions = [
      {
        id: "active",
        claudeSessionId: "active",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: mkMessages(IN_MEMORY_SESSION_MESSAGES_MAX, "active"),
        createdAt: 1,
        pendingPrompt: "",
      },
      {
        id: "codex-rpc-tab",
        claudeSessionId: null,
        repositoryPath: "/r",
        repositoryName: "r",
        model: "minimax-m3",
        status: "idle" as const,
        messages: mkMessages(IN_MEMORY_SESSION_MESSAGES_MAX, "codex"),
        createdAt: 2,
        pendingPrompt: "",
        diskTranscriptPartial: false,
      },
    ];
    const next = applySessionsMemoryCap(sessions, {
      keepSessionIds: new Set(["active"]),
      globalMessagesBudget: IN_MEMORY_SESSION_MESSAGES_MAX,
    });
    expect(next.find((s) => s.id === "codex-rpc-tab")?.messages.length).toBe(
      IN_MEMORY_SESSION_MESSAGES_MAX,
    );
  });

  test("applySessionsMemoryCap retains diskPreview when per-session cap drops first user message", () => {
    const sessions = [
      {
        id: "a",
        claudeSessionId: "a",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: Array.from({ length: 200 }, (_, i) => ({
          id: i,
          role: "user" as const,
          content: i === 0 ? "首条用户标题应被保留" : `m${i}`,
          parts: [],
          timestamp: i,
        })),
        createdAt: 1,
        pendingPrompt: "",
      },
    ];
    const next = applySessionsMemoryCap(sessions);
    expect(next[0]?.messages.length).toBeLessThan(200);
    expect(next[0]?.messages.some((m) => m.content === "首条用户标题应被保留")).toBe(false);
    expect(next[0]?.diskPreview).toBe("首条用户标题应被保留");
  });
});
