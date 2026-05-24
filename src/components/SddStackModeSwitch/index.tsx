import { Typography } from "antd";
import {
  SDD_STACK_MODE_OPTIONS,
  sddStackModeLabelForResolvedSddMode,
  type SddStackMode,
} from "../../constants/sddStackMode";
import type { SddMode } from "../../types";
import "./index.css";

interface Props {
  value: SddStackMode;
  autoResolved: SddMode;
  disabled?: boolean;
  onChange: (next: SddStackMode) => void;
  size?: "small" | "middle";
}

export function SddStackModeSwitch({ value, autoResolved, disabled, onChange }: Props) {
  return (
    <div className="app-sdd-stack-mode-container">
      {SDD_STACK_MODE_OPTIONS.map((option) => {
        const isActive = value === option.value;
        const isAuto = option.value === "auto";

        return (
          <div
            key={option.value}
            className={`sdd-stack-mode-card ${isActive ? "sdd-stack-mode-card--active" : ""} ${disabled ? "sdd-stack-mode-card--disabled" : ""}`}
            onClick={() => !disabled && onChange(option.value)}
          >
            {/* Custom Radio Dot Indicator */}
            <div className="sdd-stack-mode-card__indicator">
              <div className="sdd-stack-mode-card__radio-outer">
                <div className="sdd-stack-mode-card__radio-inner" />
              </div>
            </div>

            {/* Title, description and badges */}
            <div className="sdd-stack-mode-card__content">
              <div className="sdd-stack-mode-card__header">
                <Typography.Text className="sdd-stack-mode-card__label" strong={isActive}>
                  {option.label}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary" className="sdd-stack-mode-card__desc">
                {option.description}
              </Typography.Text>

              {isAuto && (
                <div className="sdd-stack-mode-card__auto-badge">
                  当前推断：{sddStackModeLabelForResolvedSddMode(autoResolved)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SddStackModeSwitch;

