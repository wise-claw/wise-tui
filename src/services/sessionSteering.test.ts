import { beforeEach, expect, mock, test } from "bun:test";

const invoke = mock(async (..._args: unknown[]) => undefined);
mock.module("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
const { resolveSessionSteeringTarget, sendSessionSteering } = await import("./sessionSteering");
const session = { id: "wise-tab", claudeSessionId: "claude-session" };
beforeEach(() => invoke.mockClear());

test("Claude steering follows connection overrides and requires a bound session", () => {
  expect(resolveSessionSteeringTarget("claude", session, "streaming")).toEqual({
    transport: "claude-streaming", sessionId: "claude-session",
  });
  expect(resolveSessionSteeringTarget("claude", { ...session, connectionKind: "oneshot" }, "streaming")).toBeNull();
  expect(resolveSessionSteeringTarget("claude", session, "oneshot")).toBeNull();
  expect(resolveSessionSteeringTarget("claude", { ...session, connectionKind: "streaming" }, "oneshot")).not.toBeNull();
  expect(resolveSessionSteeringTarget("claude", { ...session, claudeSessionId: " " }, "streaming")).toBeNull();
});

test("Codex uses the Wise tab id; unsupported transports stay disabled", () => {
  for (const engine of ["codex", "codex-rpc"] as const) {
    expect(resolveSessionSteeringTarget(engine, session, "oneshot")).toEqual({ transport: "codex", sessionId: "wise-tab" });
  }
  for (const engine of ["cursor", "opencode", "deepseek", "qoder", "gemini"] as const) {
    expect(resolveSessionSteeringTarget(engine, session, "streaming")).toBeNull();
  }
});

test("Claude writes steering to the live session without starting another invocation", async () => {
  await sendSessionSteering({ transport: "claude-streaming", sessionId: "claude-session" }, "补充要求");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("send_user_message_to_session", {
    sessionId: "claude-session", prompt: "补充要求", steer: true,
  });
});

test("a closed turn rejects without fallback so the composer can recover its draft", async () => {
  invoke.mockImplementationOnce(async () => { throw new Error("turn ended"); });
  await expect(sendSessionSteering({ transport: "claude-streaming", sessionId: "closed" }, "保留内容"))
    .rejects.toThrow("turn ended");
  expect(invoke).toHaveBeenCalledTimes(1);
});
