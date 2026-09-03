import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { isLeftSidebarSectionId, type LeftSidebarSectionId } from "../../constants/leftSidebarSectionOrder";
import {
  hasLeftSidebarSectionDragPayload,
  isInteractiveLeftSidebarSectionDragTarget,
  LEFT_SIDEBAR_SECTION_DND_MIME,
  queryLeftSidebarSectionDragHandles,
  sameDragHandleSet,
} from "./leftSidebarSectionDrag";
import "./LeftSidebarSortableSection.css";

export { LEFT_SIDEBAR_SECTION_DND_MIME };

type DropEdge = "before" | "after" | null;

export type LeftSidebarSortableSectionProps = {
  sectionId: LeftSidebarSectionId;
  orderIndex: number;
  disabled?: boolean;
  children: ReactNode;
  onReorder: (fromId: LeftSidebarSectionId, toId: LeftSidebarSectionId, placeAfter: boolean) => void;
};

function LeftSidebarSortableSectionInner({
  sectionId,
  orderIndex,
  disabled = false,
  children,
  onReorder,
}: LeftSidebarSortableSectionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dropEdge, setDropEdge] = useState<DropEdge>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const boundHandlesRef = useRef<HTMLElement[]>([]);
  const unbindHandlesRef = useRef<(() => void) | null>(null);
  const suppressClickByHandleRef = useRef(new WeakMap<HTMLElement, boolean>());

  const clearDropEdge = useCallback(() => setDropEdge(null), []);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) {
      clearDropEdge();
      return;
    }
    draggingRef.current = false;
    setDragging(false);
    rootRef.current?.classList.remove("app-left-sidebar-section--dragging");
    for (const handle of boundHandlesRef.current) {
      handle.draggable = false;
    }
    clearDropEdge();
  }, [clearDropEdge]);

  const rebindHandles = useCallback(() => {
    if (draggingRef.current) return;
    const root = rootRef.current;
    const nextHandles = root && !disabled ? queryLeftSidebarSectionDragHandles(root) : [];
    if (sameDragHandleSet(boundHandlesRef.current, nextHandles) && unbindHandlesRef.current) {
      return;
    }

    unbindHandlesRef.current?.();
    unbindHandlesRef.current = null;
    boundHandlesRef.current = [];
    if (!root || disabled || nextHandles.length === 0) return;

    const cleanups: Array<() => void> = [];
    for (const handle of nextHandles) {
      handle.draggable = false;
      handle.classList.add("app-left-sidebar-section__drag-handle");

      const armDrag = (event: Event) => {
        if (isInteractiveLeftSidebarSectionDragTarget(event.target)) {
          handle.draggable = false;
          return;
        }
        handle.draggable = true;
      };

      const disarmIfIdle = () => {
        if (draggingRef.current) return;
        handle.draggable = false;
      };

      const onDragStart = (event: globalThis.DragEvent) => {
        if (isInteractiveLeftSidebarSectionDragTarget(event.target)) {
          event.preventDefault();
          handle.draggable = false;
          return;
        }
        if (!event.dataTransfer) return;
        suppressClickByHandleRef.current.set(handle, false);
        event.dataTransfer.setData(LEFT_SIDEBAR_SECTION_DND_MIME, sectionId);
        event.dataTransfer.effectAllowed = "move";
        draggingRef.current = true;
        setDragging(true);
        root.classList.add("app-left-sidebar-section--dragging");
      };

      const onDragEnd = () => {
        suppressClickByHandleRef.current.set(handle, true);
        finishDrag();
        window.setTimeout(() => {
          suppressClickByHandleRef.current.set(handle, false);
        }, 0);
      };

      const onClickCapture = (event: MouseEvent) => {
        if (!suppressClickByHandleRef.current.get(handle)) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClickByHandleRef.current.set(handle, false);
      };

      handle.addEventListener("pointerdown", armDrag);
      handle.addEventListener("mousedown", armDrag);
      handle.addEventListener("pointerup", disarmIfIdle);
      handle.addEventListener("pointercancel", disarmIfIdle);
      handle.addEventListener("dragstart", onDragStart);
      handle.addEventListener("dragend", onDragEnd);
      handle.addEventListener("click", onClickCapture, true);
      cleanups.push(() => {
        handle.removeEventListener("pointerdown", armDrag);
        handle.removeEventListener("mousedown", armDrag);
        handle.removeEventListener("pointerup", disarmIfIdle);
        handle.removeEventListener("pointercancel", disarmIfIdle);
        handle.removeEventListener("dragstart", onDragStart);
        handle.removeEventListener("dragend", onDragEnd);
        handle.removeEventListener("click", onClickCapture, true);
        handle.draggable = false;
        handle.removeAttribute("draggable");
        handle.classList.remove("app-left-sidebar-section__drag-handle");
      });
    }

    boundHandlesRef.current = nextHandles;
    unbindHandlesRef.current = () => {
      for (const cleanup of cleanups) cleanup();
      boundHandlesRef.current = [];
    };
  }, [disabled, finishDrag, sectionId]);

  useLayoutEffect(() => {
    rebindHandles();
    return () => {
      unbindHandlesRef.current?.();
      unbindHandlesRef.current = null;
      draggingRef.current = false;
    };
  }, [rebindHandles]);

  // 面板异步挂载标题行（如 Git 工具栏）时补绑拖拽柄；Git 文件列表变更不得拆掉正在进行的拖拽。
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (draggingRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (draggingRef.current) return;
        rebindHandles();
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rebindHandles]);

  // HTML5 dragend 在 WKWebView 里可能丢；Esc / 松开后仍卡住时再清态。
  // pointerup 后延迟回收，避免抢在 drop 之前把 draggable 拆掉。
  useEffect(() => {
    let stuckTimer = 0;
    const onGlobalDragEnd = () => finishDrag();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      finishDrag();
    };
    const onPointerUp = () => {
      if (!draggingRef.current) return;
      window.clearTimeout(stuckTimer);
      stuckTimer = window.setTimeout(() => {
        if (!draggingRef.current) return;
        finishDrag();
      }, 200);
    };
    window.addEventListener("dragend", onGlobalDragEnd);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.clearTimeout(stuckTimer);
      window.removeEventListener("dragend", onGlobalDragEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [finishDrag]);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled || !hasLeftSidebarSectionDragPayload(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      setDropEdge(placeAfter ? "after" : "before");
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      clearDropEdge();
    },
    [clearDropEdge],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled || !hasLeftSidebarSectionDragPayload(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      const fromRaw = event.dataTransfer.getData(LEFT_SIDEBAR_SECTION_DND_MIME);
      const rect = event.currentTarget.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      clearDropEdge();
      if (!isLeftSidebarSectionId(fromRaw) || fromRaw === sectionId) return;
      onReorder(fromRaw, sectionId, placeAfter);
    },
    [clearDropEdge, disabled, onReorder, sectionId],
  );

  const style = { order: orderIndex } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={
        `app-left-sidebar-section app-left-sidebar-section--${sectionId}` +
        (dragging ? " app-left-sidebar-section--dragging" : "") +
        (dropEdge === "before" ? " app-left-sidebar-section--drop-before" : "") +
        (dropEdge === "after" ? " app-left-sidebar-section--drop-after" : "")
      }
      data-section-id={sectionId}
      style={style}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

export const LeftSidebarSortableSection = memo(LeftSidebarSortableSectionInner);
