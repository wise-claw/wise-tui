import { Switch, Typography } from "antd";
import { HoverHint } from "./shared/HoverHint";
import {
  setWorkspaceBootstrapAddonEnabled,
  type WorkspaceBootstrapSelection,
} from "../constants/workspaceBootstrapAddons";
import "./WorkspaceBootstrapPicker.css";

export interface WorkspaceBootstrapPickerProps {
  selection: WorkspaceBootstrapSelection;
  onChange: (value: WorkspaceBootstrapSelection) => void;
  disabled?: boolean;
  /** 弹窗等窄空间：单行标题 + 悬停说明，隐藏长描述。 */
  compact?: boolean;
}

const ROWS = [
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
  compact = false,
}: WorkspaceBootstrapPickerProps) {
  return (
    <div
      className={
        compact
          ? "app-workspace-bootstrap-picker app-workspace-bootstrap-picker--compact"
          : "app-workspace-bootstrap-picker"
      }
    >
      {ROWS.map((row) => {
        const checked = selection[row.key];

        return (
          <div
            key={row.key}
            className={`bootstrap-picker-card ${checked ? "bootstrap-picker-card--active" : ""} ${disabled ? "bootstrap-picker-card--disabled" : ""}${compact ? " bootstrap-picker-card--compact" : ""}`}
            onClick={() => {
              if (!disabled) {
                onChange(row.setEnabled(selection, !checked));
              }
            }}
          >
            <div className="bootstrap-picker-card__indicator">
              <Switch
                size="small"
                checked={checked}
                disabled={disabled}
                onChange={(enabled) => {
                  onChange(row.setEnabled(selection, enabled));
                }}
                onClick={(_, event) => {
                  event.stopPropagation();
                }}
              />
            </div>

            <div className="bootstrap-picker-card__content">
              <div className="bootstrap-picker-card__header">
                {compact ? (
                  <HoverHint title={row.hint}>
                    <Typography.Text className="bootstrap-picker-card__label" strong={checked}>
                      {row.title}
                    </Typography.Text>
                  </HoverHint>
                ) : (
                  <Typography.Text className="bootstrap-picker-card__label" strong={checked}>
                    {row.title}
                  </Typography.Text>
                )}
              </div>
              {!compact ? (
                <Typography.Text className="bootstrap-picker-card__desc">{row.hint}</Typography.Text>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default WorkspaceBootstrapPicker;
