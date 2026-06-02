import { List } from "antd";
import { memo, useCallback, useRef, type DragEvent } from "react";
import type { ClaudeModelProfile } from "../../types/claudeModelProfile";
import { ModelProfileListRow } from "./ModelProfileListRow";

const DRAGGING_CLASS = "app-claude-model-topbar-panel__item--dragging";
const DRAG_OVER_CLASS = "app-claude-model-topbar-panel__item--drag-over";

interface Props {
  profiles: ClaudeModelProfile[];
  activeProfileId: string | null;
  applyingProfileId: string | null;
  sortable: boolean;
  reordering: boolean;
  loading: boolean;
  onApply: (profileId: string) => void;
  onConfigure: (profile: ClaudeModelProfile) => void;
  onDelete: (profileId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function itemElement(root: HTMLElement | null, index: number): HTMLElement | null {
  return root?.querySelector(`[data-profile-index="${index}"]`) ?? null;
}

function ModelProfileSortableListInner({
  profiles,
  activeProfileId,
  applyingProfileId,
  sortable,
  reordering,
  loading,
  onApply,
  onConfigure,
  onDelete,
  onReorder,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragSourceIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);

  const clearDragVisuals = useCallback(() => {
    const root = listRef.current;
    const source = dragSourceIndexRef.current;
    const over = dragOverIndexRef.current;
    if (source != null) {
      itemElement(root, source)?.classList.remove(DRAGGING_CLASS);
    }
    if (over != null) {
      itemElement(root, over)?.classList.remove(DRAG_OVER_CLASS);
    }
    dragSourceIndexRef.current = null;
    dragOverIndexRef.current = null;
  }, []);

  const handleDragHandleStart = useCallback(
    (index: number, profileId: string, event: DragEvent<HTMLSpanElement>) => {
      if (!sortable || reordering) return;
      dragSourceIndexRef.current = index;
      itemElement(listRef.current, index)?.classList.add(DRAGGING_CLASS);
      event.dataTransfer.setData("text/plain", profileId);
      event.dataTransfer.effectAllowed = "move";
    },
    [reordering, sortable],
  );

  const handleRowDragOver = useCallback(
    (index: number, event: DragEvent<HTMLDivElement>) => {
      if (!sortable || dragSourceIndexRef.current == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const prevOver = dragOverIndexRef.current;
      if (prevOver === index) return;
      if (prevOver != null) {
        itemElement(listRef.current, prevOver)?.classList.remove(DRAG_OVER_CLASS);
      }
      dragOverIndexRef.current = index;
      itemElement(listRef.current, index)?.classList.add(DRAG_OVER_CLASS);
    },
    [sortable],
  );

  const handleRowDrop = useCallback(
    (index: number, event: DragEvent<HTMLDivElement>) => {
      if (!sortable) return;
      event.preventDefault();
      const fromIndex = dragSourceIndexRef.current;
      clearDragVisuals();
      if (fromIndex != null) {
        onReorder(fromIndex, index);
      }
    },
    [clearDragVisuals, onReorder, sortable],
  );

  const handleRowDragLeave = useCallback((index: number) => {
    if (dragOverIndexRef.current !== index) return;
    itemElement(listRef.current, index)?.classList.remove(DRAG_OVER_CLASS);
    dragOverIndexRef.current = null;
  }, []);

  return (
    <div ref={listRef} className="app-claude-model-topbar-panel__list-wrap">
      <List
        size="small"
        className="app-claude-model-topbar-panel__list"
        dataSource={profiles}
        loading={loading}
        rowKey="id"
        renderItem={(item, index) => (
          <ModelProfileListRow
            item={item}
            index={index}
            active={activeProfileId === item.id}
            applying={applyingProfileId === item.id}
            sortable={sortable}
            reordering={reordering}
            onApply={onApply}
            onConfigure={onConfigure}
            onDelete={onDelete}
            onDragHandleStart={(event) => handleDragHandleStart(index, item.id, event)}
            onDragHandleEnd={clearDragVisuals}
            onRowDragOver={(event) => handleRowDragOver(index, event)}
            onRowDrop={(event) => handleRowDrop(index, event)}
            onRowDragLeave={() => handleRowDragLeave(index)}
          />
        )}
      />
    </div>
  );
}

export const ModelProfileSortableList = memo(ModelProfileSortableListInner);
