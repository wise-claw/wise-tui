export interface SiderSnapState {
  width: number;
  collapsed: boolean;
}

export interface SiderDragSnapOptions {
  expandedWidth: number;
  collapsedWidth: number;
  hysteresisPx?: number;
}

const DEFAULT_HYSTERESIS_PX = 6;

function clampWidth(width: number, opts: SiderDragSnapOptions): number {
  const lo = Math.min(opts.collapsedWidth, opts.expandedWidth);
  const hi = Math.max(opts.collapsedWidth, opts.expandedWidth);
  return Math.min(hi, Math.max(lo, width));
}

/**
 * Pure snap-with-hysteresis algorithm. Given the previous snap state, a
 * pointer-delta in px (positive = grow, negative = shrink), and the
 * expanded/collapsed widths, return the new snap state.
 *
 * Snap point sits at the midpoint between collapsedWidth and expandedWidth.
 * A `hysteresisPx` band around the snap point prevents flip-flop when the
 * user wiggles around the midpoint.
 */
export function applySiderDragSnap(
  prev: SiderSnapState,
  deltaPx: number,
  opts: SiderDragSnapOptions,
): SiderSnapState {
  const hysteresis = opts.hysteresisPx ?? DEFAULT_HYSTERESIS_PX;
  const snap = (opts.expandedWidth + opts.collapsedWidth) / 2;
  const proposed = prev.width + deltaPx;

  if (prev.collapsed) {
    if (proposed > snap + hysteresis) {
      return { width: opts.expandedWidth, collapsed: false };
    }
    return { width: clampWidth(proposed, opts), collapsed: true };
  }

  if (proposed < snap - hysteresis) {
    return { width: opts.collapsedWidth, collapsed: true };
  }
  return { width: clampWidth(proposed, opts), collapsed: false };
}

import { useCallback, useRef, useState } from "react";

interface UseSiderDragSnapResult {
  state: SiderSnapState;
  onPointerDelta: (deltaPx: number) => void;
  reset: (next: SiderSnapState) => void;
}

interface UseSiderDragSnapHookOptions extends SiderDragSnapOptions {
  initial: SiderSnapState;
  onChange?: (next: SiderSnapState) => void;
}

export function useSiderDragSnap(opts: UseSiderDragSnapHookOptions): UseSiderDragSnapResult {
  const { initial, onChange, ...snapOpts } = opts;
  const [state, setState] = useState<SiderSnapState>(initial);
  const optsRef = useRef(snapOpts);
  optsRef.current = snapOpts;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onPointerDelta = useCallback((deltaPx: number) => {
    setState((prev) => {
      const next = applySiderDragSnap(prev, deltaPx, optsRef.current);
      if (next.width !== prev.width || next.collapsed !== prev.collapsed) {
        onChangeRef.current?.(next);
      }
      return next;
    });
  }, []);

  const reset = useCallback((next: SiderSnapState) => {
    setState(next);
  }, []);

  return { state, onPointerDelta, reset };
}
