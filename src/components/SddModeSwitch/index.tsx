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
  { label: "内置 Trellis", value: "wise_trellis", description: "由 Wise 接管 .trellis 任务与产出" },
  { label: "项目自带", value: "project_owned", description: "仓库已自带 SDD，Wise 仅派发不写文件" },
  { label: "关闭", value: "off", description: "禁用 trellis-team 派发" },
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
