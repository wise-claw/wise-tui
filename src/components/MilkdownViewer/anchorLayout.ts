import { Editor } from "@milkdown/kit/core";
import type { AnchorRange, MilkdownTaskAnchor, MilkdownTaskAnchorMarker } from "./types";
import { taskReqHighlightStateKey } from "./anchorPlugins";
import { runWithEditorView } from "./editorView";

export type AnchorLayout = {
  key: string;
  top: number;
  left: number;
  markers: MilkdownTaskAnchorMarker[];
  selected: boolean;
};

export function sameAnchorLayouts(a: AnchorLayout[], b: AnchorLayout[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const la = a[i];
    const lb = b[i];
    if (!la || !lb) return false;
    if (la.key !== lb.key) return false;
    if (la.selected !== lb.selected) return false;
    if (Math.abs(la.top - lb.top) > 1) return false;
    if (Math.abs(la.left - lb.left) > 1) return false;
    if (la.markers.length !== lb.markers.length) return false;
    for (let j = 0; j < la.markers.length; j += 1) {
      const ma = la.markers[j];
      const mb = lb.markers[j];
      if (!ma || !mb) return false;
      if (ma.taskId !== mb.taskId || ma.label !== mb.label) return false;
    }
  }
  return true;
}

export function computeAnchorLayouts(
  editor: Editor,
  anchors: MilkdownTaskAnchor[],
  hostEl: HTMLElement,
  selectedKey: string | null | undefined,
): AnchorLayout[] {
  const layouts: AnchorLayout[] = [];
  const markerByTaskId = new Map<string, MilkdownTaskAnchorMarker>();
  for (const anchor of anchors) {
    for (const marker of anchor.markers) {
      markerByTaskId.set(marker.taskId, marker);
    }
  }
  const hostRect = hostEl.getBoundingClientRect();
  const ok = runWithEditorView(editor, (view) => {
    const pluginState = taskReqHighlightStateKey.getState(view.state);
    const decos = pluginState?.decos.find(undefined, undefined, (spec) => {
      if (!spec || typeof spec !== "object") return false;
      const taskId = (spec as { taskId?: unknown }).taskId;
      return typeof taskId === "string" && taskId.length > 0;
    }) ?? [];
    const seen = new Set<string>();
    const grouped = new Map<string, AnchorLayout>();
    for (const deco of decos) {
      const taskId = (deco.spec as { taskId?: string }).taskId;
      if (!taskId || seen.has(taskId)) continue;
      const marker = markerByTaskId.get(taskId);
      if (!marker) continue;
      seen.add(taskId);
      const startCoords = view.coordsAtPos(deco.from);
      const top = Math.round(startCoords.top - hostRect.top - 11);
      const left = Math.round(startCoords.left - hostRect.left - 2);
      const anchorRange = (deco.spec as { anchorRange?: { from?: number; to?: number } }).anchorRange;
      const rangeFrom = Number(anchorRange?.from ?? deco.from);
      const rangeTo = Number(anchorRange?.to ?? deco.to);
      const groupKey = `${Math.floor(rangeFrom)}:${Math.floor(rangeTo)}`;
      const existing = grouped.get(groupKey);
      if (existing) {
        existing.markers.push(marker);
        existing.markers.sort((a, b) => a.taskId.localeCompare(b.taskId));
        if (selectedKey && taskId === selectedKey) existing.selected = true;
      } else {
        grouped.set(groupKey, {
          key: groupKey,
          top,
          left: Math.max(2, left),
          markers: [marker],
          selected: Boolean(selectedKey && taskId === selectedKey),
        });
      }
    }
    layouts.push(...grouped.values());
    layouts.sort((a, b) => a.key.localeCompare(b.key));
  });
  if (!ok) return [];
  return layouts;
}

export function collectResolvedAnchorRanges(editor: Editor): Record<string, AnchorRange> {
  const out: Record<string, AnchorRange> = {};
  runWithEditorView(editor, (view) => {
    const pluginState = taskReqHighlightStateKey.getState(view.state);
    const decos = pluginState?.decos.find(undefined, undefined, (spec) => {
      if (!spec || typeof spec !== "object") return false;
      const taskId = (spec as { taskId?: unknown }).taskId;
      return typeof taskId === "string" && taskId.length > 0;
    }) ?? [];
    for (const deco of decos) {
      const taskId = (deco.spec as { taskId?: string }).taskId;
      if (!taskId || out[taskId]) continue;
      out[taskId] = { from: deco.from, to: deco.to };
    }
  });
  return out;
}
