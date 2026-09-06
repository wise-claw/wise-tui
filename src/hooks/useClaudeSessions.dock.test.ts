import { expect, test } from "bun:test";
import { notificationHub } from "../notifications";
import { sendFollowupById } from "./useClaudeSessions.dock";

test("follow-up survives a rejected send and is removed only after a successful retry", async () => {
  const sessionId = "followup-send-lifecycle";
  notificationHub.ingestStreamAssistText(sessionId, "Follow-up: continue review");
  const item = notificationHub.getDockSlice(sessionId).followupItems[0]!;
  expect(item).toBeDefined();
  try {
    await sendFollowupById({ sessionId, followupId: item.id, sendMessageToSession: async () => {
      throw new Error("blocked");
    } });
    expect(notificationHub.getDockSlice(sessionId).followupItems).toHaveLength(1);
    let resolve!: () => void;
    const pending = sendFollowupById({ sessionId, followupId: item.id, sendMessageToSession: () =>
      new Promise<void>((yes) => { resolve = yes; }) });
    expect(notificationHub.getDockSlice(sessionId).followupItems).toHaveLength(1);
    resolve();
    await pending;
    expect(notificationHub.getDockSlice(sessionId).followupItems).toHaveLength(0);
  } finally { notificationHub.removeSession(sessionId); }
});
