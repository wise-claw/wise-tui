import { Cron } from "react-js-cron";
import { CronExpressionParser } from "cron-parser";
import { useMemo } from "react";
import { SCHEDULE_CRON_LOCALE_ZH } from "./cronLocaleZh";
import "react-js-cron/styles.css";

const FALLBACK_CRON = "0 9 * * *";

/** 仅使用 5 段编辑；若历史数据为 6 段则去掉首段「秒」再展示与回写。 */
function toFiveFieldCron(expression: string): string {
  const parts = expression.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 6) {
    return parts.slice(1).join(" ");
  }
  if (parts.length === 5) {
    return parts.join(" ");
  }
  return FALLBACK_CRON;
}

interface Props {
  value?: string;
  onChange?: (v: string) => void;
}

/**
 * 供 Ant Design `Form.Item` 使用：`value` / `onChange` 与 `react-js-cron` 的 `value` / `setValue` 桥接（仅 5 段）。
 */
export function ScheduledTaskCronField({ value, onChange }: Props) {
  const { displayValue, invalid } = useMemo(() => {
    const raw = value?.trim() ?? "";
    const five = raw ? toFiveFieldCron(raw) : FALLBACK_CRON;
    try {
      CronExpressionParser.parse(five, { currentDate: new Date() });
      return { displayValue: five, invalid: false };
    } catch {
      return { displayValue: FALLBACK_CRON, invalid: true };
    }
  }, [value]);

  return (
    <div className="app-scheduled-tasks-drawer__cron">
      <Cron
        className="app-scheduled-tasks-cron-editor"
        value={displayValue}
        setValue={(next: string) => onChange?.(next)}
        clockFormat="24-hour-clock"
        locale={SCHEDULE_CRON_LOCALE_ZH}
        leadingZero={["month-days", "hours", "minutes"]}
        shortcuts={false}
        humanizeLabels
        humanizeValue={false}
        clearButton={false}
        allowEmpty="never"
        displayError={invalid}
      />
    </div>
  );
}
