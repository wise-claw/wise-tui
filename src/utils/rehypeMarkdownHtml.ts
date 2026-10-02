import rehypeRaw from "rehype-raw";

/**
 * Markdown 预览允许内联 HTML（README 常见的 <p align>、<img>、<sub> 等），
 * 但必须剔除可执行 / 嵌入式标签，让预览保持为「文档」而非可运行页面。
 */
const EXECUTABLE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "textarea",
  "select",
  "option",
  "button",
]);

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function stripExecutableHtml(node: HastNode): void {
  const children = node.children;
  if (!children?.length) return;
  const kept: HastNode[] = [];
  for (const child of children) {
    if (child.type === "element" && child.tagName && EXECUTABLE_TAGS.has(child.tagName)) {
      continue;
    }
    if (child.type === "element" && child.properties) {
      for (const name of Object.keys(child.properties)) {
        if (/^on/i.test(name)) delete child.properties[name];
      }
    }
    stripExecutableHtml(child);
    kept.push(child);
  }
  node.children = kept;
}

/** rehype 插件：删除可执行标签与内联事件属性，保留其余 HTML 结构。 */
export function rehypeStripExecutableHtml() {
  return (tree: HastNode) => {
    stripExecutableHtml(tree);
  };
}

/** Markdown 渲染统一入口：先解析原始 HTML，再剔除可执行内容。 */
export const MARKDOWN_HTML_REHYPE_PLUGINS = [rehypeRaw, rehypeStripExecutableHtml];
