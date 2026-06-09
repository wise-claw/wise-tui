import type { ReactNode } from "react";
import { HoverHint } from "../shared/HoverHint";
import {
  DownOutlined,
  FileAddOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Select, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import type { AssistantBundleItem } from "../../services/assistantPromptLayers";
import type { AssistantWorkflowRef } from "../../types/assistant";
import type { LegacyRunSummary } from "../../services/prdSplit/legacyRunsImport";

function buildWorkflowSummary(workflows: AssistantWorkflowRef[]): string {
  if (workflows.length === 0) return "内置任务规划";
  return workflows.map((item) => item.label).join(" · ");
}

function buildWorkflowTooltip(workflows: AssistantWorkflowRef[]): ReactNode {
  if (workflows.length === 0) {
    return "内置任务规划与执行流程";
  }
  return (
    <ul className="app-prd-task-panel__assistant-orchestration-tip">
      {workflows.map((item) => (
        <li key={item.id}>
          {item.label}
          {item.description ? ` — ${item.description}` : ""}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  hasInput: boolean;
  parsing: boolean;
  splitStarting: boolean;
  promptActionItems: MenuProps["items"];
  assistantRuntimeLoading: boolean;
  assistantWorkflowOptions: AssistantWorkflowRef[];
  assistantMcpOptions: AssistantBundleItem[];
  assistantSelectedMcpIds: string[];
  assistantHistoryOptions: LegacyRunSummary[];
  assistantHistoryLoading: boolean;
  onSaveDraft: () => void;
  onStartSplit: () => void;
  onImportPrdFile: () => void;
  onImportLegacyPrd: (summary: LegacyRunSummary) => void;
  onAssistantMcpsChange: (ids: string[]) => void;
}

export function RequirementBoardActions({
  hasInput,
  parsing,
  splitStarting,
  promptActionItems,
  assistantRuntimeLoading,
  assistantWorkflowOptions,
  assistantMcpOptions,
  assistantSelectedMcpIds,
  assistantHistoryOptions,
  assistantHistoryLoading,
  onSaveDraft,
  onStartSplit,
  onImportPrdFile,
  onImportLegacyPrd,
  onAssistantMcpsChange,
}: Props) {
  return (
    <div className="app-prd-task-panel__actions-row">
      <div className="app-prd-task-panel__assistant-resource-row">
        <HoverHint title={buildWorkflowTooltip(assistantWorkflowOptions)}>
          <div
            className="app-prd-task-panel__assistant-orchestration"
            aria-label="需求拆分助手内置任务规划"
          >
            <Typography.Text type="secondary" className="app-prd-task-panel__assistant-orchestration-label">
              流程
            </Typography.Text>
            <Typography.Text
              type="secondary"
              className="app-prd-task-panel__assistant-orchestration-value"
              ellipsis
            >
              {assistantRuntimeLoading
                ? "加载中…"
                : buildWorkflowSummary(assistantWorkflowOptions)}
            </Typography.Text>
          </div>
        </HoverHint>
        <Select
          mode="multiple"
          size="small"
          placeholder="MCP"
          loading={assistantRuntimeLoading}
          value={assistantSelectedMcpIds}
          options={assistantMcpOptions.map((item) => ({ label: item.label, value: item.id }))}
          onChange={onAssistantMcpsChange}
          maxTagCount={1}
          maxTagPlaceholder={(omitted) => `+${omitted.length}`}
          className="app-prd-task-panel__assistant-resource-select"
        />
      </div>
      <Space className="app-prd-task-panel__actions-left">
        <Button
          icon={<FileAddOutlined />}
          className="app-prd-task-panel__action-btn"
          onClick={onImportPrdFile}
        >
          导入 PRD
        </Button>
        <Dropdown
          menu={{
            items: assistantHistoryOptions.length > 0
              ? assistantHistoryOptions.slice(0, 10).map((item) => ({
                key: item.runId,
                label: item.prdPreview || item.runId,
                onClick: () => onImportLegacyPrd(item),
              }))
              : [{ key: "__empty__", label: "暂无历史 PRD", disabled: true }],
          }}
          trigger={["click"]}
          placement="topLeft"
        >
          <Button
            icon={<HistoryOutlined />}
            loading={assistantHistoryLoading}
            className="app-prd-task-panel__action-btn"
          >
            历史导入
          </Button>
        </Dropdown>
        <Button
          icon={<SaveOutlined />}
          className="app-prd-task-panel__action-btn"
          onClick={onSaveDraft}
          disabled={!hasInput}
        >
          保存
        </Button>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          className="app-prd-task-panel__btn-primary app-prd-task-panel__action-btn"
          onClick={onStartSplit}
          loading={parsing}
          disabled={!hasInput || parsing || splitStarting}
        >
          生成任务草案
        </Button>
      </Space>
      <Space size={8}>
        <Dropdown menu={{ items: promptActionItems }} trigger={["click"]} placement="bottomRight">
          <Button
            icon={<SettingOutlined />}
            className="app-prd-task-panel__btn-secondary app-prd-task-panel__action-btn"
            aria-label="更多操作"
          >
            更多操作
            <DownOutlined />
          </Button>
        </Dropdown>
      </Space>
    </div>
  );
}
