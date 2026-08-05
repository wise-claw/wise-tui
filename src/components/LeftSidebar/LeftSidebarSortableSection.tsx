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
import {
  isLeftSidebarSectionId,
  type LeftSidebarSectionId,
} from "../../constants/leftSidebarSectionOrder";
import "./LeftSidebarSortableSection.css";

export const LEFT_SIDEBAR_SECTION_DND_MIME = "application/x-wise-left-sidebar-section";

const HANDLE_SELECTOR = [
  ":scope > .app-repository-header",
  ":scope > .app-left-sidebar-workspace-list-collapsed-row",
  ":scope > .app-left-sidebar-requirements-panel > .app-repository-header",
  ":scope > .app-left-sidebar-monitor-panel .app-monitor-panel__head",
  ":scope > .app-left-sidebar-bottom-tabs .app-left-sidebar-repo-panel-header",
  ":scope > .app-left-sidebar-bottom-tabs .git-panel-header",
  ":scope > .app-left-sidebar-bottom-tabs .git-files-explorer-bar",
].join(", ");

const INTERACTIVE_CLOSEST =
  "button, a, input, textarea, select, .app-repository-header-btn, .ant-btn";

type DropEdge = "before" | "after" | null;

export type LeftSidebarSortableSectionProps = {
  sectionId: LeftSidebarSectionId;
  orderIndex: number;
  disabled?: boolean;
  children: ReactNode;
  onReorder: (fromId: LeftSidebarSectionId, toId: LeftSidebarSectionId, placeAfter: boolean) => void;
};

function hasSectionDragPayload(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(LEFT_SIDEBAR_SECTION_DND_MIME);
}

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

  const clearDropEdge = useCallback(() => setDropEdge(null), []);
  const unbindHandlesRef = useRef<(() => void) | null>(null);

  const rebindHandles = useCallback(() => {
    unbindHandlesRef.current?.();
    unbindHandlesRef.current = null;
    const root = rootRef.current;
    if (!root || disabled) return;

    const handles = Array.from(root.querySelectorAll(HANDLE_SELECTOR)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    if (handles.length === 0) return;

    const cleanups: Array<() => void> = [];
    for (const handle of handles) {
      handle.draggable = true;
      handle.classList.add("app-left-sidebar-section__drag-handle");
      let suppressClick = false;

      const onDragStart = (event: globalThis.DragEvent) => {
        const target = event.target;
        if (target instanceof Element && target.closest(INTERACTIVE_CLOSEST)) {
          event.preventDefault();
          return;
        }
        if (!event.dataTransfer) return;
        suppressClick = false;
        event.dataTransfer.setData(LEFT_SIDEBAR_SECTION_DND_MIME, sectionId);
        event.dataTransfer.effectAllowed = "move";
        setDragging(true);
        root.classList.add("app-left-sidebar-section--dragging");
      };

      const onDragEnd = () => {
        setDragging(false);
        root.classList.remove("app-left-sidebar-section--dragging");
        clearDropEdge();
        // 拖拽结束后浏览器常会补一次 click，避免误触折叠标题。
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
      };

      const onClickCapture = (event: MouseEvent) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      };

      handle.addEventListener("dragstart", onDragStart);
      handle.addEventListener("dragend", onDragEnd);
      handle.addEventListener("click", onClickCapture, true);
      cleanups.push(() => {
        handle.removeEventListener("dragstart", onDragStart);
        handle.removeEventListener("dragend", onDragEnd);
        handle.removeEventListener("click", onClickCapture, true);
        handle.removeAttribute("draggable");
        handle.classList.remove("app-left-sidebar-section__drag-handle");
      });
    }

    unbindHandlesRef.current = () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [clearDropEdge, disabled, sectionId]);

  useLayoutEffect(() => {
    rebindHandles();
    return () => {
      unbindHandlesRef.current?.();
      unbindHandlesRef.current = null;
    };
  }, [rebindHandles, children]);

  // 面板异步挂载标题行（如 Git 工具栏）时补绑拖拽柄。
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => rebindHandles());
    });
    observer.observe(root, { childList: true, subtree: false });
    const nested = root.firstElementChild;
    if (nested) {
      observer.observe(nested, { childList: true, subtree: true });
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rebindHandles]);
  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled || !hasSectionDragPayload(event.dataTransfer)) return;
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
      if (disabled || !hasSectionDragPayload(event.dataTransfer)) return;
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
