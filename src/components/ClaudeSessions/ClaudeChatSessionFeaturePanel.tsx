import { memo } from "react";
import {
  ClaudeChatSessionFeatureToolbar,
  type ClaudeChatSessionFeatureToolbarProps,
} from "./ClaudeChatSessionFeatureToolbar";
import {
  ClaudeChatSessionTaskListDrawer,
  type ClaudeChatSessionTaskListDrawerProps,
} from "./ClaudeChatSessionTaskListDrawer";
import {
  ClaudeChatSessionTraceDrawer,
  type ClaudeChatSessionTraceDrawerProps,
} from "./ClaudeChatSessionTraceDrawer";

export {
  FEATURE_SESSION_LIST_PAGE_SIZE,
  SHOW_SESSION_TASK_COMPLETION_FEATURE,
  SESSION_SEND_TRACE_PERSIST_MAX,
  getTrellisTaskRelativePath,
  trellisTaskRowKey,
  type RefreshHistorySessionsScope,
  type RepositorySessionExecutionRow,
  type SessionSendTraceEntry,
  type SessionUserQuestionRow,
  type TaskCompletionOwnerFilter,
  type TaskCompletionStatusFilter,
} from "./ClaudeChatSessionFeatureShared";

export type {
  ClaudeChatSessionFeatureToolbarProps,
  ClaudeChatSessionTaskListDrawerProps,
  ClaudeChatSessionTraceDrawerProps,
};

/** 分组 props：Toolbar 与 Drawer 独立 memo，Drawer 关闭时不随内部选中态重算 */
export interface ClaudeChatSessionFeaturePanelProps {
  toolbar: ClaudeChatSessionFeatureToolbarProps;
  taskListDrawer: ClaudeChatSessionTaskListDrawerProps | null;
  traceDrawer: ClaudeChatSessionTraceDrawerProps | null;
}

function featurePanelPropsEqual(
  prev: ClaudeChatSessionFeaturePanelProps,
  next: ClaudeChatSessionFeaturePanelProps,
): boolean {
  return (
    prev.toolbar === next.toolbar &&
    prev.taskListDrawer === next.taskListDrawer &&
    prev.traceDrawer === next.traceDrawer
  );
}

export const ClaudeChatSessionFeaturePanel = memo(function ClaudeChatSessionFeaturePanel(
  props: ClaudeChatSessionFeaturePanelProps,
) {
  const { toolbar, taskListDrawer, traceDrawer } = props;

  return (
    <>
      <ClaudeChatSessionFeatureToolbar {...toolbar} />
      {taskListDrawer ? <ClaudeChatSessionTaskListDrawer {...taskListDrawer} /> : null}
      {traceDrawer ? <ClaudeChatSessionTraceDrawer {...traceDrawer} /> : null}
    </>
  );
}, featurePanelPropsEqual);
