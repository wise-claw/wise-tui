import { lazy, Suspense } from "react";
import { Spin } from "antd";
import type { ComponentProps } from "react";

const MissionControl = lazy(() =>
  import("../MissionControl").then((module) => ({ default: module.MissionControl })),
);
const PrdTaskSplitPanel = lazy(() =>
  import("../PrdTaskSplitPanel").then((module) => ({ default: module.PrdTaskSplitPanel })),
);

export type AssistantConversationMissionControlProps = ComponentProps<typeof MissionControl>;
export type AssistantConversationPrdTaskSplitPanelProps = ComponentProps<typeof PrdTaskSplitPanel>;

export interface AssistantConversationViewProps {
  missionControlProps: AssistantConversationMissionControlProps;
  prdTaskSplitPanelProps: AssistantConversationPrdTaskSplitPanelProps;
}

/**
 * D13 修订:助手 conversation 视图 = 现 MissionControl(单栏)的薄封装。
 * 不再实现 ChatPane / ArtifactPane / 双栏 / Claude tool use。
 *
 * Stage 5 可能把内核换成 PrdTaskSplitPanel 直挂(单独立任务决定);本组件保持稳定。
 */
export function AssistantConversationView({
  prdTaskSplitPanelProps,
}: AssistantConversationViewProps) {
  return (
    <Suspense fallback={<ConversationFallback />}>
      <PrdTaskSplitPanel {...prdTaskSplitPanelProps} />
    </Suspense>
  );
}

function ConversationFallback() {
  return (
    <div className="app-file-editor-loading">
      <Spin size="small" />
    </div>
  );
}
