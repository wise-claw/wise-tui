import { useCallback, useEffect, useRef } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  isWiseRepositoryFileDrag,
  peekWiseRepositoryFileDrag,
  getWiseRepositoryFileDragPayload,
} from "../../utils/repositoryFileDrag";
import {
  resolveExplorerMove,
  type ExplorerDropTarget,
  type ExplorerMoveSource,
} from "../../utils/explorerTreeMove";

const DROP_EXPAND_HOVER_MS = 550;
const NODE_DROP_TARGET_CLASS = "repo-tree-node--drop-target";
const ROOT_DROP_TARGET_CLASS = "git-files-explorer-scroll-region--drop-target";

export function readExplorerDropTargetFromEvent(
  event: { target: EventTarget | null },
): ExplorerDropTarget {
  const targetEl = event.target as HTMLElement | null;
  const row = targetEl?.closest("[data-repo-path]") as HTMLElement | null;
  if (!row) {
    return { relativePath: "", isDir: true };
  }
  return {
    relativePath: row.getAttribute("data-repo-path") ?? "",
    isDir: row.getAttribute("data-repo-is-dir") === "1",
  };
}

function sourceFromPeekOrDrop(
  event: ReactDragEvent,
  preferPeek: boolean,
): ExplorerMoveSource | null {
  if (preferPeek) {
    const peeked = peekWiseRepositoryFileDrag();
    if (peeked?.relativePath) {
      return { relativePath: peeked.relativePath, isDir: peeked.isDir === true };
    }
  }
  const payload = getWiseRepositoryFileDragPayload(event);
  if (!payload) {
    return null;
  }
  return { relativePath: payload.relativePath, isDir: payload.isDir === true };
}

function escapeAttrSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findDestDirElement(container: HTMLElement, destDir: string): HTMLElement | null {
  if (!destDir) {
    return null;
  }
  return container.querySelector(
    `[data-repo-path="${escapeAttrSelector(destDir)}"][data-repo-is-dir="1"]`,
  );
}

export function useExplorerTreeDrop(input: {
  enabled: boolean;
  onMove: (fromPath: string, toPath: string, isDir: boolean) => void | Promise<void>;
  onHoverExpandDir?: (dirPath: string) => void;
}): {
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
} {
  const onMoveRef = useRef(input.onMove);
  onMoveRef.current = input.onMove;
  const onHoverExpandDirRef = useRef(input.onHoverExpandDir);
  onHoverExpandDirRef.current = input.onHoverExpandDir;
  const enabledRef = useRef(input.enabled);
  enabledRef.current = input.enabled;

  const highlightedNodeRef = useRef<HTMLElement | null>(null);
  const highlightedRootRef = useRef<HTMLElement | null>(null);
  const expandTimerRef = useRef<number | null>(null);
  const expandPathRef = useRef<string | null>(null);

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current != null) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    expandPathRef.current = null;
  }, []);

  const clearHighlight = useCallback(() => {
    highlightedNodeRef.current?.classList.remove(NODE_DROP_TARGET_CLASS);
    highlightedNodeRef.current = null;
    highlightedRootRef.current?.classList.remove(ROOT_DROP_TARGET_CLASS);
    highlightedRootRef.current = null;
  }, []);

  const resetDropUi = useCallback(() => {
    clearExpandTimer();
    clearHighlight();
  }, [clearExpandTimer, clearHighlight]);

  useEffect(() => {
    return () => {
      resetDropUi();
    };
  }, [resetDropUi]);

  useEffect(() => {
    if (!input.enabled) {
      resetDropUi();
    }
  }, [input.enabled, resetDropUi]);

  const applyHighlight = useCallback(
    (container: HTMLElement, destDir: string, hoveredRow: HTMLElement | null) => {
      if (!destDir) {
        highlightedNodeRef.current?.classList.remove(NODE_DROP_TARGET_CLASS);
        highlightedNodeRef.current = null;
        if (highlightedRootRef.current !== container) {
          highlightedRootRef.current?.classList.remove(ROOT_DROP_TARGET_CLASS);
          container.classList.add(ROOT_DROP_TARGET_CLASS);
          highlightedRootRef.current = container;
        }
        return;
      }
      highlightedRootRef.current?.classList.remove(ROOT_DROP_TARGET_CLASS);
      highlightedRootRef.current = null;
      const destEl = findDestDirElement(container, destDir) ?? hoveredRow;
      if (highlightedNodeRef.current === destEl) {
        return;
      }
      highlightedNodeRef.current?.classList.remove(NODE_DROP_TARGET_CLASS);
      if (destEl) {
        destEl.classList.add(NODE_DROP_TARGET_CLASS);
      }
      highlightedNodeRef.current = destEl;
    },
    [],
  );

  const scheduleExpand = useCallback((dirPath: string) => {
    if (!dirPath || expandPathRef.current === dirPath) {
      return;
    }
    if (expandTimerRef.current != null) {
      window.clearTimeout(expandTimerRef.current);
    }
    expandPathRef.current = dirPath;
    expandTimerRef.current = window.setTimeout(() => {
      expandTimerRef.current = null;
      onHoverExpandDirRef.current?.(dirPath);
    }, DROP_EXPAND_HOVER_MS);
  }, []);

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!enabledRef.current || !isWiseRepositoryFileDrag(event)) {
        return;
      }
      const source = sourceFromPeekOrDrop(event, true);
      if (!source) {
        return;
      }
      const target = readExplorerDropTargetFromEvent(event);
      const plan = resolveExplorerMove(source, target);
      if (plan.kind === "invalid") {
        event.dataTransfer.dropEffect = "none";
        resetDropUi();
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const container = event.currentTarget;
      const hoveredRow = (event.target as HTMLElement | null)?.closest("[data-repo-path]") as
        | HTMLElement
        | null;
      applyHighlight(container, plan.destDir, hoveredRow);
      if (target.isDir && target.relativePath) {
        scheduleExpand(target.relativePath);
      } else {
        clearExpandTimer();
      }
    },
    [applyHighlight, clearExpandTimer, resetDropUi, scheduleExpand],
  );

  const onDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const related = event.relatedTarget as Node | null;
      if (related && event.currentTarget.contains(related)) {
        return;
      }
      resetDropUi();
    },
    [resetDropUi],
  );

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      resetDropUi();
      if (!enabledRef.current || !isWiseRepositoryFileDrag(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const source = sourceFromPeekOrDrop(event, false);
      if (!source) {
        return;
      }
      const target = readExplorerDropTargetFromEvent(event);
      const plan = resolveExplorerMove(source, target);
      if (plan.kind !== "move") {
        return;
      }
      void onMoveRef.current(plan.fromPath, plan.toPath, plan.isDir);
    },
    [resetDropUi],
  );

  return { onDragOver, onDragLeave, onDrop };
}
