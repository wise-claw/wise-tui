import type { ReactNode } from "react";

export interface UsagePillOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

interface UsagePillGroupProps<T extends string> {
  value: T;
  options: readonly UsagePillOption<T>[];
  onChange: (value: T) => void;
  size?: "md" | "sm";
  ariaLabel: string;
  className?: string;
}

export function UsagePillGroup<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
  className,
}: UsagePillGroupProps<T>) {
  return (
    <div
      className={`app-cc-usage-pills app-cc-usage-pills--${size}${className ? ` ${className}` : ""}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`app-cc-usage-pill${active ? " app-cc-usage-pill--active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <span className="app-cc-usage-pill__icon">{option.icon}</span> : null}
            <span className="app-cc-usage-pill__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
