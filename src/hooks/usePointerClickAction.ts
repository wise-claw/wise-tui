import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { createPointerClickGate } from "../utils/pointerClickGate";

/**
 * 按钮同时挂 pointerdown（避免抢焦点后丢失 click）与 click（键盘 / WKWebView 回退），
 * 同一手势只执行一次 action。blocked 期间保持锁定，例如「正在创建会话」。
 */
export function usePointerClickAction(
  action: () => void,
  blocked = false,
): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
} {
  const actionRef = useRef(action);
  actionRef.current = action;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const gateRef = useRef<ReturnType<typeof createPointerClickGate> | null>(null);
  if (gateRef.current == null) {
    gateRef.current = createPointerClickGate({ isBlocked: () => blockedRef.current });
  }

  useEffect(() => {
    if (!blocked) gateRef.current?.reset();
  }, [blocked]);

  useEffect(() => () => gateRef.current?.reset(), []);

  const run = useCallback(() => {
    gateRef.current?.tryInvoke(() => {
      actionRef.current();
    });
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      run();
    },
    [run],
  );

  return { onPointerDown, onClick: run };
}
