import { DownOutlined } from "@ant-design/icons";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS,
  type ExecutionEnvironmentDispatchHistoryDays,
} from "../../constants/executionEnvironmentDispatch";

export type ExecutionEnvironmentDispatchHistoryDaysDropdownProps = {
  value: ExecutionEnvironmentDispatchHistoryDays;
  disabled?: boolean;
  onChange: (days: ExecutionEnvironmentDispatchHistoryDays) => void | Promise<void>;
  className?: string;
  dropdownClassName?: string;
  "aria-label"?: string;
};

export function ExecutionEnvironmentDispatchHistoryDaysDropdown({
  value,
  disabled = false,
  onChange,
  className = "app-monitor-panel__session-tasks-days",
  dropdownClassName = "app-monitor-panel__session-tasks-days-dropdown",
  "aria-label": ariaLabel = "派发任务历史天数",
}: ExecutionEnvironmentDispatchHistoryDaysDropdownProps) {
  const menuItems: MenuProps["items"] = EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS.map((day) => ({
    key: String(day),
    label: `近 ${day} 天`,
  }));

  return (
    <Dropdown
      rootClassName={dropdownClassName}
      disabled={disabled}
      trigger={["click"]}
      placement="bottomRight"
      menu={{
        items: menuItems,
        selectable: true,
        selectedKeys: [String(value)],
        onClick: ({ key }) => {
          const next = Number(key);
          if (next === value) return;
          void onChange(next as ExecutionEnvironmentDispatchHistoryDays);
        },
      }}
    >
      <button
        type="button"
        className={`${className} app-monitor-panel__session-tasks-days-trigger`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
      >
        <span className="app-monitor-panel__session-tasks-days-trigger-label">近 {value} 天</span>
        <DownOutlined className="app-monitor-panel__session-tasks-days-trigger-icon" aria-hidden />
      </button>
    </Dropdown>
  );
}
