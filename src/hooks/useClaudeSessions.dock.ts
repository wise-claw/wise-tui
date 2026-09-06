import { notificationHub } from "../notifications";
import type { ClaudeSession } from "../types";

export async function sendFollowupById(params: {
  sessionId: string;
  followupId: string;
  sendMessageToSession: (sessionId: string, prompt: string) => void | Promise<void>;
}): Promise<void> {
  const item = notificationHub
    .getDockSlice(params.sessionId)
    .followupItems.find((followup) => followup.id === params.followupId);
  if (!item) return;
  try {
    await params.sendMessageToSession(params.sessionId, item.text);
    notificationHub.removeFollowupItem(params.sessionId, params.followupId);
  } catch {
    /* 未接单或执行失败时保留追问，允许用户再次发送。 */
  }
}

export async function restoreRevertById(params: {
  sessionId: string;
  itemId: string;
  sessions: ClaudeSession[];
  sendMessageToSession: (sessionId: string, prompt: string) => Promise<void>;
}): Promise<void> {
  const tabSession = params.sessions.find((session) => session.id === params.sessionId);
  if (!tabSession) return;

  const item = notificationHub
    .getDockSlice(params.sessionId)
    .revertItems.find((revert) => revert.id === params.itemId);
  if (!item) return;

  const body = item.text.trim();
  if (!body) {
    notificationHub.removeRevertItem(params.sessionId, params.itemId);
    return;
  }

  const prompt = `请按此前给出的回退点执行恢复：\n${body}`;
  try {
    await params.sendMessageToSession(params.sessionId, prompt);
    notificationHub.removeRevertItem(params.sessionId, params.itemId);
  } catch {
    /* sendMessageToSession 已将失败写入会话；保留 Dock 条目便于重试 */
  }
}
