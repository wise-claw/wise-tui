import { memo } from "react";
import {
  ClaudeChatSessionFeatureToolbar,
  type ClaudeChatSessionFeatureToolbarProps,
} from "./ClaudeChatSessionFeatureToolbar";
import {
  ClaudeChatSessionTraceDrawer,
  type ClaudeChatSessionTraceDrawerProps,
} from "./ClaudeChatSessionTraceDrawer";

export {
  FEATURE_SESSION_LIST_PAGE_SIZE,
  SHOW_SESSION_TASK_COMPLETION_FEATURE,
  SESSION_SEND_TRACE_PERSIST_MAX,
  type RefreshHistorySessionsScope,
  type RepositorySessionExecutionRow,
  type SessionSendTraceEntry,
  type SessionUserQuestionRow,
  type TaskCompletionOwnerFilter,
  type TaskCompletionStatusFilter,
} from "./ClaudeChatSessionFeatureShared";

export type {
  ClaudeChatSessionFeatureToolbarProps,
  ClaudeChatSessionTraceDrawerProps,
};

/** 分组 props：Toolbar 与 Drawer 独立 memo，Drawer 关闭时不随内部选中态重算 */
export interface ClaudeChatSessionFeaturePanelProps {
  toolbar: ClaudeChatSessionFeatureToolbarProps;
  traceDrawer: ClaudeChatSessionTraceDrawerProps | null;
}

function featurePanelPropsEqual(
  prev: ClaudeChatSessionFeaturePanelProps,
  next: ClaudeChatSessionFeaturePanelProps,
): boolean {
  return prev.toolbar === next.toolbar && prev.traceDrawer === next.traceDrawer;
}

export const ClaudeChatSessionFeaturePanel = memo(function ClaudeChatSessionFeaturePanel(
  props: ClaudeChatSessionFeaturePanelProps,
) {
  const { toolbar, traceDrawer } = props;

  return (
    <>
      <ClaudeChatSessionFeatureToolbar {...toolbar} />
      {traceDrawer ? <ClaudeChatSessionTraceDrawer {...traceDrawer} /> : null}
    </>
  );
}, featurePanelPropsEqual);
