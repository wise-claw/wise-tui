import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

function resolveRepoTreeHoverPath(
  scrollRoot: HTMLElement,
  clientX: number,
  clientY: number,
): string | null {
  const rect = scrollRoot.getBoundingClientRect();
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit || !scrollRoot.contains(hit)) {
    return null;
  }
  const row = hit.closest(".repo-tree-node[data-repo-path]");
  return row?.getAttribute("data-repo-path") ?? null;
}

/**
 * 滚轮滚动时浏览器不会重算 :hover；用指针位置 + scroll 同步「当前行」高亮。
 */
export function useRepositoryExplorerPointerHover(
  scrollRootRef: RefObject<HTMLElement | null>,
  enabled = true,
): string | null {
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const rafRef = useRef(0);

  const syncHover = useCallback(() => {
    if (!enabled) {
      setHoverPath(null);
      return;
    }
    const root = scrollRootRef.current;
    if (!root || !pointerRef.current.inside) {
      setHoverPath(null);
      return;
    }
    const { x, y } = pointerRef.current;
    setHoverPath(resolveRepoTreeHoverPath(root, x, y));
  }, [enabled, scrollRootRef]);

  const scheduleSyncHover = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      syncHover();
    });
  }, [syncHover]);

  useEffect(() => {
    if (!enabled) {
      setHoverPath(null);
      return;
    }
    const el = scrollRootRef.current;
    if (!el) return;

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY, inside: true };
      scheduleSyncHover();
    };
    const onPointerLeave = () => {
      pointerRef.current.inside = false;
      setHoverPath(null);
    };
    const onScroll = () => {
      if (!pointerRef.current.inside) return;
      scheduleSyncHover();
      requestAnimationFrame(() => scheduleSyncHover());
    };

    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [enabled, scheduleSyncHover, scrollRootRef]);

  return hoverPath;
}
