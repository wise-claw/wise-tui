import {
  DownOutlined,
  FileAddOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Select, Space, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import type { AssistantBundleItem } from "../../services/assistantPromptLayers";
import type { AssistantWorkflowRef } from "../../types/assistant";
import type { LegacyRunSummary } from "../../services/prdSplit/legacyRunsImport";

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
        <div className="app-prd-task-panel__assistant-skill-pack" aria-label="需求拆分助手内置 Trellis 编排">
          <Typography.Text type="secondary" className="app-prd-task-panel__assistant-skill-pack-label">
            内置编排
          </Typography.Text>
          <div className="app-prd-task-panel__assistant-skill-pack-tags">
            {assistantRuntimeLoading ? (
              <Tag>加载中</Tag>
            ) : assistantWorkflowOptions.length > 0 ? (
              assistantWorkflowOptions.map((item) => (
                <Tag key={item.id} color="blue" title={item.description}>
                  {item.label}
                </Tag>
              ))
            ) : (
              <Tag>Wise Trellis Workflow</Tag>
            )}
          </div>
        </div>
        <Select
          mode="multiple"
          size="small"
          placeholder="选择 MCP"
          loading={assistantRuntimeLoading}
          value={assistantSelectedMcpIds}
          options={assistantMcpOptions.map((item) => ({ label: item.label, value: item.id }))}
          onChange={onAssistantMcpsChange}
          maxTagCount="responsive"
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
          拆分
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
