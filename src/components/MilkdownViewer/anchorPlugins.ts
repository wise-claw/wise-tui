import type { RefObject } from "react";
import { Editor } from "@milkdown/kit/core";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/utils";
import type { AnchorRange, MilkdownTaskAnchor } from "./types";
import {
  finalizeAnchorRangeWithContextAfter,
  findRangeByDescriptor,
  findRequirementHighlightRange,
  rangeLooksLikeAnchorMatch,
} from "./anchorRanges";
import { runWithEditorView } from "./editorView";

/** Transaction meta keys used to force decoration rebuilds after anchor state changes. */
const TASK_REQ_HL_REFRESH = "wise_task_req_hl_refresh";
const TASK_REQ_FOCUS_REFRESH = "wise_task_req_focus_refresh";

export const taskReqHighlightStateKey = new PluginKey<{ decos: DecorationSet }>("wise-task-req-highlight");
export const taskReqFocusStateKey = new PluginKey<{ decos: DecorationSet }>("wise-task-req-focus");

export function buildTaskAnchorDecorationSet(
  doc: PMNode,
  anchors: MilkdownTaskAnchor[] | undefined,
  selectedKey: string | null | undefined,
): DecorationSet {
  try {
    if (!anchors?.length) return DecorationSet.empty;
    const decos: Decoration[] = [];
    const docMax = Math.max(1, doc.content.size);
    for (const anchor of anchors) {
      const descriptorRange = findRangeByDescriptor(doc, anchor.descriptor, anchor.searchText);
      let range = descriptorRange
        ?? (anchor.range && rangeLooksLikeAnchorMatch(doc, anchor.range, anchor.searchText)
          ? anchor.range
          : findRequirementHighlightRange(doc, anchor.searchText));
      if (!range) continue;
      range = finalizeAnchorRangeWithContextAfter(doc, anchor.descriptor, range) ?? range;
      const safeFrom = Math.min(Math.max(1, Math.floor(range.from)), docMax);
      const safeTo = Math.min(Math.max(1, Math.floor(range.to)), docMax);
      if (!Number.isFinite(safeFrom) || !Number.isFinite(safeTo) || safeTo <= safeFrom) continue;
      for (const marker of anchor.markers) {
        const isSelected = Boolean(selectedKey && marker.taskId === selectedKey);
        const cls = isSelected
          ? "app-milkdown-task-anchor-highlight app-milkdown-task-anchor-highlight--selected"
          : "app-milkdown-task-anchor-highlight";
        decos.push(Decoration.inline(
          safeFrom,
          safeTo,
          { class: cls },
          { taskId: marker.taskId, anchorKey: anchor.key, anchorRange: { from: safeFrom, to: safeTo } },
        ));
      }
    }
    if (!decos.length) return DecorationSet.empty;
    return DecorationSet.create(doc, decos);
  } catch {
    // Anchor calculation failures must not block the editor from rendering.
    return DecorationSet.empty;
  }
}

export function createWiseTaskRequirementHighlightPlugin(
  anchorsRef: RefObject<MilkdownTaskAnchor[] | undefined>,
  selectedKeyRef: RefObject<string | null | undefined>,
): ReturnType<typeof $prose> {
  return $prose(() =>
    new Plugin<{ decos: DecorationSet }>({
      key: taskReqHighlightStateKey,
      state: {
        init: (_cfg, state) => ({
          decos: buildTaskAnchorDecorationSet(state.doc, anchorsRef.current, selectedKeyRef.current),
        }),
        apply(tr, pluginState, _oldState, newState) {
          if (tr.getMeta(TASK_REQ_HL_REFRESH) === true) {
            return {
              decos: buildTaskAnchorDecorationSet(
                newState.doc,
                anchorsRef.current,
                selectedKeyRef.current,
              ),
            };
          }
          return { decos: pluginState.decos.map(tr.mapping, newState.doc) };
        },
      },
      props: {
        decorations(state) {
          return taskReqHighlightStateKey.getState(state)?.decos ?? DecorationSet.empty;
        },
      },
    }),
  );
}

export function dispatchTaskRequirementHighlightRefresh(editor: Editor) {
  runWithEditorView(editor, (view) => {
    view.dispatch(view.state.tr.setMeta(TASK_REQ_HL_REFRESH, true));
  });
}

function buildTaskAnchorFocusDecorationSet(
  doc: PMNode,
  range: AnchorRange | null | undefined,
): DecorationSet {
  if (!range) return DecorationSet.empty;
  const docMax = Math.max(1, doc.content.size);
  const from = Math.min(Math.max(1, Math.floor(range.from)), docMax);
  const to = Math.min(Math.max(1, Math.floor(range.to)), docMax);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return DecorationSet.empty;
  return DecorationSet.create(doc, [
    Decoration.inline(from, to, {
      class: "app-milkdown-task-anchor-focus-highlight",
    }),
  ]);
}

export function createWiseTaskRequirementFocusPlugin(
  focusRangeRef: RefObject<AnchorRange | null>,
): ReturnType<typeof $prose> {
  return $prose(() =>
    new Plugin<{ decos: DecorationSet }>({
      key: taskReqFocusStateKey,
      state: {
        init: (_cfg, state) => ({
          decos: buildTaskAnchorFocusDecorationSet(state.doc, focusRangeRef.current),
        }),
        apply(tr, pluginState, _oldState, newState) {
          if (tr.getMeta(TASK_REQ_FOCUS_REFRESH) === true) {
            return {
              decos: buildTaskAnchorFocusDecorationSet(newState.doc, focusRangeRef.current),
            };
          }
          return { decos: pluginState.decos.map(tr.mapping, newState.doc) };
        },
      },
      props: {
        decorations(state) {
          return taskReqFocusStateKey.getState(state)?.decos ?? DecorationSet.empty;
        },
      },
    }),
  );
}

export function dispatchTaskRequirementFocusRefresh(editor: Editor) {
  runWithEditorView(editor, (view) => {
    view.dispatch(view.state.tr.setMeta(TASK_REQ_FOCUS_REFRESH, true));
  });
}
