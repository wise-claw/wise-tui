import {
  DeleteOutlined,
  PlusOutlined,
  PushpinOutlined,
} from "@ant-design/icons";
import { Button, Select, Space, Tooltip } from "antd";

interface RequirementOption {
  id: string;
  requirementDisplayName: string;
}

interface ActiveRequirementSummary {
  isPinned?: boolean;
}

interface Props {
  activeRequirementId: string | null;
  activeRequirement: ActiveRequirementSummary | null;
  options: RequirementOption[];
  onPick: (id: string) => void;
  onPin: () => void;
  onCreate: () => void;
  onDelete: () => void;
}

export function RequirementBoardHeader({
  activeRequirementId,
  activeRequirement,
  options,
  onPick,
  onPin,
  onCreate,
  onDelete,
}: Props) {
  return (
    <div className="app-prd-task-panel__section-title">
      <div className="app-prd-task-panel__section-title-main">
        <span>需求</span>
        <Select
          size="small"
          className="app-prd-task-panel__requirement-select"
          placeholder="选择需求"
          value={activeRequirementId ?? undefined}
          style={{ minWidth: 160, maxWidth: 360 }}
          showSearch
          optionFilterProp="label"
          options={options.map((item) => ({
            value: item.id,
            label: item.requirementDisplayName,
          }))}
          onChange={onPick}
        />
      </div>
      <Space size={4} className="app-prd-task-panel__requirement-title-actions">
        <Button
          type="default"
          size="small"
          className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__requirement-op-btn--pin"
          icon={<PushpinOutlined />}
          disabled={!activeRequirementId}
          onClick={onPin}
        >
          {activeRequirement?.isPinned ? "已置顶" : "置顶"}
        </Button>
        <Button
          size="small"
          className="app-prd-task-panel__requirement-op-btn"
          icon={<PlusOutlined />}
          onClick={onCreate}
        >
          新增
        </Button>
        <Tooltip title="删除当前需求">
          <Button
            type="default"
            danger
            size="small"
            className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__requirement-op-btn--delete"
            icon={<DeleteOutlined />}
            disabled={!activeRequirementId}
            aria-label="删除当前需求"
            onClick={onDelete}
          >
            删除
          </Button>
        </Tooltip>
      </Space>
    </div>
  );
}
