import { CloseOutlined } from "@ant-design/icons";
import { Button, Space, Spin, Typography } from "antd";
import type { RefObject } from "react";
import { SplitRuntimeMessages } from "./SplitRuntimeMessages";
import type { SplitRetryPhase, SplitRuntimeLogItem } from "./types";
import type { ClusterRunState } from "../PrdSplitWizard/types";

interface Props {
  visible: boolean;
  parsing: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  logs: SplitRuntimeLogItem[];
  clusterRuns?: ClusterRunState[];
  retryingPhase: SplitRetryPhase | null;
  onClose: () => void;
  onRetryStage: (phase: SplitRetryPhase) => void;
  onRetryCluster?: (clusterId: string) => void;
  onCancelCluster?: (clusterId: string) => void;
}

export function InlineRuntimePanel({
  visible,
  parsing,
  containerRef,
  listRef,
  logs,
  clusterRuns,
  retryingPhase,
  onClose,
  onRetryStage,
  onRetryCluster,
  onCancelCluster,
}: Props) {
  if (!visible) return null;
  return (
    <div ref={containerRef} className="app-prd-task-panel__split-runtime">
      <div className="app-prd-task-panel__split-runtime-head">
        <Space size={8} align="center" className="app-prd-task-panel__split-runtime-head-title">
          <Typography.Text strong>子代理对话流</Typography.Text>
          {parsing ? <Spin size="small" aria-label="拆分进行中" /> : null}
        </Space>
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          aria-label="关闭子代理对话面板"
        />
      </div>
      <SplitRuntimeMessages
        logs={logs}
        clusterRuns={clusterRuns}
        listRef={listRef}
        retryingPhase={retryingPhase}
        onRetryStage={onRetryStage}
        onRetryCluster={onRetryCluster}
        onCancelCluster={onCancelCluster}
      />
    </div>
  );
}
