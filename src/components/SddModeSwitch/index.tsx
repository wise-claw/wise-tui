import { Segmented, Tooltip, Typography } from "antd";
import type { SddMode } from "../../types";
import "./index.css";

interface SddModeOption {
  label: string;
  value: SddMode;
  description: string;
}

const OPTIONS: readonly SddModeOption[] = [
  { label: "自动", value: "auto", description: "按仓库内的 .trellis / .openspec / .spec 信号自动选择" },
  { label: "Wise Trellis", value: "wise_trellis", description: "由 Wise 读取或初始化 .trellis，并启用需求、任务与规范入口" },
  { label: "自有 SDD", value: "project_owned", description: "仓库使用 OpenSpec 或其它自有 SDD，Wise 保留 Claude Code 会话能力" },
  { label: "关闭", value: "off", description: "隐藏 Wise Trellis 入口，仅作为 Claude Code 工作目录使用" },
];

interface Props {
  value: SddMode;
  autoResolved: SddMode;
  disabled?: boolean;
  onChange: (next: SddMode) => void;
  size?: "small" | "middle";
}

function labelForMode(mode: SddMode): string {
  return OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function SddModeSwitch({ value, autoResolved, disabled, onChange, size = "middle" }: Props) {
  const items = OPTIONS.map((option) => ({
    value: option.value,
    label: (
      <Tooltip title={option.description} placement="bottom">
        <span>{option.label}</span>
      </Tooltip>
    ),
  }));
  const showHint = value === "auto";
  return (
    <div className="app-sdd-mode-switch">
      <Segmented
        size={size}
        options={items}
        value={value}
        disabled={disabled}
        onChange={(next) => onChange(next as SddMode)}
      />
      {showHint ? (
        <Typography.Text type="secondary" className="app-sdd-mode-switch-hint">
          当前推断：{labelForMode(autoResolved)}
        </Typography.Text>
      ) : null}
    </div>
  );
}

export default SddModeSwitch;
