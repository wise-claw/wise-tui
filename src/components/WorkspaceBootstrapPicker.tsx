import { Switch, Typography } from "antd";
import {
  setWiseTrellisBootstrapEnabled,
  type WorkspaceBootstrapSelection,
} from "../constants/workspaceBootstrapAddons";
import "./WorkspaceBootstrapPicker.css";

export interface WorkspaceBootstrapPickerProps {
  selection: WorkspaceBootstrapSelection;
  onChange: (value: WorkspaceBootstrapSelection) => void;
  disabled?: boolean;
}

export function WorkspaceBootstrapPicker({
  selection,
  onChange,
  disabled = false,
}: WorkspaceBootstrapPickerProps) {
  return (
    <div className="app-workspace-bootstrap-picker">
      <div className="app-workspace-bootstrap-picker__row">
        <Switch
          size="small"
          checked={selection.trellis}
          disabled={disabled}
          onChange={(checked) => {
            onChange(setWiseTrellisBootstrapEnabled(selection, checked));
          }}
        />
        <div className="app-workspace-bootstrap-picker__copy">
          <Typography.Text strong className="app-workspace-bootstrap-picker__title">
            启用 Wise Trellis
          </Typography.Text>
          <Typography.Text className="app-workspace-bootstrap-picker__hint">
            创建 .trellis，并启用 PRD 拆分、任务编排、规范反哺和 Workspace 主会话。关闭后仅作为 Claude Code 工作目录使用。
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
