import type { HudCompletionToastView } from "../../utils/hudCompletionToast";

export interface HudCompletionToastsProps {
  toasts: readonly HudCompletionToastView[];
  onDismiss: (id: string) => void;
}

export function HudCompletionToasts({ toasts, onDismiss }: HudCompletionToastsProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="app-hud-toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`app-hud-toast app-hud-toast--${toast.kind}${
            toast.phase === "leaving" ? " app-hud-toast--leaving" : ""
          }`}
          aria-label={`${toast.message}，点击关闭`}
          title="点击关闭"
          onClick={() => onDismiss(toast.id)}
        >
          <span className="app-hud-toast__message">{toast.message}</span>
        </button>
      ))}
    </div>
  );
}
