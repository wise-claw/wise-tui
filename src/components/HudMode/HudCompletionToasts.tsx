import type { HudCompletionToastView } from "../../utils/hudCompletionToast";

export interface HudCompletionToastsProps {
  toasts: readonly HudCompletionToastView[];
  queuedCount?: number;
  onDismiss: (id: string) => void;
  onSelect: (toast: HudCompletionToastView) => void;
}

export function HudCompletionToasts({ toasts, queuedCount = 0, onDismiss, onSelect }: HudCompletionToastsProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="app-hud-toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast, index) => (
        <div key={toast.id} className={`app-hud-toast app-hud-toast--${toast.kind}${
          toast.phase === "leaving" ? " app-hud-toast--leaving" : ""
        }`}>
          <button type="button" className="app-hud-toast__open"
            aria-label={`${toast.title || "会话"}，${toast.kind === "success" ? "已完成" : "执行失败"}，点击查看会话`}
            title={toast.message} onClick={() => onSelect(toast)}>
            <span className="app-hud-toast__icon" aria-hidden>{toast.kind === "success" ? "✓" : "!"}</span>
            <span className="app-hud-toast__body">
              <span className="app-hud-toast__heading">
                <span className="app-hud-toast__title">{toast.title || "会话"}</span>
                <span className="app-hud-toast__state">{toast.kind === "success" ? "已完成" : "执行失败"}</span>
                {index === 0 && queuedCount > 0 ? <span className="app-hud-toast__pending">另有 {queuedCount} 条</span> : null}
              </span>
              <span className="app-hud-toast__summary">{toast.message}</span>
            </span>
            <span className="app-hud-toast__arrow" aria-hidden>↗</span>
          </button>
          <button type="button" className="app-hud-toast__close" aria-label="关闭通知"
            onClick={() => onDismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
