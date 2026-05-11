import {
  DownOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Space } from "antd";
import type { MenuProps } from "antd";

interface Props {
  hasInput: boolean;
  parsing: boolean;
  splitStarting: boolean;
  promptActionItems: MenuProps["items"];
  onSaveDraft: () => void;
  onStartSplit: () => void;
}

export function RequirementBoardActions({
  hasInput,
  parsing,
  splitStarting,
  promptActionItems,
  onSaveDraft,
  onStartSplit,
}: Props) {
  return (
    <div className="app-prd-task-panel__actions-row">
      <Space className="app-prd-task-panel__actions-left">
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
