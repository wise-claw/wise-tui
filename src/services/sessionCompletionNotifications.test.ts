import { expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import type { HudCompletionToastItem } from "../utils/hudCompletionToast";
import { publishClaudeSessions } from "../stores/claudeSessionsLiveStore";
import { getWiseHudModeActive } from "../stores/wiseHudModeStore";
import { subscribeSessionCompletionNotifications } from "./sessionCompletionNotifications";

function session(id: string, status: ClaudeSession["status"]): ClaudeSession {
  return {
    id, status, threadName: `任务 ${id}`, repositoryPath: "/repo", repositoryName: "项目",
    messages: [{ id: 1, role: "assistant", content: `结果 ${id}`, parts: [], timestamp: 1 }],
  };
}

test("normal workspace delivers simultaneous completions even when React never renders running state", () => {
  publishClaudeSessions([session("old", "completed")]);
  expect(getWiseHudModeActive()).toBe(false);
  const batches: HudCompletionToastItem[][] = [];
  const stop = subscribeSessionCompletionNotifications(async (items) => { batches.push([...items]); });
  try {
    publishClaudeSessions([session("a", "running"), session("b", "running"), session("c", "running")]);
    publishClaudeSessions([session("a", "completed"), session("b", "error"), session("c", "cancelled")]);
    publishClaudeSessions([session("a", "completed"), session("b", "error"), session("c", "cancelled")]);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((item) => [item.sessionId, item.title, item.kind])).toEqual([
      ["a", "任务 a", "success"], ["b", "任务 b", "error"],
    ]);
  } finally { stop(); }
});
