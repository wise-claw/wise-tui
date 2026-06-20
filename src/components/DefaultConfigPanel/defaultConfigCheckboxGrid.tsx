import { Checkbox } from "antd";

export interface DefaultConfigCheckboxOption {
  label: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
}

export interface DefaultConfigCheckboxGridProps {
  ariaLabel: string;
  disabled?: boolean;
  options: ReadonlyArray<DefaultConfigCheckboxOption>;
  onToggle: (value: string, checked: boolean) => void;
}

/** 默认配置：多选开关网格（顶栏图标、底栏按钮等）。 */
export function DefaultConfigCheckboxGrid({
  ariaLabel,
  disabled,
  options,
  onToggle,
}: DefaultConfigCheckboxGridProps) {
  return (
    <Checkbox.Group
      className="app-default-config-checkbox-grid"
      aria-label={ariaLabel}
      disabled={disabled}
      value={options.filter((item) => item.checked).map((item) => item.value)}
      options={options.map((item) => ({
        label: item.label,
        value: item.value,
        disabled: item.disabled,
      }))}
      onChange={(values) => {
        const next = new Set(values as string[]);
        for (const option of options) {
          if (option.disabled) continue;
          const checked = next.has(option.value);
          if (checked !== option.checked) onToggle(option.value, checked);
        }
      }}
    />
  );
}
