import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { TiptapAnchorRange, TiptapTaskAnchor } from "./types";

export const WISE_DECORATIONS_KEY = new PluginKey<Record<string, never>>("wiseDecorations");

export interface WiseDecorationsOptions {
  getAnchors: () => TiptapTaskAnchor[];
  getSelectedKey: () => string | null;
  getFocusRange: () => TiptapAnchorRange | null;
  onMarkerClick: (taskId: string) => void;
}

function clampPos(value: number | null | undefined, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

/**
 * 任务锚点徽标 + 需求区间高亮装饰。
 * 锚点位置优先取 descriptor.from/to，其次取 range 缓存。
 */
export function createWiseDecorationsPlugin(options: WiseDecorationsOptions) {
  return new Plugin({
    key: WISE_DECORATIONS_KEY,
    props: {
      decorations(state) {
        const doc = state.doc;
        const max = Math.max(1, doc.content.size);
        const decos: Decoration[] = [];

        const focus = options.getFocusRange();
        if (focus) {
          const from = clampPos(focus.from, max);
          const to = clampPos(focus.to, max);
          if (from != null && to != null && to > from) {
            decos.push(Decoration.inline(from, to, { class: "app-tiptap-anchor-focus-highlight" }));
          }
        }

        const selectedKey = options.getSelectedKey();
        for (const anchor of options.getAnchors()) {
          const descriptor = anchor.descriptor;
          let from = clampPos(descriptor?.from, max);
          let to = clampPos(descriptor?.to, max);
          if (from == null) from = clampPos(anchor.range?.from, max);
          if (to == null) to = clampPos(anchor.range?.to, max);

          if (from != null && to != null && to > from) {
            const isSelected = anchor.key === selectedKey;
            decos.push(
              Decoration.inline(from, to, {
                class: isSelected
                  ? "app-tiptap-task-anchor-highlight app-tiptap-task-anchor-highlight--selected"
                  : "app-tiptap-task-anchor-highlight",
              }),
            );
          }

          const badgePos = from ?? (to != null ? Math.max(1, to - 1) : null);
          if (badgePos != null && anchor.markers.length > 0) {
            decos.push(
              Decoration.widget(badgePos, (_view, _getPos) => {
                const host = document.createElement("span");
                host.className = "app-tiptap-task-anchor-badges";
                host.setAttribute("contenteditable", "false");
                for (const marker of anchor.markers) {
                  const btn = document.createElement("button");
                  btn.type = "button";
                  btn.className = "app-tiptap-task-anchor-badge";
                  btn.setAttribute("aria-label", `定位到任务 ${marker.label}`);
                  btn.title = `定位到任务 ${marker.taskId}`;
                  btn.textContent = marker.label;
                  btn.addEventListener("mousedown", (e) => e.preventDefault());
                  btn.addEventListener("click", () => options.onMarkerClick(marker.taskId));
                  host.appendChild(btn);
                }
                return host;
              }),
            );
          }
        }
        return DecorationSet.create(doc, decos);
      },
    },
  });
}

/** 触发一次空事务以重算装饰（锚点/高亮依赖外部 ref）。 */
export function refreshWiseDecorations(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(WISE_DECORATIONS_KEY, {}));
}

/** 与装饰插件同步的纯计算：返回已解析锚点 id 与区间，供宿主持久化。 */
export function collectResolvedAnchorRanges(
  doc: { content: { size: number } } & {
    childCount?: number;
  },
  anchors: TiptapTaskAnchor[],
): { resolvedIds: string[]; ranges: Record<string, TiptapAnchorRange> } {
  const max = Math.max(1, doc.content.size);
  const resolvedIds: string[] = [];
  const ranges: Record<string, TiptapAnchorRange> = {};
  for (const anchor of anchors) {
    const descriptor = anchor.descriptor;
    let from = clampPos(descriptor?.from, max);
    let to = clampPos(descriptor?.to, max);
    if (from == null) from = clampPos(anchor.range?.from, max);
    if (to == null) to = clampPos(anchor.range?.to, max);
    if (from != null && to != null && to > from) {
      for (const marker of anchor.markers) {
        if (!resolvedIds.includes(marker.taskId)) resolvedIds.push(marker.taskId);
      }
      ranges[anchor.key] = { from, to };
    }
  }
  return { resolvedIds, ranges };
}
