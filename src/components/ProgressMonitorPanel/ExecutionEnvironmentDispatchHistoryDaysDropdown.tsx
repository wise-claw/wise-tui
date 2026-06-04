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

/**
 * 派发任务历史天数：用原生 select，避免左栏窄宽下 Ant Dropdown/Menu + ResizeObserver 触发无限 setState。
 */
export function ExecutionEnvironmentDispatchHistoryDaysDropdown({
  value,
  disabled = false,
  onChange,
  className = "app-monitor-panel__session-tasks-days",
  dropdownClassName: _dropdownClassName,
  "aria-label": ariaLabel = "派发任务历史天数",
}: ExecutionEnvironmentDispatchHistoryDaysDropdownProps) {
  return (
    <select
      className={`${className} app-monitor-panel__session-tasks-days-trigger app-monitor-panel__session-tasks-days-select`}
      value={String(value)}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => {
        const next = Number(event.target.value) as ExecutionEnvironmentDispatchHistoryDays;
        if (next === value) return;
        void onChange(next);
      }}
    >
      {EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAY_OPTIONS.map((day) => (
        <option key={day} value={String(day)}>
          近 {day} 天
        </option>
      ))}
    </select>
  );
}
