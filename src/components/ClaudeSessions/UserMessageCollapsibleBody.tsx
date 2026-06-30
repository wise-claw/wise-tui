import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 为 false 时不做高度折叠（如已展开「原始输入」时避免与其叠加两个展开按钮）。 */
  collapsible?: boolean;
}

/** 主会话用户消息：默认限制高度，过长时提供展开/收起。 */
export function UserMessageCollapsibleBody({ children, collapsible = true }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (!collapsible || expanded) {
      setOverflows((prev) => (prev ? false : prev));
      return;
    }
    const el = bodyRef.current;
    if (!el) return;

    let rafId = 0;
    const measure = () => {
      const nextOverflows = el.scrollHeight > el.clientHeight + 1;
      setOverflows((prev) => (prev === nextOverflows ? prev : nextOverflows));
    };
    const scheduleMeasure = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    observer?.observe(el);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [collapsible, expanded]);

  const effectiveExpanded = !collapsible || expanded;

  return (
    <div
      className={`app-claude-user-message-collapsible${
        effectiveExpanded ? " app-claude-user-message-collapsible--expanded" : ""
      }`}
    >
      <div ref={bodyRef} className="app-claude-user-message-collapsible__body">
        {children}
      </div>
      {collapsible && overflows && !expanded ? (
        <button
          type="button"
          className="app-claude-user-message-collapsible__toggle"
          onClick={() => setExpanded(true)}
        >
          展开全文
        </button>
      ) : null}
      {collapsible && expanded ? (
        <button
          type="button"
          className="app-claude-user-message-collapsible__toggle"
          onClick={() => setExpanded(false)}
        >
          收起
        </button>
      ) : null}
    </div>
  );
}
