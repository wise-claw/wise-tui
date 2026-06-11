import { useCallback, useState } from "react";
import {
  clampWorkspaceFileTreeRailWidthPx,
  readWorkspaceFileTreeRailOpenFromStorage,
  readWorkspaceFileTreeRailWidthFromStorage,
  writeWorkspaceFileTreeRailOpenToStorage,
  writeWorkspaceFileTreeRailWidthToStorage,
} from "../utils/workspaceFileTreeRailStorage";

export function useWorkspaceFileTreeRail() {
  const [open, setOpenState] = useState(readWorkspaceFileTreeRailOpenFromStorage);
  const [widthPx, setWidthPxState] = useState(readWorkspaceFileTreeRailWidthFromStorage);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    writeWorkspaceFileTreeRailOpenToStorage(next);
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  const setWidthPx = useCallback((next: number) => {
    const clamped = clampWorkspaceFileTreeRailWidthPx(next);
    setWidthPxState(clamped);
    writeWorkspaceFileTreeRailWidthToStorage(clamped);
  }, []);

  return {
    fileTreeRailOpen: open,
    setFileTreeRailOpen: setOpen,
    toggleFileTreeRail: toggleOpen,
    fileTreeRailWidthPx: widthPx,
    setFileTreeRailWidthPx: setWidthPx,
  };
}
