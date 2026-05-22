import { Radio } from "antd";

export interface DefaultConfigOptionPickProps<T extends string> {
  value: T;
  disabled?: boolean;
  options: ReadonlyArray<{ label: string; value: T }>;
  onChange: (value: T) => void;
  "aria-label": string;
}

/** 默认配置页：实心按钮式二选一，选中态对比强于 Segmented。 */
export function DefaultConfigOptionPick<T extends string>({
  value,
  disabled,
  options,
  onChange,
  "aria-label": ariaLabel,
}: DefaultConfigOptionPickProps<T>) {
  return (
    <Radio.Group
      className="app-default-config-choice"
      aria-label={ariaLabel}
      size="small"
      optionType="button"
      buttonStyle="solid"
      disabled={disabled}
      value={value}
      options={options.map((item) => ({ label: item.label, value: item.value }))}
      onChange={(event) => onChange(event.target.value as T)}
    />
  );
}
