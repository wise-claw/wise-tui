import type { ClaudeSession } from "../../types";
import {
  notificationConversationInSessionInboxScope,
  notificationInboxConversationMatchesSession,
  type NotificationInboxRow,
  notificationRowInSessionInboxScope,
  countSessionUnreadNotifications,
} from "./claudeChatHelpers";

export {
  notificationConversationInSessionInboxScope,
  notificationInboxConversationMatchesSession,
  notificationRowInSessionInboxScope,
  countSessionUnreadNotifications,
};

export function sessionNotificationInboxCount(
  rows: NotificationInboxRow[],
  sess: ClaudeSession,
  allSessions: ClaudeSession[],
): number {
  return countSessionUnreadNotifications(rows, sess, allSessions);
}
