/**
 * Floating entry to Mission Control — rendered globally in App.
 */

import { useCallback } from "react";
import { Button, Tooltip } from "antd";
import { PartitionOutlined } from "@ant-design/icons";
import {
  WORKFLOW_UI_EVENT_OPEN_ASSISTANT,
  type OpenAssistantDetail,
} from "../../constants/workflowUiEvents";

export const OPEN_PRD_SPLIT_WIZARD_EVENT = WORKFLOW_UI_EVENT_OPEN_ASSISTANT;
export type OpenPrdSplitWizardEventDetail = OpenAssistantDetail;

const FAB_STYLE: React.CSSProperties = {
  position: "fixed",
  right: 24,
  bottom: 24,
  zIndex: 1500,
  height: 42,
  padding: "0 20px",
  borderRadius: 999,
  fontWeight: 700,
  fontSize: 14,
  boxShadow: "0 4px 16px rgba(22, 119, 255, 0.18), 0 1px 4px rgba(0, 0, 0, 0.08)",
  background: "var(--ant-color-primary)",
  color: "#fff",
  border: "none",
};

export function PrdSplitWizardHost() {
  const onFabClick = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent<OpenAssistantDetail>(WORKFLOW_UI_EVENT_OPEN_ASSISTANT, { detail: {} }),
    );
  }, []);

  return (
    <Tooltip title="需求拆解 · 任务编排驾驶舱" placement="left">
      <Button
        style={FAB_STYLE}
        icon={<PartitionOutlined />}
        onClick={onFabClick}
      >
        PRD 拆解
      </Button>
    </Tooltip>
  );
}
