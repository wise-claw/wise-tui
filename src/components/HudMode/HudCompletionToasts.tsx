import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  resolveHudToastMarqueeDurationSec,
  type HudCompletionToastView,
} from "../../utils/hudCompletionToast";

export interface HudCompletionToastsProps {
  toasts: readonly HudCompletionToastView[];
  onDismiss: (id: string) => void;
}

function HudToastScrollingMessage({ message }: { message: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [marquee, setMarquee] = useState<{
    distance: number;
    durationSec: number;
  } | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;

    const measure = () => {
      const overflow = text.scrollWidth - viewport.clientWidth;
      const durationSec = resolveHudToastMarqueeDurationSec(overflow);
      if (durationSec <= 0) {
        setMarquee(null);
        return;
      }
      setMarquee({
        distance: overflow,
        durationSec,
      });
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(viewport);
    observer?.observe(text);
    return () => observer?.disconnect();
  }, [message]);

  const marqueeStyle = marquee
    ? ({
        "--app-hud-toast-marquee-distance": `-${marquee.distance}px`,
        "--app-hud-toast-marquee-duration": `${marquee.durationSec}s`,
      } as CSSProperties)
    : undefined;

  return (
    <span ref={viewportRef} className="app-hud-toast__message-viewport">
      <span
        ref={textRef}
        className={`app-hud-toast__message${marquee ? " app-hud-toast__message--marquee" : ""}`}
        style={marqueeStyle}
      >
        {message}
      </span>
    </span>
  );
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
          title={toast.message}
          onClick={() => onDismiss(toast.id)}
        >
          <HudToastScrollingMessage message={toast.message} />
        </button>
      ))}
    </div>
  );
}
