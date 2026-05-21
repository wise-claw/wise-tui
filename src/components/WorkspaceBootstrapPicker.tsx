import { Checkbox, Typography } from "antd";
import {
  WORKSPACE_BOOTSTRAP_PLUGIN_ADDONS,
  WORKSPACE_SCAFFOLD_BOOTSTRAP_OPTIONS,
  patchWorkspaceBootstrapSelection,
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
  const setSelection = (patch: Partial<WorkspaceBootstrapSelection>) => {
    onChange(patchWorkspaceBootstrapSelection(selection, patch));
  };

  return (
    <div className="app-workspace-bootstrap-picker">
      <Typography.Text strong className="app-workspace-bootstrap-picker__title">
        一键内置
      </Typography.Text>
      <div className="app-workspace-bootstrap-picker__groups">
        <div className="app-workspace-bootstrap-picker__group">
          <span className="app-workspace-bootstrap-picker__group-label">根目录</span>
          <div className="app-workspace-bootstrap-picker__options">
            {WORKSPACE_SCAFFOLD_BOOTSTRAP_OPTIONS.map((option) => (
              <Checkbox
                key={option.id}
                className="app-workspace-bootstrap-picker__option"
                checked={selection[option.id]}
                disabled={disabled}
                title={option.title}
                onChange={(event) => setSelection({ [option.id]: event.target.checked })}
              >
                {option.label}
              </Checkbox>
            ))}
          </div>
        </div>
        <div className="app-workspace-bootstrap-picker__group">
          <span className="app-workspace-bootstrap-picker__group-label">Claude</span>
          <div className="app-workspace-bootstrap-picker__options">
            {WORKSPACE_BOOTSTRAP_PLUGIN_ADDONS.map((addon) => (
              <Checkbox
                key={addon.id}
                className="app-workspace-bootstrap-picker__option"
                checked={selection[addon.id]}
                disabled={disabled}
                title={addon.label}
                onChange={(event) => setSelection({ [addon.id]: event.target.checked })}
              >
                {addon.shortLabel}
              </Checkbox>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
