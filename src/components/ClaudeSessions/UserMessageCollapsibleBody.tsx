import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/** 主会话用户消息：默认限制高度，过长时提供展开/收起。 */
export function UserMessageCollapsibleBody({ children }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (expanded) {
      setOverflows(false);
      return;
    }
    const el = bodyRef.current;
    if (!el) return;

    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [expanded, children]);

  return (
    <div
      className={`app-claude-user-message-collapsible${
        expanded ? " app-claude-user-message-collapsible--expanded" : ""
      }`}
    >
      <div ref={bodyRef} className="app-claude-user-message-collapsible__body">
        {children}
      </div>
      {overflows && !expanded ? (
        <button
          type="button"
          className="app-claude-user-message-collapsible__toggle"
          onClick={() => setExpanded(true)}
        >
          展开全文
        </button>
      ) : null}
      {expanded ? (
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
