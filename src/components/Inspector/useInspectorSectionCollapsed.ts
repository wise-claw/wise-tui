import { useCallback, useState } from "react";
import {
  readInspectorSectionCollapsedFromStorage,
  writeInspectorSectionCollapsedToStorage,
  type InspectorSectionId,
} from "./inspectorStorage";

export function useInspectorSectionCollapsed(sectionId: InspectorSectionId) {
  const [collapsed, setCollapsedState] = useState(() =>
    readInspectorSectionCollapsedFromStorage(sectionId),
  );

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      writeInspectorSectionCollapsedToStorage(sectionId, next);
    },
    [sectionId],
  );

  return [collapsed, setCollapsed] as const;
}
