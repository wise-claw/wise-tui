import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX,
  clampMainLayoutLeftWidthPx,
  clampMainLayoutRightWidthPx,
  readPersistedLeftSiderWidthFromStorage,
  writePersistedLeftSiderWidthToStorage,
} from "../constants/mainLayoutWidths";

const STORAGE_RIGHT_KEY = "wise.mainLayout.rightSiderWidthPx";

function readStoredWidth(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

// ── Hook ──

export function usePersistedMainLayoutSiderWidths(options: {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}) {
  const { leftCollapsed, rightCollapsed } = options;

  const [leftWidthPx, setLeftWidthPxState] = useState(() => readPersistedLeftSiderWidthFromStorage());
  const [rightWidthPx, setRightWidthPxState] = useState(() =>
    readStoredWidth(STORAGE_RIGHT_KEY, MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX),
  );

  const leftCollapsedRef = useRef(leftCollapsed);
  const rightCollapsedRef = useRef(rightCollapsed);
  leftCollapsedRef.current = leftCollapsed;
  rightCollapsedRef.current = rightCollapsed;

  const leftWidthRef = useRef(leftWidthPx);
  const rightWidthRef = useRef(rightWidthPx);
  leftWidthRef.current = leftWidthPx;
  rightWidthRef.current = rightWidthPx;

  const clampBothToViewport = useCallback(() => {
    if (typeof window === "undefined") return;
    const inner = window.innerWidth;
    const lc = leftCollapsedRef.current;
    const rc = rightCollapsedRef.current;
    let l = leftWidthRef.current;
    let r = rightWidthRef.current;
    l = clampMainLayoutLeftWidthPx(l, {
      innerWidth: inner,
      leftCollapsed: lc,
      rightCollapsed: rc,
      peerRightWidthPx: r,
      peerLeftWidthPx: l,
    });
    r = clampMainLayoutRightWidthPx(r, {
      innerWidth: inner,
      leftCollapsed: lc,
      rightCollapsed: rc,
      peerRightWidthPx: r,
      peerLeftWidthPx: l,
    });
    l = clampMainLayoutLeftWidthPx(l, {
      innerWidth: inner,
      leftCollapsed: lc,
      rightCollapsed: rc,
      peerRightWidthPx: r,
      peerLeftWidthPx: l,
    });
    setLeftWidthPxState((prev) => (prev === l ? prev : l));
    setRightWidthPxState((prev) => (prev === r ? prev : r));
    try {
      writePersistedLeftSiderWidthToStorage(l);
      window.localStorage.setItem(STORAGE_RIGHT_KEY, String(r));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const normalized = readPersistedLeftSiderWidthFromStorage();
    setLeftWidthPxState(normalized);
    writePersistedLeftSiderWidthToStorage(normalized);
  }, []);

  useEffect(() => {
    clampBothToViewport();
  }, [leftCollapsed, rightCollapsed, clampBothToViewport]);

  const setLeftWidthPx = useCallback((next: number) => {
    if (typeof window === "undefined") return;
    const inner = window.innerWidth;
    const clamped = clampMainLayoutLeftWidthPx(next, {
      innerWidth: inner,
      leftCollapsed: leftCollapsedRef.current,
      rightCollapsed: rightCollapsedRef.current,
      peerRightWidthPx: rightWidthRef.current,
      peerLeftWidthPx: leftWidthRef.current,
    });
    setLeftWidthPxState(clamped);
    try {
      writePersistedLeftSiderWidthToStorage(clamped);
    } catch {
      /* ignore */
    }
  }, []);

  const setRightWidthPx = useCallback((next: number) => {
    if (typeof window === "undefined") return;
    const inner = window.innerWidth;
    const clamped = clampMainLayoutRightWidthPx(next, {
      innerWidth: inner,
      leftCollapsed: leftCollapsedRef.current,
      rightCollapsed: rightCollapsedRef.current,
      peerRightWidthPx: rightWidthRef.current,
      peerLeftWidthPx: leftWidthRef.current,
    });
    setRightWidthPxState(clamped);
    try {
      window.localStorage.setItem(STORAGE_RIGHT_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  return { leftWidthPx, rightWidthPx, setLeftWidthPx, setRightWidthPx };
}
