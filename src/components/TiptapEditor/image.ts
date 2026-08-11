import { Image } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { WiseImageNodeView } from "./WiseImageNodeView";

export type WiseImageAlign = "left" | "center" | "right";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 语雀风格图片节点：
 * - 默认靠左展示，支持拖拽右下角手柄缩放（width 以 px 持久化）。
 * - 自定义尺寸/对齐时以 HTML `<img>` 序列化回 Markdown，普通图片保持 `![alt](src)`。
 */
export const WiseImage = Image.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: true,
      resize: false,
      HTMLAttributes: { class: "app-tiptap-image-el" },
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "left",
        parseHTML: (element) => element.getAttribute("align") ?? "left",
        renderHTML: (attributes) =>
          attributes.align && attributes.align !== "left"
            ? { align: attributes.align }
            : {},
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(WiseImageNodeView);
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: {
          isBlock: boolean;
          attrs: Record<string, unknown>;
        }) => {
          const { src, alt, title, width, align } = node.attrs;
          const srcValue = typeof src === "string" ? src : "";
          const altValue = typeof alt === "string" ? alt : "";
          const titleValue = typeof title === "string" ? title : "";
          const widthValue = typeof width === "string" ? width : "";
          const alignValue = typeof align === "string" ? align : "left";

          if (widthValue || (alignValue && alignValue !== "left")) {
            const parts = [`<img src="${escapeHtml(srcValue)}" alt="${escapeHtml(altValue)}"`];
            if (titleValue) parts.push(`title="${escapeHtml(titleValue)}"`);
            if (widthValue) parts.push(`width="${escapeHtml(widthValue)}"`);
            if (alignValue && alignValue !== "left") parts.push(`align="${escapeHtml(alignValue)}"`);
            parts.push("/>");
            state.write(parts.join(" "));
          } else {
            const escapedSrc = srcValue.replace(/[()"]/g, "\\$&");
            const titlePart = titleValue ? ` "${titleValue.replace(/"/g, '\\"')}"` : "";
            state.write(`![${altValue}](${escapedSrc}${titlePart})`);
          }
          if (node.isBlock) {
            state.closeBlock(node);
          }
        },
      },
    };
  },
});
