import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { REPOSITORY_TREE_ROW_HEIGHT_PX } from "../components/GitPanel/repositoryTreeLayout";

/**
 * 从事件目标向上查找树节点的 data-repo-path，避免 elementFromPoint 触发 reflow。
 * 滚动时则用行高 + scrollTop 计算行索引，从 rowRef 映射到路径。
 */
function resolvePathFromTarget(scrollRoot: HTMLElement, target: EventTarget | null): string | null {
  if (!target || !(target instanceof Element)) return null;
  const row = target.closest(".repo-tree-node[data-repo-path]");
  if (!row) return null;
  if (!scrollRoot.contains(row)) return null;
  return row.getAttribute("data-repo-path") ?? null;
}

/**
 * 滚轮滚动时浏览器不会重算 :hover；用指针位置 + scroll 同步「当前行」高亮。
 * pointermove 从事件目标直接取路径（避免 elementFromPoint reflow），
 * scroll 从行索引映射到路径。
 */
export function useRepositoryExplorerPointerHover(
  scrollRootRef: RefObject<HTMLElement | null>,
  enabled = true,
  rowRef?: RefObject<readonly { key: string; node?: { readonly path: string } }[] | null>,
): string | null {
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const rafRef = useRef(0);

  const syncHoverFromPosition = useCallback(() => {
    if (!enabled) {
      setHoverPath(null);
      return;
    }
    const root = scrollRootRef.current;
    if (!root || !pointerRef.current.inside) {
      setHoverPath(null);
      return;
    }
    // scroll 期间优先用行索引计算，不触发 reflow
    const rows = rowRef?.current;
    if (rows && rows.length > 0) {
      const rect = root.getBoundingClientRect();
      const { y } = pointerRef.current;
      if (y < rect.top || y > rect.bottom) {
        setHoverPath(null);
        return;
      }
      const relativeY = y - rect.top + root.scrollTop;
      const rowIndex = Math.floor(relativeY / REPOSITORY_TREE_ROW_HEIGHT_PX);
      if (rowIndex >= 0 && rowIndex < rows.length) {
        const row = rows[rowIndex];
        const path = row.node?.path;
        if (path) {
          setHoverPath(path);
          return;
        }
      }
      setHoverPath(null);
      return;
    }
    // 无行数据时退回目标查找
    setHoverPath(null);
  }, [enabled, rowRef, scrollRootRef]);

  const syncHoverFromTarget = useCallback(
    (target: EventTarget | null) => {
      if (!enabled) {
        setHoverPath(null);
        return;
      }
      const root = scrollRootRef.current;
      if (!root) {
        setHoverPath(null);
        return;
      }
      setHoverPath(resolvePathFromTarget(root, target));
    },
    [enabled, scrollRootRef],
  );

  useEffect(() => {
    if (!enabled) {
      setHoverPath(null);
      return;
    }
    const el = scrollRootRef.current;
    if (!el) return;

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY, inside: true };
      syncHoverFromTarget(event.target);
    };
    const onPointerLeave = () => {
      pointerRef.current.inside = false;
      setHoverPath(null);
    };
    const onScroll = () => {
      if (!pointerRef.current.inside) return;
      // 滚动时用位置计算而非 elementFromPoint
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        syncHoverFromPosition();
      });
      requestAnimationFrame(() => {
        syncHoverFromPosition();
      });
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
  }, [enabled, scrollRootRef, syncHoverFromPosition, syncHoverFromTarget]);

  return hoverPath;
}