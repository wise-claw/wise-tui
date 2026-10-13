import { expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import { appendTurnDuration, formatTurnDuration } from "./turnDuration";

const message = (id: number, role: ClaudeMessage["role"], timestamp: number): ClaudeMessage =>
  ({ id, role, timestamp, content: "hello", parts: [{ type: "text", text: "hello" }] });

test("formats seconds and minutes", () => {
  expect(formatTurnDuration(49_000)).toBe("49秒");
  expect(formatTurnDuration(60_000)).toBe("1分");
  expect(formatTurnDuration(125_000)).toBe("2分5秒");
});

test("records each turn once from its user message, not its first reply", () => {
  const first = appendTurnDuration([message(1, "user", 1000), message(2, "assistant", 2000)], 50_000);
  expect(first.at(-1)?.content).toBe("用时 49秒");
  expect(appendTurnDuration(first, 60_000)).toBe(first);
  const second = appendTurnDuration([...first, message(3, "user", 70_000), message(4, "assistant", 71_000)], 80_000);
  expect(second.at(-1)?.content).toBe("用时 10秒");
});

test("does not fabricate duration without a valid starting message", () => {
  const messages = [message(1, "assistant", 1000)];
  expect(appendTurnDuration(messages, 2000)).toBe(messages);
});
