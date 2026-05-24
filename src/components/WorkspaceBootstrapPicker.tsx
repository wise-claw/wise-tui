import { Switch, Typography } from "antd";
import {
  setWiseTrellisBootstrapEnabled,
  setWorkspaceBootstrapAddonEnabled,
  type WorkspaceBootstrapSelection,
} from "../constants/workspaceBootstrapAddons";
import "./WorkspaceBootstrapPicker.css";

export interface WorkspaceBootstrapPickerProps {
  selection: WorkspaceBootstrapSelection;
  onChange: (value: WorkspaceBootstrapSelection) => void;
  disabled?: boolean;
}

const ROWS = [
  {
    key: "trellis" as const,
    title: "内置 Wise Trellis",
    hint: "创建 .trellis，并启用 PRD 拆分、任务编排、规范反哺和 Workspace 主会话。",
    setEnabled: setWiseTrellisBootstrapEnabled,
  },
  {
    key: "trellisInit" as const,
    title: "Trellis",
    hint: "在仓库根目录执行 trellis init，写入 .trellis/；不启用 Wise 全套 SDD 入口。",
    setEnabled: (prev: WorkspaceBootstrapSelection, enabled: boolean) =>
      setWorkspaceBootstrapAddonEnabled(prev, "trellisInit", enabled),
  },
  {
    key: "omc" as const,
    title: "oh-my-claudecode",
    hint: "安装 OMC 插件，启用多智能体编排与自然语言工作流；可与 Trellis 初始化组合。",
    setEnabled: (prev: WorkspaceBootstrapSelection, enabled: boolean) =>
      setWorkspaceBootstrapAddonEnabled(prev, "omc", enabled),
  },
 ] as const;

export function WorkspaceBootstrapPicker({
  selection,
  onChange,
  disabled = false,
}: WorkspaceBootstrapPickerProps) {
  const wiseLocked = selection.trellis;

  return (
    <div className="app-workspace-bootstrap-picker">
      {ROWS.map((row) => {
        const rowDisabled = disabled || (row.key !== "trellis" && wiseLocked);
        const checked =
          row.key === "trellis" ? selection.trellis : selection[row.key];

        return (
          <div
            key={row.key}
            className={`bootstrap-picker-card ${checked ? "bootstrap-picker-card--active" : ""} ${rowDisabled ? "bootstrap-picker-card--disabled" : ""}`}
            onClick={() => {
              if (!rowDisabled) {
                onChange(row.setEnabled(selection, !checked));
              }
            }}
          >
            {/* Left Switch Indicator */}
            <div className="bootstrap-picker-card__indicator">
              <Switch
                size="small"
                checked={checked}
                disabled={rowDisabled}
                onChange={(enabled) => {
                  onChange(row.setEnabled(selection, enabled));
                }}
                onClick={(_, event) => {
                  // Prevent double toggling from card click
                  event.stopPropagation();
                }}
              />
            </div>

            {/* Title & Description */}
            <div className="bootstrap-picker-card__content">
              <div className="bootstrap-picker-card__header">
                <Typography.Text className="bootstrap-picker-card__label" strong={checked}>
                  {row.title}
                </Typography.Text>
              </div>
              <Typography.Text className="bootstrap-picker-card__desc">
                {row.hint}
                {row.key !== "trellis" && wiseLocked ? (
                  <span className="bootstrap-picker-card__desc-warning">
                    {" "}启用内置 Wise Trellis 时不可用。
                  </span>
                ) : null}
              </Typography.Text>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default WorkspaceBootstrapPicker;

