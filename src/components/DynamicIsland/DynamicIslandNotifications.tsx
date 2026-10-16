import type { HudCompletionToastView } from "../../utils/hudCompletionToast";

interface Props {
  toasts: readonly HudCompletionToastView[];
  queuedCount: number;
  onSelect: (sessionId: string, toastId: string) => void;
  onDismiss: (id: string) => void;
}

export function DynamicIslandNotifications({ toasts, queuedCount, onSelect, onDismiss }: Props) {
  return (
    <div className="app-island-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast, index) => (
        <div key={toast.id} className={`app-island-card${toast.kind === "error" ? " app-island-card--error" : ""}${toast.phase === "leaving" ? " app-island-card--leaving" : ""}`}>
          <button type="button" className="app-island-card__open" disabled={toast.phase === "leaving"}
            aria-label={`${toast.title || "会话"}，${toast.kind === "error" ? "执行失败" : "已完成"}，点击查看会话`}
            title={toast.message} onClick={() => onSelect(toast.sessionId, toast.id)}>
            <span className="app-island-card__icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {toast.kind === "success" ? <path d="m5 12 4 4L19 6" /> : <><path d="M12 5v8" /><path d="M12 18h.01" /></>}
              </svg>
            </span>
            <span className="app-island-card__body">
              <span className="app-island-card__heading">
                <span className="app-island-card__title">{toast.title || "会话"}</span>
                <span className="app-island-card__status">{toast.kind === "success" ? "已完成" : "执行失败"}</span>
                {index === 0 && queuedCount > 0 ? <span className="app-island-card__count">+{queuedCount}</span> : null}
              </span>
              <span className="app-island-card__summary">{toast.message}</span>
            </span>
            <span className="app-island-card__arrow" aria-hidden>↗</span>
          </button>
          <button type="button" className="app-island-card__close" aria-label="关闭通知"
            onClick={() => onDismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
