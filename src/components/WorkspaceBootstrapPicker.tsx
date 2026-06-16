import { Switch, Typography } from "antd";
import { HoverHint } from "./shared/HoverHint";
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
  /** 弹窗等窄空间：单行标题 + 悬停说明，隐藏长描述。 */
  compact?: boolean;
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
  compact = false,
}: WorkspaceBootstrapPickerProps) {
  const wiseLocked = selection.trellis;

  return (
    <div
      className={
        compact
          ? "app-workspace-bootstrap-picker app-workspace-bootstrap-picker--compact"
          : "app-workspace-bootstrap-picker"
      }
    >
      {ROWS.map((row) => {
        const rowDisabled = disabled || (row.key !== "trellis" && wiseLocked);
        const checked =
          row.key === "trellis" ? selection.trellis : selection[row.key];
        const hint =
          row.key !== "trellis" && wiseLocked
            ? `${row.hint} 启用内置 Wise Trellis 时不可用。`
            : row.hint;

        return (
          <div
            key={row.key}
            className={`bootstrap-picker-card ${checked ? "bootstrap-picker-card--active" : ""} ${rowDisabled ? "bootstrap-picker-card--disabled" : ""}${compact ? " bootstrap-picker-card--compact" : ""}`}
            onClick={() => {
              if (!rowDisabled) {
                onChange(row.setEnabled(selection, !checked));
              }
            }}
          >
            <div className="bootstrap-picker-card__indicator">
              <Switch
                size="small"
                checked={checked}
                disabled={rowDisabled}
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
                  <HoverHint title={hint}>
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
                <Typography.Text className="bootstrap-picker-card__desc">
                  {row.hint}
                  {row.key !== "trellis" && wiseLocked ? (
                    <span className="bootstrap-picker-card__desc-warning">
                      {" "}启用内置 Wise Trellis 时不可用。
                    </span>
                  ) : null}
                </Typography.Text>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default WorkspaceBootstrapPicker;

