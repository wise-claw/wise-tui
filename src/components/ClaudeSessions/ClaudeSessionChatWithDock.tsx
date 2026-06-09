import { memo, type ComponentProps } from "react";
import { useDockSlice } from "../../hooks/useDockSlice";
import { ClaudeChat } from "./ClaudeChat";
import { claudeChatPropsEqual } from "./claudeChatPropsEqual";

export type ClaudeSessionChatWithDockProps = Omit<
  ComponentProps<typeof ClaudeChat>,
  | "todos"
  | "questionRequest"
  | "questionRequestQueueLength"
  | "questionRequestStatus"
  | "questionRequestError"
  | "permissionRequest"
  | "permissionRequestStatus"
  | "permissionRequestError"
  | "followupItems"
  | "revertItems"
>;

/** 在子树内 `useDockSlice`，避免多屏时一侧通知桶更新导致其它窗格整棵 `ClaudeChat` reconcile。 */
export const ClaudeSessionChatWithDock = memo(function ClaudeSessionChatWithDock(
  props: ClaudeSessionChatWithDockProps,
) {
  const dock = useDockSlice(props.session.id);
  return (
    <ClaudeChat
      {...props}
      todos={dock.todos}
      questionRequest={dock.questionRequest}
      questionRequestQueueLength={dock.questionRequestQueue.length}
      questionRequestStatus={dock.questionRequestStatus}
      questionRequestError={dock.questionRequestError}
      permissionRequest={dock.permissionRequest}
      permissionRequestStatus={dock.permissionRequestStatus}
      permissionRequestError={dock.permissionRequestError}
      followupItems={dock.followupItems}
      revertItems={dock.revertItems}
    />
  );
}, claudeChatPropsEqual);
