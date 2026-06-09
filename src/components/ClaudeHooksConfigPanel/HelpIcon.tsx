import { HoverHint } from "../shared/HoverHint";

export function HelpIcon({ text, className }: { text: string; className?: string }) {
  return (
    <HoverHint title={text} placement="topLeft">
      <span className={`app-hooks-flow-help-icon ${className ?? ""}`.trim()} aria-label="查看该事件说明">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M6.4 5.9c0-1 0.82-1.7 1.9-1.7 1.05 0 1.85 0.64 1.85 1.62 0 0.68-0.35 1.13-1.03 1.58-0.69 0.46-0.92 0.73-0.92 1.35v0.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="8.2" cy="11.7" r="0.8" fill="currentColor" />
        </svg>
      </span>
    </HoverHint>
  );
}
