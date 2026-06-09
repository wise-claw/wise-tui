import { describe, expect, test } from "bun:test";
import { isClaudeChatSessionStreaming } from "./useChatMessagesPointerBusy";

describe("useChatMessagesPointerBusy", () => {
  test("streaming statuses", () => {
    expect(isClaudeChatSessionStreaming("running")).toBe(true);
    expect(isClaudeChatSessionStreaming("connecting")).toBe(true);
    expect(isClaudeChatSessionStreaming("idle")).toBe(false);
    expect(isClaudeChatSessionStreaming("completed")).toBe(false);
    expect(isClaudeChatSessionStreaming("cancelled")).toBe(false);
    expect(isClaudeChatSessionStreaming("error")).toBe(false);
  });
});
