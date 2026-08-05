import { useCallback, useEffect, useState } from "react";
import {
  LEFT_SIDEBAR_SECTION_ORDER_DEFAULT,
  normalizeLeftSidebarSectionOrder,
  reorderLeftSidebarSectionByDrop,
  type LeftSidebarSectionId,
} from "../constants/leftSidebarSectionOrder";
import {
  loadLeftSidebarSectionOrderFromStore,
  saveLeftSidebarSectionOrderToStore,
  WISE_LEFT_SIDEBAR_SECTION_ORDER_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏分区纵向顺序（可拖拽重排，持久化在默认配置）。 */
export function useLeftSidebarSectionOrder(): LeftSidebarSectionId[] {
  const [order, setOrder] = useState<LeftSidebarSectionId[]>([
    ...LEFT_SIDEBAR_SECTION_ORDER_DEFAULT,
  ]);

  const apply = useCallback((next: LeftSidebarSectionId[]) => {
    setOrder(normalizeLeftSidebarSectionOrder(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLeftSidebarSectionOrderFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ leftSidebarSectionOrder?: LeftSidebarSectionId[] }>)
        .detail?.leftSidebarSectionOrder;
      if (next) apply(next);
    };
    window.addEventListener(WISE_LEFT_SIDEBAR_SECTION_ORDER_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_LEFT_SIDEBAR_SECTION_ORDER_CHANGED, onChanged);
    };
  }, [apply]);

  return order;
}

/** 拖放后写出新顺序（失败时由调用方提示）。 */
export async function persistLeftSidebarSectionReorder(
  currentOrder: readonly LeftSidebarSectionId[],
  fromId: LeftSidebarSectionId,
  toId: LeftSidebarSectionId,
  placeAfter: boolean,
): Promise<LeftSidebarSectionId[]> {
  const next = reorderLeftSidebarSectionByDrop(currentOrder, fromId, toId, placeAfter);
  if (JSON.stringify(next) === JSON.stringify(normalizeLeftSidebarSectionOrder(currentOrder))) {
    return next;
  }
  await saveLeftSidebarSectionOrderToStore(next);
  return next;
}
